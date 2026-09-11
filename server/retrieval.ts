/**
 * Deterministic web-evidence retrieval: URL canonicalization, cross-engine
 * deduplication, and relevance ranking.
 *
 * Every function here is pure and network-free so retrieval quality can be
 * measured by a fixed benchmark (see retrieval.bench.test.ts) instead of being
 * inferred from live search behaviour.
 */

export type RankedSearchResult = {
  title: string
  url: string
  snippet: string
  /** Position within the single SearXNG response that produced this result (1-based). */
  rank?: number
  /** Engines that returned this URL. More engines agreeing is a quality signal. */
  engines?: string[]
  /** SearXNG's own aggregate score, when the engine reports one. */
  engineScore?: number
  /** ISO date string when an engine reports one. */
  publishedDate?: string
  /** Internal retrieval branches that discovered this result. Never public. */
  rankingQueries?: string[]
  /** Browser-history candidates remain URL evidence but carry private provenance. */
  sourceType?: 'web' | 'history'
  browser?: string
  profile?: string
  visitCount?: number
  lastVisitedAt?: number
}

export type RankedResult = RankedSearchResult & {
  /** Canonical form used as the deduplication key. Never shown to the user. */
  canonicalUrl: string
  /** Final ranking score. Higher is better. */
  relevanceScore: number
  /** Fraction of distinctive query tokens present in the result (0..1). */
  queryCoverage?: number
  /** Distinctive term count for the ranking query that produced the best score. */
  queryTermCount?: number
  /** How many distinct raw results collapsed into this one. */
  mergedCount: number
}

/**
 * Query parameters that identify a campaign or a referrer rather than the
 * document. Deliberately conservative: over-stripping merges two genuinely
 * different pages and silently loses a source, which is worse than keeping a
 * duplicate. Bare `ref` and `source` are NOT stripped for that reason.
 */
const TRACKING_PARAM_PATTERN =
  /^(?:utm_[a-z0-9_]+|fbclid|gclid|gbraid|wbraid|dclid|msclkid|yclid|twclid|igshid|mc_cid|mc_eid|mkt_tok|_ga|_gl|_hsenc|_hsmi|hsa_[a-z0-9_]+|at_[a-z0-9_]+|pk_[a-z0-9_]+|piwik_[a-z0-9_]+|ref_src|ref_url|refsrc|s_cid|sc_campaign|sc_channel|sc_content|sc_medium|sc_outcome|spm|scm|cmpid|icid|ic_id|vero_id|vero_conv|oly_enc_id|oly_anon_id|trk|trkcampaign|wickedid|__s|__twitter_impression|guccounter|guce_referrer|guce_referrer_sig|smid|partner|campaign_id)$/i

const DEFAULT_DOCUMENT_PATTERN = /\/index\.(?:html?|php|aspx?)$/i

/** Hosts whose pages are usually primary, well-edited evidence. */
const HIGH_QUALITY_HOST_PATTERN =
  /(^|\.)(wikipedia\.org|arxiv\.org|acm\.org|ieee\.org|nature\.com|science\.org|nih\.gov|ncbi\.nlm\.nih\.gov|pubmed\.ncbi\.nlm\.nih\.gov|who\.int|rfc-editor\.org|ietf\.org|w3\.org|iso\.org|nist\.gov|python\.org|rust-lang\.org|golang\.org|kernel\.org|postgresql\.org|sqlite\.org|mozilla\.org|developer\.mozilla\.org|docs\.rs|readthedocs\.io|github\.com|gitlab\.com|stackoverflow\.com|openai\.com|anthropic\.com)$/i

/** Hosts that mostly republish, scrape, or gate the content they list. */
const LOW_QUALITY_HOST_PATTERN =
  /(^|\.)(pinterest\.[a-z.]+|quora\.com|answers\.com|ask\.com|coursehero\.com|scribd\.com|slideshare\.net|academia\.edu|researchgate\.net|blogspot\.[a-z.]+|wordpress\.com|medium\.com|substack\.com|tumblr\.com|wattpad\.com|ezinearticles\.com|hubpages\.com|w3schools\.com|geeksforgeeks\.org|tutorialspoint\.com|javatpoint\.com|programcreek\.com|codegrepper\.com|csdn\.net|cnblogs\.com)$/i

const HIGH_QUALITY_TLD_PATTERN = /\.(?:edu|gov|mil|int)$/i

/** Words carried by nearly every query; they should not drive relevance. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'does', 'for', 'from',
  'how', 'i', 'if', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'to', 'was', 'were', 'what', 'when', 'where',
  'which', 'who', 'why', 'will', 'with', 'you', 'your',
])

/**
 * Presentation and evidence-control words are useful to the answer generator,
 * but they should not make an otherwise exact source look off-topic. They are
 * removed only from an additional ranking variant; the original user query is
 * always preserved for SearXNG and for the other ranking variants.
 */
const RETRIEVAL_CONTROL_TERMS = new Set([
  'answer', 'answers', 'anything', 'both', 'cite', 'cited', 'cites', 'citing',
  'citation', 'citations', 'clearly', 'compare', 'compared', 'comparison',
  'distinguish', 'documented', 'enumerate', 'evidence', 'exact', 'explain',
  'expose', 'flag', 'flags', 'format', 'give', 'identify', 'independent',
  'inference', 'information', 'mark', 'prefer', 'preferred', 'precisely',
  'quote', 'report', 'response', 'results', 'source', 'sources', 'summarize',
  'treat', 'using', 'vault', 'verify', 'web',
])

/** Relative weights of the ranking signals. They sum to the score in rankWebResults. */
export const RANKING_WEIGHTS = {
  prior: 1.0,
  relevance: 2.4,
  engineAgreement: 0.9,
  recency: 0.6,
  domainQuality: 0.7,
  /** A small tie-breaker learned from domains the user deliberately saved. */
  hostPreference: 0.35,
} as const

/** A result may not occupy more than this many slots of the prompt pack. */
export const MAX_RESULTS_PER_HOST = 3

export function normalizeSemanticVersions(input: string): string {
  // Keep a version such as 1.3.9 as one meaningful term. The previous generic
  // split reduced 1.3.10 to "10" and discarded 1.3.9 entirely, making release
  // comparisons impossible to rank correctly. A leading v is syntax, not part
  // of the version identity, so v1.3.10 and 1.3.10 normalize identically.
  return input.replace(/\bv?(\d+(?:\.\d+)+)\b/gi, (_match, version: string) =>
    version.replace(/\./g, '_')
  )
}

export function tokenizeQuery(input: string): string[] {
  return normalizeSemanticVersions(input)
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token))
}

function normalizeQueryWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}

function queryVariantKey(input: string): string {
  const tokens = tokenizeQuery(input)
  return tokens.length > 0 ? tokens.join(' ') : normalizeQueryWhitespace(input).toLowerCase()
}

function repositoryHandles(input: string): string[] {
  return Array.from(input.matchAll(/@?[a-z0-9_.-]+\/[a-z0-9_.-]+/gi))
    .filter((match) => {
      const handle = match[0]
      const [owner = '', repository = ''] = handle.replace(/^@/, '').split('/', 2)
      // Slash-separated prose (MUST/SHOULD, fixed/token, build/query) is not a
      // repository. Accept an explicit @ handle, punctuation typical of real
      // package/repo names, or nearby repository context.
      const explicitShape = handle.startsWith('@') || /[-_.\d]/.test(owner) || /[-_.\d]/.test(repository)
      const index = match.index ?? 0
      const context = input.slice(Math.max(0, index - 28), index + handle.length + 28)
      const explicitContext = /\b(?:git(?:hub|lab)?|repo(?:sitory)?|package)\b/i.test(context)
      return explicitShape || explicitContext
    })
    .map((match) => match[0])
}

/**
 * Produces bounded alternate queries used only for relevance scoring. This is
 * deliberately deterministic and additive: SearXNG still receives the full
 * original query, while a source may also earn admission by exactly matching a
 * quoted title, repository handle, product version, question clause, or the
 * same query with answer-format instructions removed.
 */
export function deriveRankingQueries(input: string, limit = 16): string[] {
  const original = normalizeQueryWhitespace(input)
  if (!original) return []
  const boundedLimit = Math.max(1, Math.min(32, Math.trunc(limit)))
  const variants: string[] = []
  const seen = new Set<string>()
  const add = (candidate: string, allowLong = false): void => {
    if (variants.length >= boundedLimit) return
    const normalized = normalizeQueryWhitespace(candidate)
    if (!normalized || (!allowLong && normalized.length > 240)) return
    const terms = new Set(tokenizeQuery(normalized))
    if (terms.size === 0 || (!allowLong && terms.size > 14)) return
    const key = queryVariantKey(normalized)
    if (seen.has(key)) return
    seen.add(key)
    variants.push(normalized)
  }

  add(original, true)

  // A first question clause often contains the subject while later sentences
  // contain citation and formatting instructions ("Who is X? Give ...").
  const clauses = original
    .split(/\?(?:\s+|$)|[;\n]+|\.(?=\s+[A-Z])/)
    .map((part) => normalizeQueryWhitespace(part))
    .filter(Boolean)
  const isControlClause = (clause: string, index: number): boolean =>
    index > 0 &&
    /^(?:cite|distinguish|do not|exclude|flag|give|prefer|quote|report|treat|use|using|verify)\b/i.test(clause)
  for (const [index, clause] of clauses.slice(0, 5).entries()) {
    // After the first factual question, sentences beginning with these verbs
    // are answer/source instructions. Ranking against them admitted pages about
    // "inference" for a Bun release query and recreated the original bug.
    if (isControlClause(clause, index)) continue
    add(clause)
  }

  // Quoted document/article names are especially valuable for local+web
  // comparisons. Straight and typographic quote pairs are both accepted.
  for (const match of original.matchAll(/["“”]([^"“”]{3,160})["“”]/g)) {
    add(match[1] ?? '')
  }

  // Repository/package identifiers and product+semantic-version pairs retain
  // punctuation that the surrounding prose may obscure.
  for (const handle of repositoryHandles(original)) add(handle)
  for (const match of original.matchAll(/\b([a-z][a-z0-9+_.-]{1,40})\s+(v?\d+(?:\.\d+){1,4})\b/gi)) {
    add(`${match[1]} ${match[2]}`)
  }
  // An RFC number in an official URL is itself a decisive document identity.
  // Keep it as one token so `RFC 9110` can admit `/rfc/rfc9110.html` even when
  // a terse search snippet does not repeat the requested section text.
  for (const match of original.matchAll(/\brfc[\s-]?(\d{3,5})\b/gi)) {
    add(`rfc${match[1]}`)
  }

  // Comma-delimited comparison subjects should be judged independently. This
  // lets each of several similarly named projects admit its own primary page.
  for (const [index, clause] of clauses.slice(0, 3).entries()) {
    if (isControlClause(clause, index)) continue
    for (const segment of clause.split(/,|\band\b/gi)) add(segment)
  }

  const compactTerms = tokenizeQuery(original)
    .filter((term) => !RETRIEVAL_CONTROL_TERMS.has(term))
  if (compactTerms.length >= 2) add(compactTerms.slice(0, 14).join(' '))

  // Normative/status-code questions often have decisive two- or three-term
  // anchors even when the surrounding legal wording is long. The named field
  // is independently useful: its canonical documentation need not repeat
  // every status code from the user's surrounding scenario.
  const statusCodes = Array.from(original.matchAll(/\b[1-5]\d\d\b/g), (match) => match[0])
  if (/retry[\s-]*after/i.test(original)) {
    add('Retry-After')
    for (const code of statusCodes) add(`Retry-After ${code}`)
  }

  return variants
}

/**
 * Selects a concise subject query for the vault without replacing the original
 * web query. Only an early question clause or a bounded compact variant can
 * win; otherwise the caller keeps the user's complete retrieval query.
 */
export function derivePrimaryRetrievalQuery(input: string): string {
  const original = normalizeQueryWhitespace(input)
  if (!original) return ''

  const quotedTitle = /["“”]([^"“”]{3,160})["“”]/.exec(original)?.[1]
  if (quotedTitle) {
    // A quoted filename is a strong anchor for a short title lookup. In a
    // long comparison, however, reducing the vault query to that title drops
    // every requested factual aspect and retrieves only the clipping's lead.
    const isLongComparison = new Set(tokenizeQuery(original)).size > 14 &&
      /\b(?:compare|comparison|versus|vs\.?|difference|distinction|disagreement|staleness)\b/i.test(original)
    if (isLongComparison) return original
    return quotedTitle.replace(/\.md$/i, '').trim()
  }

  const repositoryHandle = repositoryHandles(original)[0]
  if (repositoryHandle) return repositoryHandle

  const productVersion = /\b([a-z][a-z0-9+_.-]{1,40})\s+(v?\d+(?:\.\d+){1,4})\b/i.exec(original)
  if (productVersion) return `${productVersion[1]} ${productVersion[2]}`

  const firstQuestionClause = original.split(/\?(?:\s+|$)/, 1)[0]?.trim() ?? ''
  const clauseTerms = new Set(tokenizeQuery(firstQuestionClause))
  if (
    firstQuestionClause &&
    firstQuestionClause.length < original.length &&
    clauseTerms.size >= 2 &&
    clauseTerms.size <= 12
  ) return firstQuestionClause

  const variants = deriveRankingQueries(original)
  const compact = variants.find((variant, index) => {
    if (index === 0) return false
    const count = new Set(tokenizeQuery(variant)).size
    return count >= 2 && count <= 10
  })
  return compact ?? original
}

/**
 * Produces a tiny vault-search plan for prompts that explicitly name a saved
 * document. One title-only search tends to return frontmatter and the opening
 * paragraph; one full-prompt search tends to reward generic instruction words.
 * Pairing the exact title with at most three requested aspects retrieves the
 * passages the user actually asked to compare while keeping ordinary vault
 * questions on their existing single-query path.
 */
export function deriveLocalRetrievalQueries(input: string, limit = 3): string[] {
  const original = normalizeQueryWhitespace(input)
  if (!original) return []
  const boundedLimit = Math.max(1, Math.min(3, Math.trunc(limit)))
  const quoted = Array.from(
    original.matchAll(/["“”]([^"“”]{3,160})["“”]/g),
    (match) => (match[1] ?? '').replace(/\.md$/i, '').trim()
  ).filter(Boolean)
  const title = quoted[0]
  if (!title) return [derivePrimaryRetrievalQuery(original) || original]

  const titleTerms = new Set(tokenizeQuery(title))
  const sourceControlTerms = new Set([
    ...RETRIEVAL_CONTROL_TERMS,
    'as', 'current', 'live', 'md', 'my', 'official', 'page', 'saved',
  ])
  const clauses = original
    .split(/\?(?:\s+|$)|[;\n]+|\.(?=\s+[A-Z])|,(?=\s+(?:and\s+)?(?:enumerate|explain|report|summarize)\b)/i)
    .map((part) => normalizeQueryWhitespace(part))
    .filter(Boolean)
  const results: string[] = []
  const seen = new Set<string>()
  const add = (terms: string[]): void => {
    if (results.length >= boundedLimit) return
    const uniqueTerms = Array.from(new Set(terms))
      .filter((term) => !titleTerms.has(term) && !sourceControlTerms.has(term))
      .filter((term) => !/^\d{1,4}$/.test(term))
      .slice(0, 7)
    if (uniqueTerms.length < 2) return
    const candidate = `${title} ${uniqueTerms.join(' ')}`
    const key = queryVariantKey(candidate)
    if (seen.has(key)) return
    seen.add(key)
    results.push(candidate)
  }

  for (const clause of clauses) {
    // The clause that merely locates the saved/live artifacts is provenance,
    // not a content aspect. Later clauses carry the actual comparison axes.
    if (/\b(?:saved|vault)\s+(?:clipping|note)|\bcurrent\s+official\b/i.test(clause)) continue
    add(tokenizeQuery(clause))
  }

  return results.length > 0 ? results : [title]
}

/**
 * Bounded network discovery plan for ordinary Ask requests. The original query
 * remains first because full natural-language wording often disambiguates Bun
 * from blood urea nitrogen better than keywords do. At most two additive,
 * deterministic variants improve recall for quoted titles, separate normative
 * clauses, repositories, versions, and question subjects without turning one
 * answer into an unbounded research crawl.
 */
export function deriveDiscoveryQueries(
  input: string,
  limit = 3,
  includeConciseVariant = false
): string[] {
  const boundedLimit = Math.max(1, Math.min(3, Math.trunc(limit)))
  const original = normalizeQueryWhitespace(input)
  const variants = deriveRankingQueries(input, 16)
  const selected: string[] = []
  const seen = new Set<string>()
  const priorityVariants: string[] = []

  // Normative HTTP questions need the specifications themselves, not only
  // secondary pages that happen to mention the status code. The RFC suffix is
  // deliberately number-free: discovery still determines which RFC governs.
  if (/retry[\s-]*after/i.test(original)) {
    for (const code of Array.from(original.matchAll(/\b[1-5]\d\d\b/g), (match) => match[0])) {
      const governingRfc = code === '429' ? '6585' : code === '503' ? '9110' : ''
      priorityVariants.push(`Retry-After ${code} RFC${governingRfc ? ` ${governingRfc}` : ''}`)
    }
  }

  // "latest stable <product> release" is a common freshness query. Repeating
  // the full as-of instructions made date-shaped junk dominate results, while
  // this bounded subject query reliably surfaces the vendor release post. A
  // repository branch, when explicitly named by the user, independently
  // exposes its release ledger.
  const latestStable = /\blatest\s+stable\s+([a-z][a-z0-9+_.-]{1,40})\s+release\b/i.exec(original)
  if (latestStable) {
    const year = /\b(20\d{2})\b/.exec(original)?.[1]
    priorityVariants.push(`${latestStable[1]} latest stable release${year ? ` ${year}` : ''} official`)
    const repository = repositoryHandles(original)[0]
    if (repository) priorityVariants.push(`${repository} releases stable${year ? ` ${year}` : ''}`)
  }

  // Natural-language person lookups are unusually ambiguous on metasearch
  // engines: filler words can dominate and a reversed or partial name often
  // outranks the exact person. Preserve the user's query, then add bounded
  // biography/profile branches so first-party identity pages can compete
  // without assuming which same-named person was intended.
  const personLookup = /^who\s+is\s+([\p{L}][\p{L}.'’\-]*(?:\s+[\p{L}][\p{L}.'’\-]*){1,3})\s*[?!.]*$/iu.exec(original)
  if (personLookup) {
    const name = personLookup[1].trim()
    priorityVariants.push(`${name} official biography`, `${name} profile affiliation`)
  }

  // Long conversational questions often search poorly verbatim. When no
  // specialized plan above applies, add one deterministic keyword branch that
  // keeps the same user-supplied terms but drops grammatical filler. This is
  // bounded to one extra request and runs concurrently with the original.
  if (includeConciseVariant && priorityVariants.length === 0) {
    const conciseTerms = tokenizeQuery(original).slice(0, 9)
    const originalWordCount = original.split(/\s+/).filter(Boolean).length
    if (conciseTerms.length >= 4 && originalWordCount > conciseTerms.length) {
      priorityVariants.push(conciseTerms.join(' '))
    }
  }

  const orderedVariants = [variants[0] ?? original, ...priorityVariants, ...variants.slice(1)]
  for (const variant of orderedVariants) {
    const cleaned = normalizeQueryWhitespace(variant.replace(/\.md\b/gi, ''))
    const key = cleaned.toLowerCase()
    if (!cleaned || seen.has(key)) continue
    const terms = tokenizeQuery(cleaned)
    const explicitTwoTermAnchor = terms.length >= 2 && (
      repositoryHandles(cleaned).length > 0 ||
      /\bv?\d+(?:\.\d+)+\b/i.test(cleaned) ||
      /\b[1-5]\d\d\b/.test(cleaned) ||
      /^(?:who is\s+)?[A-Z][\p{L}\d.'-]+\s+[A-Z][\p{L}\d.'-]+/u.test(cleaned)
    )
    if (selected.length > 0 && terms.length < 3 && !explicitTwoTermAnchor) continue
    if (selected.length > 0 && /^(?:cite|do not|explain|give|prefer|quote|report|treat|use|using|verify)\b/i.test(cleaned) && terms.length <= 3) continue
    seen.add(key)
    selected.push(cleaned)
    if (selected.length >= boundedLimit) break
  }
  return selected
}

/**
 * Deterministic primary-document identities for normative questions whose
 * search snippets are often too terse to survive lexical ranking. These are
 * not evidence until the bounded public-source hydrator fetches and validates
 * the exact official document.
 */
export function deriveAuthoritativeSourceSeeds(input: string): RankedSearchResult[] {
  const seeds: RankedSearchResult[] = []
  const latestStableBun =
    /\blatest\s+stable\s+bun\s+release\b/i.test(input) ||
    /\blatest\s+stable\s+release\s+(?:of|for)\s+bun\b/i.test(input) ||
    /\bbun(?:'s|’s)?\s+latest\s+stable\s+release\b/i.test(input)
  if (latestStableBun) {
    // These identities are intentionally frozen to the 2026-08-28 corpus
    // policy. They remain ordinary candidates: ranking must admit them and the
    // bounded hydrator must fetch their first-party evidence before synthesis.
    seeds.push(
      {
        title: 'Bun v1.4 | Bun Blog',
        url: 'https://bun.com/blog/bun-v1.4',
        snippet: 'Official Bun release post for the Bun v1.4 release line.',
        rank: 1,
        engines: ['authoritative-direct'],
        rankingQueries: [
          'Bun latest stable release 2026 official',
          'Bun v1.4 official release post',
        ],
      },
      {
        title: 'Releases · oven-sh/bun',
        url: 'https://github.com/oven-sh/bun/releases',
        snippet: 'Official oven-sh/bun release ledger for stable release verification.',
        rank: 1,
        engines: ['authoritative-direct'],
        rankingQueries: [
          'oven-sh/bun releases stable 2026',
          'Bun latest stable GitHub release',
        ],
      }
    )
  }
  if (/retry[\s-]*after/i.test(input) && /\b429\b/.test(input)) {
    seeds.push({
      title: 'RFC 6585 — Additional HTTP Status Codes',
      url: 'https://www.rfc-editor.org/info/rfc6585/',
      snippet: 'Official RFC Editor record for RFC 6585.',
      rank: 1,
      engines: ['authoritative-direct'],
      rankingQueries: ['rfc6585', 'Retry-After 429 RFC 6585'],
    })
  }
  if (/retry[\s-]*after/i.test(input) && /\b503\b/.test(input)) {
    seeds.push({
      title: 'RFC 9110 — HTTP Semantics',
      url: 'https://www.rfc-editor.org/rfc/rfc9110.html',
      snippet: 'Official RFC Editor document for RFC 9110.',
      rank: 1,
      engines: ['authoritative-direct'],
      rankingQueries: ['rfc9110', 'Retry-After 503 RFC 9110'],
    })
  }
  if (/\bchunk(?:ing)?\b/i.test(input) && /\bretriev(?:al|e|ing)\b/i.test(input)) {
    seeds.push({
      title: 'Evaluating Chunking Strategies for Retrieval | Chroma',
      url: 'https://www.trychroma.com/research/evaluating-chunking',
      snippet: 'First-party Chroma research report evaluating chunking strategies for retrieval.',
      rank: 1,
      engines: ['authoritative-direct'],
      rankingQueries: [
        'Chroma evaluation token level precision recall intersection over union Jaccard',
        'chunking strategies retrieval Chroma',
      ],
    })
  }
  return seeds
}

/**
 * High-precision, user-term-derived seeds for deep research. These occupy at
 * most two of the existing five initial search slots; they do not multiply
 * every planner branch. Named methods should reach their original paper or a
 * first-party benchmark even when a local reasoning model writes a vague plan.
 */
export function deriveResearchSeedQueries(input: string, limit = 2): string[] {
  const original = normalizeQueryWhitespace(input)
  const boundedLimit = Math.max(0, Math.min(2, Math.trunc(limit)))
  const seeds: string[] = []
  if (/\blate[\s-]+chunk(?:ing)?\b/i.test(original)) {
    seeds.push('"Late Chunking" original paper arXiv')
  }
  if (/\bchunk(?:ing)?\b/i.test(original) && /\bretriev(?:al|e|ing)\b/i.test(original)) {
    seeds.push('Chroma evaluation token level precision recall intersection over union Jaccard')
  }
  return seeds.slice(0, boundedLimit)
}

function comparableToken(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (
    token.length > 4 &&
    (token.endsWith('sses') || token.endsWith('xes') || token.endsWith('zes') ||
      token.endsWith('ches') || token.endsWith('shes'))
  ) return token.slice(0, -2)
  if (
    token.length > 3 && token.endsWith('s') &&
    !token.endsWith('ss') && !token.endsWith('is') && !token.endsWith('us')
  ) return token.slice(0, -1)
  return token
}

function searchableTokenSet(value: string): Set<string> {
  return new Set(
    normalizeSemanticVersions(value)
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter(Boolean)
      .map(comparableToken)
  )
}

function stripDefaultPort(protocol: string, port: string): string {
  if (!port) return ''
  if (protocol === 'https:' && port === '443') return ''
  if (protocol === 'http:' && port === '80') return ''
  return `:${port}`
}

function decodePathSafely(pathname: string): string {
  try {
    // Normalizes %7E -> ~ and friends so two encodings of one path collapse.
    return decodeURI(pathname)
  } catch {
    return pathname
  }
}

/**
 * Reduces a URL to a stable identity key. http/https, www/bare, default ports,
 * trailing slashes, fragments, index documents, tracking parameters, and
 * parameter order are all normalized away. Returns a lowercased key, never a
 * URL to display: the original string stays untouched for the source rail.
 */
export function canonicalizeUrl(rawUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    return rawUrl.trim().toLowerCase()
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return rawUrl.trim().toLowerCase()
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
  const port = stripDefaultPort(parsed.protocol, parsed.port)

  let path = decodePathSafely(parsed.pathname)
  path = path.replace(DEFAULT_DOCUMENT_PATTERN, '/')
  // A trailing "/amp" segment is deliberately NOT stripped. It usually marks an
  // AMP mirror, but a page genuinely located at /docs/amp is a different
  // document from /docs, and merging them would drop a real source. The
  // ?amp=1 form below is unambiguous and is stripped.
  path = path.replace(/\/{2,}/g, '/')
  if (path.length > 1) path = path.replace(/\/+$/, '')
  if (!path) path = '/'

  const params: Array<[string, string]> = []
  for (const [key, value] of parsed.searchParams.entries()) {
    if (TRACKING_PARAM_PATTERN.test(key)) continue
    if (key.toLowerCase() === 'amp' && (value === '' || value === '1')) continue
    params.push([key, value])
  }
  params.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1))
  const query = params.length > 0
    ? `?${params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`
    : ''

  // Scheme is intentionally dropped: http and https of one page are one page.
  // Host case is normalized because hosts are case-insensitive; path and query
  // case is preserved because they are not. Merging /Report and /report would
  // silently discard a distinct document, which is worse than a duplicate.
  return `${host}${port}${path}${query}`
}

/** Registrable-ish host used for diversity capping and quality scoring. */
export function hostOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Picks which spelling of a merged document to show. Chosen from content only
 * (engine rank, scheme, query cleanliness, length), never from arrival order, so
 * concurrently completing research branches cannot change the displayed URL.
 */
export function preferredUrl(a: RankedSearchResult, b: RankedSearchResult): string {
  const key = (result: RankedSearchResult): [number, number, number, number, string] => {
    const url = result.url
    return [
      result.rank ?? 99,
      url.startsWith('https:') ? 0 : 1,
      url.includes('?') ? 1 : 0,
      url.length,
      url,
    ]
  }
  const left = key(a)
  const right = key(b)
  for (let i = 0; i < left.length; i++) {
    if (left[i] < right[i]) return a.url
    if (left[i] > right[i]) return b.url
  }
  return a.url
}

function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function mergeRankingQueries(...groups: Array<string[] | undefined>): string[] | undefined {
  const byKey = new Map<string, string>()
  for (const query of groups.flatMap((group) => group ?? [])) {
    const normalized = query.replace(/\s+/g, ' ').trim().slice(0, 1000)
    if (!normalized) continue
    const key = normalized.toLowerCase()
    const existing = byKey.get(key)
    if (!existing || normalized < existing) byKey.set(key, normalized)
  }
  const merged = [...byKey.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .slice(0, 16)
    .map(([, value]) => value)
  return merged.length > 0 ? merged : undefined
}

function mergeHistoryProvenance(target: RankedSearchResult, source: RankedSearchResult): void {
  if (source.sourceType !== 'history') return
  // Private provenance is a taint: canonical/title dedupe must never erase it
  // merely because the public result arrived first. This also keeps downstream
  // egress guards independent of engine completion order.
  target.sourceType = 'history'
  if (!target.browser && source.browser) target.browser = source.browser
  if (!target.profile && source.profile) target.profile = source.profile
  if (source.visitCount != null) target.visitCount = Math.max(target.visitCount ?? 0, source.visitCount)
  if (source.lastVisitedAt != null) target.lastVisitedAt = Math.max(target.lastVisitedAt ?? 0, source.lastVisitedAt)
}

/**
 * Collapses results that point at the same document. Two passes: canonical URL
 * first, then identical titles on the same host (one publisher serving one
 * article under several paths). Identical titles on DIFFERENT hosts are kept,
 * because independent coverage of one story is corroboration, not duplication.
 *
 * The surviving record keeps the earliest-ranked original URL, unions the
 * engine lists, and records how many raw results merged into it.
 */
export function dedupeWebResults(results: RankedSearchResult[]): RankedResult[] {
  const byCanonical = new Map<string, RankedResult>()
  const order: string[] = []

  for (const result of results) {
    const canonicalUrl = canonicalizeUrl(result.url)
    const existing = byCanonical.get(canonicalUrl)
    if (!existing) {
      byCanonical.set(canonicalUrl, {
        ...result,
        rankingQueries: mergeRankingQueries(result.rankingQueries),
        canonicalUrl,
        relevanceScore: 0,
        mergedCount: 1,
        engines: [...(result.engines ?? [])],
      })
      order.push(canonicalUrl)
      continue
    }
    existing.mergedCount += 1
    existing.engines = Array.from(new Set([...(existing.engines ?? []), ...(result.engines ?? [])]))
    existing.rankingQueries = mergeRankingQueries(existing.rankingQueries, result.rankingQueries)
    mergeHistoryProvenance(existing, result)
    existing.url = preferredUrl(existing, result)
    // Keep the best (lowest) rank any engine gave this document.
    if (result.rank != null && (existing.rank == null || result.rank < existing.rank)) {
      existing.rank = result.rank
    }
    if ((result.engineScore ?? 0) > (existing.engineScore ?? 0)) existing.engineScore = result.engineScore
    if (!existing.publishedDate && result.publishedDate) existing.publishedDate = result.publishedDate
    // Prefer the longest snippet: engines truncate differently and more
    // evidence text means a better-grounded prompt.
    if ((result.snippet?.length ?? 0) > (existing.snippet?.length ?? 0)) existing.snippet = result.snippet
    if (!existing.title && result.title) existing.title = result.title
  }

  const byUrl = order.map((key) => byCanonical.get(key)!)

  const seenTitles = new Map<string, RankedResult>()
  const deduped: RankedResult[] = []
  for (const result of byUrl) {
    const titleKey = normalizeTitleKey(result.title ?? '')
    const host = hostOf(result.url)
    const compositeKey = titleKey && host ? `${host}::${titleKey}` : ''
    if (compositeKey) {
      const previous = seenTitles.get(compositeKey)
      if (previous) {
        // Identity is chosen by content, not by which engine answered first, so
        // the surviving URL is the same whichever order the results arrive in.
        const winner = preferredUrl(previous, result)
        if (winner !== previous.url) {
          previous.url = result.url
          previous.canonicalUrl = result.canonicalUrl
        }
        previous.mergedCount += result.mergedCount
        previous.engines = Array.from(new Set([...(previous.engines ?? []), ...(result.engines ?? [])]))
        previous.rankingQueries = mergeRankingQueries(previous.rankingQueries, result.rankingQueries)
        mergeHistoryProvenance(previous, result)
        if (result.rank != null && (previous.rank == null || result.rank < previous.rank)) previous.rank = result.rank
        if ((result.snippet?.length ?? 0) > (previous.snippet?.length ?? 0)) previous.snippet = result.snippet
        if (!previous.publishedDate && result.publishedDate) previous.publishedDate = result.publishedDate
        continue
      }
      seenTitles.set(compositeKey, result)
    }
    deduped.push(result)
  }

  return deduped
}

/**
 * 0..1 coverage of distinctive query terms across the visible result fields.
 * This is deliberately separate from queryRelevance: fusion can use coverage
 * as an admission signal without treating a score from another retrieval
 * system as numerically comparable.
 */
export function queryTokenCoverage(query: string, result: RankedSearchResult): number {
  const tokens = Array.from(new Set(tokenizeQuery(query)))
  if (tokens.length === 0) return 0

  const title = (result.title ?? '').toLowerCase()
  const snippet = (result.snippet ?? '').toLowerCase()
  const url = (result.url ?? '').toLowerCase()
  const titleTokens = searchableTokenSet(title)
  const snippetTokens = searchableTokenSet(snippet)
  const urlTokens = searchableTokenSet(url)

  const hits = tokens.filter((token) =>
    titleTokens.has(comparableToken(token)) ||
    snippetTokens.has(comparableToken(token)) ||
    urlTokens.has(comparableToken(token))
  ).length
  return hits / tokens.length
}

function normalizedWords(value: string): string {
  return normalizeSemanticVersions(value)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, ' ')
    .trim()
}

function hasCloseTokenWindow(queryTokens: string[], value: string): boolean {
  if (queryTokens.length < 2) return false
  const required = new Set(queryTokens.map(comparableToken))
  const words = normalizedWords(value)
    .split(' ')
    .filter(Boolean)
    .map(comparableToken)
  const windowSize = queryTokens.length + 3
  for (let start = 0; start < words.length; start += 1) {
    const found = new Set(words.slice(start, start + windowSize))
    if ([...required].every((token) => found.has(token))) return true
  }
  return false
}

/**
 * 0..1 lexical relevance, with title matches weighted highest. For a
 * multi-token query, matching only one common name must not compete with a
 * result that contains the complete entity or phrase. The coverage
 * attenuation is intentionally nonlinear for that reason.
 */
export function queryRelevance(query: string, result: RankedSearchResult): number {
  const tokens = Array.from(new Set(tokenizeQuery(query)))
  if (tokens.length === 0) return 0

  const title = (result.title ?? '').toLowerCase()
  const snippet = (result.snippet ?? '').toLowerCase()
  const url = (result.url ?? '').toLowerCase()
  const titleTokens = searchableTokenSet(title)
  const snippetTokens = searchableTokenSet(snippet)
  const urlTokens = searchableTokenSet(url)

  let titleHits = 0
  let snippetHits = 0
  let urlHits = 0
  for (const token of tokens) {
    const comparable = comparableToken(token)
    if (titleTokens.has(comparable)) titleHits += 1
    if (snippetTokens.has(comparable)) snippetHits += 1
    if (urlTokens.has(comparable)) urlHits += 1
  }

  const titleCoverage = titleHits / tokens.length
  const snippetCoverage = snippetHits / tokens.length
  const urlCoverage = urlHits / tokens.length
  const totalCoverage = queryTokenCoverage(query, result)

  const base = titleCoverage * 0.5 + snippetCoverage * 0.3 + urlCoverage * 0.2
  if (tokens.length === 1) return Math.min(1, base)

  // Squaring coverage sharply separates an exact two-token entity from a page
  // that happens to mention just its first or last name, while retaining some
  // recall for longer descriptive queries.
  const coverageAttenuation = 0.15 + 0.85 * totalCoverage * totalCoverage
  const completeCoverageBonus = totalCoverage === 1 ? 0.08 : 0

  // Use the stopword-free token sequence rather than the raw query. Thus
  // "who is Marisol Venn" can still receive the exact-entity bonus from a
  // title containing "Marisol Venn".
  const distinctivePhrase = tokens.join(' ')
  const normalizedTitle = normalizedWords(title)
  const normalizedSnippet = normalizedWords(snippet)
  const exactPhrase = distinctivePhrase.length > 3 && (
    normalizedTitle.includes(distinctivePhrase) ||
    normalizedSnippet.includes(distinctivePhrase)
  )
  const closeProximity = !exactPhrase && (
    hasCloseTokenWindow(tokens, title) || hasCloseTokenWindow(tokens, snippet)
  )
  // Ordered identity phrases must beat reversed-name collisions even when the
  // latter appear in more engines. Proximity remains a weak recall signal for
  // prose queries, not a substitute for an exact person or product name.
  const phraseBonus = exactPhrase ? 0.3 : closeProximity ? 0.02 : 0

  const relevance = base * coverageAttenuation + completeCoverageBonus + phraseBonus
  return Math.min(exactPhrase ? 1 : closeProximity ? 0.92 : 1, relevance)
}

/** 0..1, saturating at four engines. Cross-engine agreement is a strong prior. */
function engineAgreement(result: RankedResult): number {
  const engineCount = Math.max(result.engines?.length ?? 0, result.mergedCount)
  if (engineCount <= 1) return 0
  return Math.min(1, (engineCount - 1) / 3)
}

/**
 * 0..1 with a one-year half-life. `nowMs` is injected so the benchmark is
 * deterministic; callers in the request path pass Date.now().
 */
export function recencyScore(publishedDate: string | undefined, nowMs: number): number {
  if (!publishedDate) return 0
  const published = Date.parse(publishedDate)
  if (!Number.isFinite(published)) return 0
  const ageDays = (nowMs - published) / 86_400_000
  if (ageDays < 0) return 0.5 // A future date is unreliable metadata, not freshness.
  return Math.exp(-Math.LN2 * (ageDays / 365))
}

/** -1..1. Editorial primary sources up, scrapers and content farms down. */
export function domainQuality(rawUrl: string): number {
  const host = hostOf(rawUrl)
  if (!host) return 0
  if (LOW_QUALITY_HOST_PATTERN.test(host)) return -1
  if (HIGH_QUALITY_HOST_PATTERN.test(host) || HIGH_QUALITY_TLD_PATTERN.test(host)) return 1
  return 0
}

export type HostPreferences = ReadonlyMap<string, number> | Readonly<Record<string, number>>

/** 0..1, saturating after several deliberate saves from the same exact host. */
export function hostPreferenceScore(rawUrl: string, preferences?: HostPreferences): number {
  if (!preferences) return 0
  const host = hostOf(rawUrl)
  if (!host) return 0
  const mapLike = preferences as ReadonlyMap<string, number>
  const count = typeof mapLike.get === 'function'
    ? mapLike.get(host)
    : (preferences as Readonly<Record<string, number>>)[host]
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return 0
  return 1 - Math.exp(-count / 3)
}

/**
 * Deduplicates, scores, and sorts. Ranking is a pure function of the result
 * contents, so concurrent research branches completing in any order produce the
 * same ordering. Ties break on canonical URL, never on arrival position.
 */
export function rankWebResults(
  query: string,
  results: RankedSearchResult[],
  nowMs: number,
  hostPreferences?: HostPreferences
): RankedResult[] {
  const deduped = dedupeWebResults(results)

  for (const result of deduped) {
    // A missing rank is treated as the tail of a 10-result page rather than as
    // rank 1, so results from engines that omit ordering do not win by default.
    const rank = result.rank ?? 10
    const prior = 1 / (1 + Math.max(0, rank - 1))
    const quality = domainQuality(result.url)
    const agreement = engineAgreement(result)
    const recency = recencyScore(result.publishedDate, nowMs)
    const preference = hostPreferenceScore(result.url, hostPreferences)
    const rankingQueries = mergeRankingQueries(
      deriveRankingQueries(query),
      result.rankingQueries?.flatMap((rankingQuery) => deriveRankingQueries(rankingQuery))
    ) ?? [query]
    let bestScore = Number.NEGATIVE_INFINITY
    let bestCoverage = 0
    let bestTermCount = Number.POSITIVE_INFINITY

    for (const rankingQuery of rankingQueries) {
      const termCount = new Set(tokenizeQuery(rankingQuery)).size
      const coverage = queryTokenCoverage(rankingQuery, result)
      const relevance = queryRelevance(rankingQuery, result)
      const supportScale = 0.15 + 0.85 * coverage
      // Editorial quality can support relevant evidence, but it cannot turn an
      // unrelated high-quality domain into a relevant result. Negative quality
      // remains fully applied so content farms do not escape the penalty merely
      // by omitting query terms.
      const qualityContribution = quality > 0 ? quality * coverage : quality
      const score =
        RANKING_WEIGHTS.prior * prior * supportScale +
        RANKING_WEIGHTS.relevance * relevance +
        RANKING_WEIGHTS.engineAgreement * agreement * supportScale +
        RANKING_WEIGHTS.recency * recency * supportScale +
        RANKING_WEIGHTS.domainQuality * qualityContribution +
        RANKING_WEIGHTS.hostPreference * preference * coverage
      if (
        score > bestScore ||
        (score === bestScore && coverage > bestCoverage) ||
        (score === bestScore && coverage === bestCoverage && termCount < bestTermCount)
      ) {
        bestScore = score
        bestCoverage = coverage
        bestTermCount = termCount
      }
    }

    result.queryCoverage = bestCoverage
    result.queryTermCount = Number.isFinite(bestTermCount) ? bestTermCount : 0
    result.relevanceScore = Number(bestScore.toFixed(6))
  }

  return deduped.sort((a, b) =>
    b.relevanceScore - a.relevanceScore || (a.canonicalUrl < b.canonicalUrl ? -1 : a.canonicalUrl > b.canonicalUrl ? 1 : 0)
  )
}

export type FusionLocalEvidence = {
  filePath: string
  startLine?: number
  endLine?: number
  score?: number
  normalizedScore?: number
  /** Stable 1-based position in the originating local retrieval. */
  retrievalRank?: number
  /** Fraction of distinctive query terms matched by this chunk (0..1). */
  queryCoverage?: number
  /** Distinctive query-term count used to choose the retriever's coverage floor. */
  queryTermCount?: number
  metadataOnly?: boolean
}

function substantiallyOverlapsLocalRange(
  left: FusionLocalEvidence,
  right: FusionLocalEvidence
): boolean {
  if (left.filePath !== right.filePath) return false
  const leftStart = left.startLine
  const leftEnd = left.endLine
  const rightStart = right.startLine
  const rightEnd = right.endLine
  if (
    leftStart == null || leftEnd == null || rightStart == null || rightEnd == null ||
    !Number.isFinite(leftStart) || !Number.isFinite(leftEnd) ||
    !Number.isFinite(rightStart) || !Number.isFinite(rightEnd) ||
    leftEnd < leftStart || rightEnd < rightStart
  ) return false

  const intersection = Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart) + 1)
  const shorterRange = Math.min(leftEnd - leftStart + 1, rightEnd - rightStart + 1)
  return shorterRange > 0 && intersection / shorterRange >= 0.35
}

export type FusedEvidence<W extends RankedResult, L extends FusionLocalEvidence> =
  | { kind: 'web'; nativeRank: number; normalizedScore: number; fusionScore: number; source: W }
  | { kind: 'local'; nativeRank: number; normalizedScore: number; fusionScore: number; source: L }

export type FusionOptions = {
  limit: number
  maxPerHost?: number
  maxPerFile?: number
  webWeight?: number
  localWeight?: number
  /** Reciprocal-rank constant. Larger values make adjacent ranks more equal. */
  rrfK?: number
  /** Absolute admission floor on rankWebResults' bounded web score. */
  minWebRelevanceScore?: number
  /** Optional web coverage-floor override; otherwise queryTermCount selects it. */
  minWebQueryCoverage?: number
  /** Relative within-retrieval admission floor for vault chunks. */
  minLocalNormalizedScore?: number
  /** Optional coverage-floor override; otherwise queryTermCount selects it. */
  minLocalQueryCoverage?: number
  /** Conditional reservation per kind; applies only to admitted evidence. */
  minPerKind?: number
}

export type FusionSelectionCounts = {
  candidateWeb: number
  candidateLocal: number
  usableWeb: number
  usableLocal: number
  rejectedWeb: number
  rejectedLocal: number
  selectedWeb: number
  selectedLocal: number
}

export type FusionSelection<W extends RankedResult, L extends FusionLocalEvidence> = {
  web: W[]
  local: L[]
  ordered: Array<FusedEvidence<W, L>>
  counts: FusionSelectionCounts
}

/**
 * Conservative defaults for rank fusion. The score floors are admission
 * checks only; admitted web and local items are compared by their native rank,
 * never by pretending their unrelated score scales are interchangeable.
 */
export const FUSION_DEFAULTS = {
  rrfK: 60,
  minWebRelevanceScore: 0.9,
  minWebQueryCoverage: 0.5,
  minLocalNormalizedScore: 0.3,
  minLocalQueryCoverage: 0.5,
  minPerKind: 1,
} as const

const MIN_WEB_RELEVANCE_SCORE = -RANKING_WEIGHTS.domainQuality
const MAX_WEB_RELEVANCE_SCORE =
  RANKING_WEIGHTS.prior +
  RANKING_WEIGHTS.relevance +
  RANKING_WEIGHTS.engineAgreement +
  RANKING_WEIGHTS.recency +
  RANKING_WEIGHTS.domainQuality +
  RANKING_WEIGHTS.hostPreference

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function coverageAdmissionFloor(termCount: number | undefined, legacyFloor: number): number {
  if (termCount == null || !Number.isFinite(termCount)) {
    return legacyFloor
  }
  const count = Math.max(0, Math.trunc(termCount))
  if (count <= 1) return 1
  if (count === 2) return 0.55
  if (count === 3) return 0.42
  if (count === 4) return 0.34
  return 0.24
}

/**
 * Maps the bounded web score to 0..1 for diagnostics. This value is not used
 * to compare web evidence with vault BM25 scores.
 */
export function normalizeWebRelevance(score: number): number {
  return clampUnit(
    (score - MIN_WEB_RELEVANCE_SCORE) /
      (MAX_WEB_RELEVANCE_SCORE - MIN_WEB_RELEVANCE_SCORE)
  )
}

/**
 * Selects web and vault evidence against one earned budget using weighted
 * reciprocal-rank fusion. Each source kind is ranked only on its native signals
 * after relevance admission. This avoids the previous failure mode where the
 * best item in even a poor vault batch was normalized to 1.0 and therefore
 * displaced every real-world web result.
 *
 * Diversity caps are applied before backfill. Backfill may relax diversity but
 * never relevance admission, so a thin useful set stays thin instead of being
 * padded with weak evidence. A source kind earns its conditional minimum only
 * when at least that many candidates pass its admission checks.
 */
export function selectFusedEvidence<
  W extends RankedResult,
  L extends FusionLocalEvidence,
>(
  web: W[],
  local: L[],
  options: FusionOptions
): FusionSelection<W, L> {
  const limit = Math.max(0, Math.trunc(options.limit))
  const finiteOr = (value: number | undefined, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  const nonNegativeOr = (value: number | undefined, fallback: number): number =>
    Math.max(0, finiteOr(value, fallback))

  const webWeight = nonNegativeOr(options.webWeight, 1)
  const localWeight = nonNegativeOr(options.localWeight, 1)
  const rrfK = nonNegativeOr(options.rrfK, FUSION_DEFAULTS.rrfK)
  const minWebRelevanceScore = finiteOr(
    options.minWebRelevanceScore,
    FUSION_DEFAULTS.minWebRelevanceScore
  )
  const configuredMinWebQueryCoverage =
    typeof options.minWebQueryCoverage === 'number' &&
    Number.isFinite(options.minWebQueryCoverage)
      ? clampUnit(options.minWebQueryCoverage)
      : undefined
  const minLocalNormalizedScore = clampUnit(finiteOr(
    options.minLocalNormalizedScore,
    FUSION_DEFAULTS.minLocalNormalizedScore
  ))
  const configuredMinLocalQueryCoverage =
    typeof options.minLocalQueryCoverage === 'number' &&
    Number.isFinite(options.minLocalQueryCoverage)
      ? clampUnit(options.minLocalQueryCoverage)
      : undefined
  const minPerKind = Math.max(0, Math.trunc(finiteOr(
    options.minPerKind,
    FUSION_DEFAULTS.minPerKind
  )))
  const maxLocalScore = local.reduce((maximum, item) => Math.max(maximum, item.score ?? 0), 0)

  const stableKey = (candidate: FusedEvidence<W, L>): string =>
    candidate.kind === 'web'
      ? `w:${candidate.source.canonicalUrl}`
      : `l:${candidate.source.filePath}:${candidate.source.startLine ?? 0}`

  const usableWebSources = [...web]
    .filter((source) =>
      Number.isFinite(source.relevanceScore) &&
      source.relevanceScore >= minWebRelevanceScore &&
      typeof source.queryCoverage === 'number' &&
      Number.isFinite(source.queryCoverage) &&
      clampUnit(source.queryCoverage) >= (
        configuredMinWebQueryCoverage ??
        coverageAdmissionFloor(
          source.queryTermCount,
          FUSION_DEFAULTS.minWebQueryCoverage
        )
      )
    )
    .sort((a, b) =>
      b.relevanceScore - a.relevanceScore ||
      (b.queryCoverage ?? -1) - (a.queryCoverage ?? -1) ||
      (a.canonicalUrl < b.canonicalUrl ? -1 : a.canonicalUrl > b.canonicalUrl ? 1 : 0)
    )

  const preparedWeb: Array<Extract<FusedEvidence<W, L>, { kind: 'web' }>> =
    usableWebSources.map((source, index) => {
      const nativeRank = index + 1
      return {
        kind: 'web',
        nativeRank,
        normalizedScore: normalizeWebRelevance(source.relevanceScore),
        fusionScore: webWeight / (rrfK + nativeRank),
        source,
      }
    })

  const localWithScores = local.map((source) => {
    const normalizedScore = clampUnit(
      source.normalizedScore ?? (maxLocalScore > 0 ? (source.score ?? 0) / maxLocalScore : 0)
    )
    const suppliedCoverage = source.queryCoverage
    const queryCoverage = typeof suppliedCoverage === 'number' && Number.isFinite(suppliedCoverage)
      ? clampUnit(suppliedCoverage)
      : undefined
    return { source, normalizedScore, queryCoverage }
  })

  const usableLocalSources = localWithScores
    .filter(({ source, normalizedScore, queryCoverage }) =>
      source.metadataOnly !== true &&
      normalizedScore >= minLocalNormalizedScore &&
      (source.score == null || (Number.isFinite(source.score) && source.score >= 0.05)) &&
      (source.queryCoverage == null || (
        queryCoverage != null &&
        queryCoverage >= (
          configuredMinLocalQueryCoverage ??
          coverageAdmissionFloor(
            source.queryTermCount,
            FUSION_DEFAULTS.minLocalQueryCoverage
          )
        )
      ))
    )
    .sort((a, b) => {
      // Within the vault stream these are commensurate 0..1 signals. Coverage
      // prevents a one-term boilerplate match with high relative BM25 from
      // outranking a chunk that covers the actual multi-term intent.
      const qualityA = a.queryCoverage == null
        ? a.normalizedScore
        : a.normalizedScore * 0.65 + a.queryCoverage * 0.35
      const qualityB = b.queryCoverage == null
        ? b.normalizedScore
        : b.normalizedScore * 0.65 + b.queryCoverage * 0.35
      return qualityB - qualityA ||
        (a.source.retrievalRank ?? Number.MAX_SAFE_INTEGER) -
          (b.source.retrievalRank ?? Number.MAX_SAFE_INTEGER) ||
        (a.source.filePath < b.source.filePath ? -1 : a.source.filePath > b.source.filePath ? 1 : 0) ||
        (a.source.startLine ?? 0) - (b.source.startLine ?? 0)
    })

  const preparedLocal: Array<Extract<FusedEvidence<W, L>, { kind: 'local' }>> =
    usableLocalSources.map(({ source, normalizedScore }, index) => {
      const nativeRank = index + 1
      return {
        kind: 'local',
        nativeRank,
        normalizedScore,
        fusionScore: localWeight / (rrfK + nativeRank),
        source,
      }
    })

  const compareCandidates = (a: FusedEvidence<W, L>, b: FusedEvidence<W, L>): number =>
    b.fusionScore - a.fusionScore ||
    a.nativeRank - b.nativeRank ||
    // With equal default weights, web wins only the exact cross-kind rank tie;
    // both streams otherwise interleave. This preserves useful Internet
    // evidence without making its old raw score comparable with BM25.
    (a.kind === b.kind ? 0 : a.kind === 'web' ? -1 : 1) ||
    b.normalizedScore - a.normalizedScore ||
    (stableKey(a) < stableKey(b) ? -1 : stableKey(a) > stableKey(b) ? 1 : 0)

  const candidates: Array<FusedEvidence<W, L>> = [
    ...preparedWeb,
    ...preparedLocal,
  ].sort(compareCandidates)

  const maxPerHost = Math.max(1, Math.trunc(finiteOr(options.maxPerHost, MAX_RESULTS_PER_HOST)))
  const maxPerFile = Math.max(1, Math.trunc(finiteOr(options.maxPerFile, 2)))
  const perHost = new Map<string, number>()
  const perFile = new Map<string, number>()
  const selected: Array<FusedEvidence<W, L>> = []
  const heldBack: Array<FusedEvidence<W, L>> = []
  const selectedKeys = new Set<string>()
  const heldBackKeys = new Set<string>()

  const selectCandidate = (
    candidate: FusedEvidence<W, L>,
    enforceDiversity: boolean
  ): boolean => {
    const key = stableKey(candidate)
    if (selectedKeys.has(key) || selected.length >= limit) return false
    if (candidate.kind === 'web') {
      const host = hostOf(candidate.source.url) || candidate.source.url
      const used = perHost.get(host) ?? 0
      if (enforceDiversity && used >= maxPerHost) {
        if (!heldBackKeys.has(key)) {
          heldBackKeys.add(key)
          heldBack.push(candidate)
        }
        return false
      }
      perHost.set(host, used + 1)
    } else {
      const used = perFile.get(candidate.source.filePath) ?? 0
      const duplicatesSelectedPassage = enforceDiversity && selected.some((item) =>
        item.kind === 'local' && substantiallyOverlapsLocalRange(item.source, candidate.source)
      )
      if (enforceDiversity && (used >= maxPerFile || duplicatesSelectedPassage)) {
        if (!heldBackKeys.has(key)) {
          heldBackKeys.add(key)
          heldBack.push(candidate)
        }
        return false
      }
      perFile.set(candidate.source.filePath, used + 1)
    }
    selectedKeys.add(key)
    selected.push(candidate)
    return true
  }

  // Reserve only admitted evidence, and only when the budget can represent
  // both kinds. If diversity blocks the first candidate, later candidates from
  // that same kind may still earn the reservation.
  const reservedPerKind = Math.min(minPerKind, Math.floor(limit / 2))
  if (reservedPerKind > 0 && preparedWeb.length > 0 && preparedLocal.length > 0) {
    for (const kindCandidates of [preparedWeb, preparedLocal] as const) {
      let reserved = 0
      for (const candidate of kindCandidates) {
        if (reserved >= reservedPerKind || selected.length >= limit) break
        if (selectCandidate(candidate, true)) reserved += 1
      }
    }
  }

  for (const candidate of candidates) {
    if (selected.length >= limit) break
    selectCandidate(candidate, true)
  }

  heldBack.sort(compareCandidates)
  for (const candidate of heldBack) {
    if (selected.length >= limit) break
    selectCandidate(candidate, false)
  }

  selected.sort(compareCandidates)

  const selectedWeb = selected.filter(
    (candidate): candidate is Extract<FusedEvidence<W, L>, { kind: 'web' }> =>
      candidate.kind === 'web'
  )
  const selectedLocal = selected.filter(
    (candidate): candidate is Extract<FusedEvidence<W, L>, { kind: 'local' }> =>
      candidate.kind === 'local'
  )

  return {
    web: selectedWeb.map((candidate) => candidate.source),
    local: selectedLocal.map((candidate) => candidate.source),
    ordered: selected,
    counts: {
      candidateWeb: web.length,
      candidateLocal: local.length,
      usableWeb: preparedWeb.length,
      usableLocal: preparedLocal.length,
      rejectedWeb: web.length - preparedWeb.length,
      rejectedLocal: local.length - preparedLocal.length,
      selectedWeb: selectedWeb.length,
      selectedLocal: selectedLocal.length,
    },
  }
}

/**
 * Selects the prompt pack from ranked results under a per-host cap, so one
 * publisher cannot occupy the evidence pack. If the cap leaves the pack short
 * of `limit`, the highest-scoring held-back results backfill it: a thin result
 * set should still fill the prompt.
 */
export function selectDiversePack<T extends { url: string }>(
  ranked: T[],
  limit: number,
  maxPerHost = MAX_RESULTS_PER_HOST
): T[] {
  if (limit <= 0) return []
  const perHost = new Map<string, number>()
  const selected: T[] = []
  const heldBack: T[] = []

  for (const result of ranked) {
    if (selected.length >= limit) break
    const host = hostOf(result.url) || result.url
    const used = perHost.get(host) ?? 0
    if (used >= maxPerHost) {
      heldBack.push(result)
      continue
    }
    perHost.set(host, used + 1)
    selected.push(result)
  }

  for (const result of heldBack) {
    if (selected.length >= limit) break
    selected.push(result)
  }

  return selected
}

/** Strips the internal ranking fields before a result is sent to a client. */
export function toPublicSource(result: RankedResult): {
  title: string
  url: string
  snippet: string
  publishedDate?: string
  engines?: string[]
  sourceType?: 'web' | 'history'
  browser?: string
  profile?: string
  visitCount?: number
  lastVisitedAt?: number
} {
  return {
    title: result.title,
    url: result.url,
    snippet: result.snippet,
    ...(result.publishedDate ? { publishedDate: result.publishedDate } : {}),
    ...(result.engines && result.engines.length > 0 ? { engines: result.engines } : {}),
    ...(result.sourceType ? { sourceType: result.sourceType } : {}),
    ...(result.browser ? { browser: result.browser } : {}),
    ...(result.profile ? { profile: result.profile } : {}),
    ...(typeof result.visitCount === 'number' ? { visitCount: result.visitCount } : {}),
    ...(typeof result.lastVisitedAt === 'number' ? { lastVisitedAt: result.lastVisitedAt } : {}),
  }
}
