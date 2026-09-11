import { describe, expect, it } from 'bun:test'
import { CORRECTNESS_CORPUS } from './correctness-corpus'
import {
  canonicalizeUrl,
  dedupeWebResults,
  deriveAuthoritativeSourceSeeds,
  deriveDiscoveryQueries,
  deriveRepositoryReleaseSeeds,
  deriveLocalRetrievalQueries,
  derivePrimaryRetrievalQuery,
  projectReleaseSubject,
  deriveResearchSeedQueries,
  deriveRankingQueries,
  domainQuality,
  hostOf,
  mergeRankingQueries,
  queryRelevance,
  queryTokenCoverage,
  rankWebResults,
  recencyScore,
  selectDiversePack,
  selectFusedEvidence,
  tokenizeQuery,
  toPublicSource,
  type RankedSearchResult,
} from './retrieval'

const NOW = Date.parse('2026-01-01T00:00:00.000Z')

function result(partial: Partial<RankedSearchResult> & { url: string }): RankedSearchResult {
  return { title: partial.url, snippet: '', ...partial }
}

describe('canonicalizeUrl', () => {
  it('collapses scheme, www, default port, and trailing slash into one key', () => {
    const expected = canonicalizeUrl('https://example.com/guide')
    expect(canonicalizeUrl('http://example.com/guide')).toBe(expected)
    expect(canonicalizeUrl('https://www.example.com/guide')).toBe(expected)
    expect(canonicalizeUrl('https://example.com/guide/')).toBe(expected)
    expect(canonicalizeUrl('https://example.com:443/guide')).toBe(expected)
    expect(canonicalizeUrl('https://EXAMPLE.com/guide')).toBe(expected)
    expect(canonicalizeUrl('https://example.com/guide#section-3')).toBe(expected)
    expect(canonicalizeUrl('https://example.com//guide')).toBe(expected)
  })

  it('strips campaign parameters but preserves parameters that select content', () => {
    const bare = canonicalizeUrl('https://example.com/post')
    expect(canonicalizeUrl('https://example.com/post?utm_source=x&utm_medium=y')).toBe(bare)
    expect(canonicalizeUrl('https://example.com/post?fbclid=abc123')).toBe(bare)
    expect(canonicalizeUrl('https://example.com/post?gclid=xyz&mkt_tok=9')).toBe(bare)

    // A page selector is content, not tracking: these must stay distinct.
    expect(canonicalizeUrl('https://example.com/post?page=2')).not.toBe(bare)
    expect(canonicalizeUrl('https://example.com/post?id=7')).not.toBe(
      canonicalizeUrl('https://example.com/post?id=8')
    )
    // Deliberately conservative: bare `ref` and `source` may carry meaning.
    expect(canonicalizeUrl('https://example.com/post?ref=hn')).not.toBe(bare)
  })

  it('is insensitive to query parameter order', () => {
    expect(canonicalizeUrl('https://example.com/s?b=2&a=1')).toBe(canonicalizeUrl('https://example.com/s?a=1&b=2'))
  })

  it('normalizes index documents and the unambiguous amp parameter', () => {
    const bare = canonicalizeUrl('https://example.com/docs')
    expect(canonicalizeUrl('https://example.com/docs/index.html')).toBe(bare)
    expect(canonicalizeUrl('https://example.com/docs?amp=1')).toBe(bare)
    // A trailing /amp path segment is a real path: /docs/amp may be a page
    // about AMP, not an AMP mirror of /docs. Merging them would lose a source.
    expect(canonicalizeUrl('https://example.com/docs/amp')).not.toBe(bare)
  })

  it('normalizes host case but preserves path and query case', () => {
    // Hosts are case-insensitive; paths are not. Merging them would discard a
    // distinct document on a case-sensitive origin.
    expect(canonicalizeUrl('https://EXAMPLE.com/Guide')).toBe(canonicalizeUrl('https://example.com/Guide'))
    expect(canonicalizeUrl('https://example.com/Guide')).not.toBe(canonicalizeUrl('https://example.com/guide'))
    expect(canonicalizeUrl('https://example.com/s?Tab=A')).not.toBe(canonicalizeUrl('https://example.com/s?Tab=a'))
  })

  it('normalizes percent-encoding of unreserved characters', () => {
    expect(canonicalizeUrl('https://web.stanford.edu/%7Eouster/papers')).toBe(
      canonicalizeUrl('https://web.stanford.edu/~ouster/papers')
    )
  })

  it('keeps genuinely different documents apart', () => {
    expect(canonicalizeUrl('https://example.com/a')).not.toBe(canonicalizeUrl('https://example.com/b'))
    expect(canonicalizeUrl('https://a.example.com/x')).not.toBe(canonicalizeUrl('https://b.example.com/x'))
    expect(canonicalizeUrl('https://example.com/a')).not.toBe(canonicalizeUrl('https://example.org/a'))
  })

  it('never throws on malformed input', () => {
    expect(canonicalizeUrl('not a url')).toBe('not a url')
    expect(canonicalizeUrl('')).toBe('')
    expect(canonicalizeUrl('javascript:alert(1)')).toBe('javascript:alert(1)')
  })
})

describe('dedupeWebResults', () => {
  it('merges tracking-parameter and protocol variants of one page into one source', () => {
    const deduped = dedupeWebResults([
      result({ url: 'https://example.com/guide', title: 'Guide', snippet: 'short', rank: 1, engines: ['google'] }),
      result({ url: 'http://www.example.com/guide/?utm_source=news', title: 'Guide', snippet: 'a much longer snippet', rank: 3, engines: ['bing'] }),
      result({ url: 'https://example.com/guide#top', title: 'Guide', snippet: 'mid', rank: 2, engines: ['brave'] }),
    ])

    expect(deduped).toHaveLength(1)
    expect(deduped[0].mergedCount).toBe(3)
    expect(deduped[0].engines?.sort()).toEqual(['bing', 'brave', 'google'])
    expect(deduped[0].rank).toBe(1)
    // The longest snippet survives: more evidence text grounds the prompt better.
    expect(deduped[0].snippet).toBe('a much longer snippet')
    // The first-seen URL is preserved verbatim for display.
    expect(deduped[0].url).toBe('https://example.com/guide')
  })

  it('merges identical titles on one host but keeps independent hosts apart', () => {
    const deduped = dedupeWebResults([
      result({ url: 'https://news.example.com/2026/01/story', title: 'Reactor Goes Critical' }),
      result({ url: 'https://news.example.com/amp/story-reprint', title: 'Reactor  goes   critical!' }),
      result({ url: 'https://other.example.org/story', title: 'Reactor Goes Critical' }),
    ])

    expect(deduped).toHaveLength(2)
    expect(deduped.map((r) => hostOf(r.url))).toEqual(['news.example.com', 'other.example.org'])
  })

  it('preserves private history provenance regardless of duplicate arrival order', () => {
    const publicResult = result({
      url: 'https://example.com/shared-page',
      title: 'Shared page',
      snippet: 'Public search snippet.',
      sourceType: 'web',
      engines: ['searxng'],
    })
    const historyResult = result({
      url: 'https://www.example.com/shared-page/',
      title: 'Shared page',
      snippet: 'Privately imported from chrome.',
      sourceType: 'history',
      browser: 'chrome',
      profile: 'Default',
      visitCount: 7,
      lastVisitedAt: NOW - 1000,
      engines: ['browser-history-fts5'],
    })

    for (const input of [[publicResult, historyResult], [historyResult, publicResult]]) {
      const [merged] = dedupeWebResults(input)
      expect(merged.sourceType).toBe('history')
      expect(merged.browser).toBe('chrome')
      expect(merged.profile).toBe('Default')
      expect(merged.visitCount).toBe(7)
      expect(merged.lastVisitedAt).toBe(NOW - 1000)
      expect(merged.engines?.sort()).toEqual(['browser-history-fts5', 'searxng'])
    }
  })

  it('preserves input order for results that do not collapse', () => {
    const deduped = dedupeWebResults([
      result({ url: 'https://a.com/1', title: 'A' }),
      result({ url: 'https://b.com/2', title: 'B' }),
      result({ url: 'https://c.com/3', title: 'C' }),
    ])
    expect(deduped.map((r) => r.title)).toEqual(['A', 'B', 'C'])
  })

  it('unions originating ranking queries when branches discover one page', () => {
    const deduped = dedupeWebResults([
      result({
        url: 'https://example.com/evidence',
        title: 'Evidence',
        rankingQueries: ['gap benchmark', 'branch alpha'],
      }),
      result({
        url: 'http://www.example.com/evidence?utm_source=test',
        title: 'Evidence',
        rankingQueries: ['branch alpha', 'branch beta'],
      }),
    ])

    expect(deduped).toHaveLength(1)
    expect(deduped[0].rankingQueries).toEqual([
      'branch alpha',
      'branch beta',
      'gap benchmark',
    ])
  })
})

describe('ranking signals', () => {
  it('tokenizeQuery drops stopwords and single characters', () => {
    expect(tokenizeQuery('What is the SQLite WAL mode')).toEqual(['sqlite', 'wal', 'mode'])
  })

  it('keeps semantic versions intact and normalizes a leading v', () => {
    expect(tokenizeQuery('Bun v1.3.10 versus 1.3.9')).toEqual([
      'bun', '1_3_10', 'versus', '1_3_9',
    ])
  })

  it('derives additive subject variants without replacing the original query', () => {
    const verbose = 'Who is Marisol Venn? Give her current position and cite both web and vault sources.'
    const variants = deriveRankingQueries(verbose)

    expect(variants[0]).toBe(verbose)
    expect(variants).toContain('Who is Marisol Venn')
    expect(derivePrimaryRetrievalQuery(verbose)).toBe('Who is Marisol Venn')
  })

  it('preserves the complete long corpus query when a comparison names a quoted clipping', () => {
    const corpusQuery = CORRECTNESS_CORPUS.find(
      (entry) => entry.id === 'fusion-anthropic-agents'
    )?.query

    expect(corpusQuery).toBeDefined()
    expect(derivePrimaryRetrievalQuery(corpusQuery ?? '')).toBe(corpusQuery)
    expect(derivePrimaryRetrievalQuery('Find “Building effective agents.md”')).toBe(
      'Building effective agents'
    )
    expect(deriveLocalRetrievalQueries(corpusQuery ?? '')).toEqual([
      'Building effective agents anthropic workflow versus agent distinction',
      'Building effective agents five workflow patterns',
      'Building effective agents advise adding agentic complexity',
    ])
    expect(deriveLocalRetrievalQueries('Find “Building effective agents.md”')).toEqual([
      'Building effective agents',
    ])
  })

  it('extracts quoted titles, repository handles, versions, and HTTP status anchors', () => {
    const variants = deriveRankingQueries(
      'Compare "Building effective agents" with iowarp/clio-coder and Bun 1.3.10. Is Retry-After required for 429 under RFC 9110?'
    )
    expect(variants).toContain('Building effective agents')
    expect(variants).toContain('iowarp/clio-coder')
    expect(variants).toContain('Bun 1.3.10')
    expect(variants).toContain('Retry-After')
    expect(variants).toContain('Retry-After 429')
    expect(variants).toContain('rfc9110')
  })

  it('admits an official RFC by its exact document identifier', () => {
    const ranked = rankWebResults('What does RFC 9110 say about Retry-After with 503?', [
      result({
        url: 'https://www.rfc-editor.org/rfc/rfc9110.html',
        title: 'RFC 9110: HTTP Semantics',
        snippet: 'Internet Standard maintained by the RFC Editor.',
        rank: 8,
        engines: ['bing'],
      }),
    ], NOW)
    const selected = selectFusedEvidence(ranked, [], { limit: 18 })

    expect(ranked[0].queryCoverage).toBe(1)
    expect(ranked[0].queryTermCount).toBe(1)
    expect(selected.web[0]?.url).toBe('https://www.rfc-editor.org/rfc/rfc9110.html')
  })

  it('keeps network discovery bounded while adding high-precision clauses', () => {
    expect(deriveDiscoveryQueries('How do SQLite WAL checkpoints work?', 3, true)).toEqual([
      'How do SQLite WAL checkpoints work?',
      'sqlite wal checkpoints work',
    ])
    expect(deriveDiscoveryQueries('who is Bogdan Nicolae?')).toEqual([
      'who is Bogdan Nicolae?',
      'Bogdan Nicolae official biography',
      'Bogdan Nicolae profile affiliation',
    ])
    const normative = deriveDiscoveryQueries(
      'Is Retry-After required with 429 Too Many Requests? May Retry-After be sent with 503 Service Unavailable?'
    )
    expect(normative).toHaveLength(3)
    expect(normative[0]).toContain('429')
    expect(normative[0]).toContain('503')
    expect(normative[1]).toBe('Retry-After 429 RFC 6585')
    expect(normative[2]).toBe('Retry-After 503 RFC 9110')

    const release = deriveDiscoveryQueries(
      'As of 2026-08-28, what is the latest stable Bun release? Verify the Bun post and oven-sh/bun releases.'
    )
    expect(release).toEqual([
      'As of 2026-08-28, what is the latest stable Bun release? Verify the Bun post and oven-sh/bun releases.',
      'Bun latest stable release 2026 official',
      'oven-sh/bun releases stable 2026',
    ])
    expect(derivePrimaryRetrievalQuery(
      'What does RFC 6585 say? Quote MUST/SHOULD/MAY precisely.'
    )).toBe('What does RFC 6585 say')
    expect(derivePrimaryRetrievalQuery(
      'Compare fixed/token windows across build/query latency and index cost.'
    )).not.toBe('fixed/token')
  })

  it('preserves misspelled person queries while adding biography and affiliation searches', () => {
    expect(deriveDiscoveryQueries('ho is Marina Stavrakantonaki')).toEqual([
      'ho is Marina Stavrakantonaki',
      'Marina Stavrakantonaki official biography',
      'Marina Stavrakantonaki profile affiliation',
    ])
  })

  it('resolves Retry-After status questions to bounded official RFC identities', () => {
    expect(deriveAuthoritativeSourceSeeds('Is Retry-After required for 429 and allowed for 503?'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ url: 'https://www.rfc-editor.org/info/rfc6585/' }),
        expect.objectContaining({ url: 'https://www.rfc-editor.org/rfc/rfc9110.html' }),
      ]))
    expect(deriveAuthoritativeSourceSeeds('How do SQLite checkpoints work?')).toEqual([])
  })

  it('resolves frozen latest-stable Bun verification to both first-party records', () => {
    const query = 'As of 2026-08-28, what is the latest stable Bun release? Verify the Bun post and oven-sh/bun releases.'
    const seeds = deriveAuthoritativeSourceSeeds(query)

    expect(seeds).toEqual([
      expect.objectContaining({
        title: 'Bun v1.4 | Bun Blog',
        url: 'https://bun.com/blog/bun-v1.4',
        engines: ['authoritative-direct'],
      }),
      expect.objectContaining({
        title: 'Releases · oven-sh/bun',
        url: 'https://github.com/oven-sh/bun/releases',
        engines: ['authoritative-direct'],
      }),
    ])

    const selected = selectFusedEvidence(rankWebResults(query, seeds, NOW), [], { limit: 12 })
    expect(selected.web).toHaveLength(2)
    expect(selected.web.map((candidate) => candidate.url)).toEqual(expect.arrayContaining([
      'https://bun.com/blog/bun-v1.4',
      'https://github.com/oven-sh/bun/releases',
    ]))
  })

  it('does not seed frozen Bun records for unrelated release questions', () => {
    expect(deriveAuthoritativeSourceSeeds('What changed in Bun 1.3.10?')).toEqual([])
    expect(deriveAuthoritativeSourceSeeds('What is the latest stable Node.js release?')).toEqual([])
    expect(deriveAuthoritativeSourceSeeds('How do I install Bun?')).toEqual([])
  })

  it('resolves chunking research to Chroma’s exact first-party report', () => {
    expect(deriveAuthoritativeSourceSeeds(
      'Compare chunking strategies for retrieval quality in a Markdown vault.'
    )).toEqual([
      expect.objectContaining({
        title: 'Evaluating Chunking Strategies for Retrieval | Chroma',
        url: 'https://www.trychroma.com/research/evaluating-chunking',
        engines: ['authoritative-direct'],
      }),
    ])
    expect(deriveAuthoritativeSourceSeeds('Compare Markdown parsers and renderers.')).toEqual([])
  })

  it('reserves bounded primary-source seeds for named deep-research methods', () => {
    expect(deriveResearchSeedQueries(
      'Compare fixed windows, semantic chunking, and late chunking for retrieval quality.'
    )).toEqual([
      '"Late Chunking" original paper arXiv',
      'Chroma evaluation token level precision recall intersection over union Jaccard',
    ])
    expect(deriveResearchSeedQueries('Research SQLite WAL behavior')).toEqual([])
  })

  it('queryRelevance rewards title matches over snippet matches', () => {
    const inTitle = queryRelevance('sqlite wal mode', result({ url: 'https://x.com/a', title: 'SQLite WAL mode explained', snippet: 'unrelated text' }))
    const inSnippet = queryRelevance('sqlite wal mode', result({ url: 'https://x.com/a', title: 'unrelated text', snippet: 'SQLite WAL mode explained' }))
    expect(inTitle).toBeGreaterThan(inSnippet)
    expect(queryRelevance('sqlite wal mode', result({ url: 'https://x.com/a', title: 'cake recipes', snippet: 'flour' }))).toBe(0)
  })

  it('rewards complete entity coverage over a partial name collision', () => {
    const official = result({
      url: 'https://directory.example.edu/people/marisol-venn',
      title: 'Marisol Venn | Example University',
      snippet: 'Marisol Venn is a faculty member at Example University.',
    })
    const partial = result({
      url: 'https://en.wikipedia.org/wiki/Marisol_Canto',
      title: 'Marisol Canto',
      snippet: 'Marisol Canto is a fictional radio personality.',
    })

    expect(queryTokenCoverage('who is Marisol Venn', official)).toBe(1)
    expect(queryTokenCoverage('who is Marisol Venn', partial)).toBe(0.5)
    expect(queryRelevance('who is Marisol Venn', official)).toBeGreaterThan(
      queryRelevance('who is Marisol Venn', partial) * 3
    )
    const reversed = result({
      url: 'https://example.org/venn-marisol',
      title: 'Venn Marisol',
      snippet: 'Venn Marisol is a different person.',
    })
    expect(queryRelevance('who is Marisol Venn', official)).toBeGreaterThan(
      queryRelevance('who is Marisol Venn', reversed)
    )
  })

  it('matches simple inflections without treating substrings as query terms', () => {
    expect(queryTokenCoverage(
      'coder dependencies',
      result({
        url: 'https://example.com/project',
        title: 'Coder dependency guide',
        snippet: '',
      })
    )).toBe(1)
    expect(queryTokenCoverage(
      'coder dependencies',
      result({
        url: 'https://example.com/ai',
        title: 'Encoder dependency guide',
        snippet: '',
      })
    )).toBe(0.5)
  })

  it('rewards a compact entity window even when display order is reversed', () => {
    const close = queryRelevance(
      'Marisol Venn',
      result({
        url: 'https://example.com/profile',
        title: 'Venn, Dr. Marisol — profile',
        snippet: '',
      })
    )
    const farApart = queryRelevance(
      'Marisol Venn',
      result({
        url: 'https://example.com/directory',
        title: 'Marisol and several unrelated directory entries before Venn',
        snippet: '',
      })
    )
    expect(close).toBeGreaterThan(farApart)
  })

  it('recencyScore decays with a one-year half-life and ignores missing dates', () => {
    expect(recencyScore(undefined, NOW)).toBe(0)
    expect(recencyScore('not a date', NOW)).toBe(0)
    expect(recencyScore('2026-01-01T00:00:00.000Z', NOW)).toBeCloseTo(1, 2)
    expect(recencyScore('2025-01-01T00:00:00.000Z', NOW)).toBeCloseTo(0.5, 1)
    expect(recencyScore('2023-01-01T00:00:00.000Z', NOW)).toBeLessThan(0.3)
  })

  it('domainQuality separates primary sources from scrapers', () => {
    expect(domainQuality('https://en.wikipedia.org/wiki/X')).toBe(1)
    expect(domainQuality('https://arxiv.org/abs/1234')).toBe(1)
    expect(domainQuality('https://cs.stanford.edu/page')).toBe(1)
    expect(domainQuality('https://www.pinterest.com/pin/1')).toBe(-1)
    expect(domainQuality('https://coursehero.com/file/1')).toBe(-1)
    expect(domainQuality('https://some-blog.example.com/post')).toBe(0)
  })
})

describe('rankWebResults', () => {
  it('admits canonical named-header documentation without requiring every scenario term', () => {
    const query = 'http 429 too many requests retry after header'
    const ranked = rankWebResults(query, [
      result({
        url: 'https://stackoverflow.com/questions/1/429-handling',
        title: 'Handling 429 responses with backoff',
        snippet: 'How should a client honour Retry-After when it receives 429?',
        rank: 9,
        engines: ['google'],
      }),
      result({
        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After',
        title: 'Retry-After',
        snippet: 'The Retry-After response HTTP header indicates how long to wait before making a follow-up request.',
        rank: 5,
        engines: ['bing'],
      }),
    ], NOW)

    expect(ranked.map((candidate) => candidate.url)).toEqual([
      'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After',
      'https://stackoverflow.com/questions/1/429-handling',
    ])
    expect(ranked[0].queryCoverage).toBe(1)
    expect(ranked[0].queryTermCount).toBe(2)
  })

  it('admits exact entity evidence for a verbose answer-format prompt', () => {
    const query = 'Who is Marisol Venn? Give her current position, institution, and primary research projects. Cite both web and vault sources, and flag any conflicting information.'
    const ranked = rankWebResults(query, [
      result({
        url: 'https://scholar.google.com/citations?user=example',
        title: 'Marisol Venn - Scholar profile',
        snippet: 'Associate Director of Example Research Center at Example University.',
        rank: 3,
        engines: ['google'],
      }),
      result({
        url: 'https://en.wikipedia.org/wiki/Marisol',
        title: 'Marisol',
        snippet: 'Marisol is a given name.',
        rank: 1,
        engines: ['bing'],
      }),
    ], NOW)
    const selected = selectFusedEvidence(ranked, [], { limit: 18 })

    expect(selected.web.map((candidate) => candidate.url)).toEqual([
      'https://scholar.google.com/citations?user=example',
    ])
    expect(selected.web[0].queryTermCount).toBe(2)
  })

  it('uses the exact semantic version variant for release-note admission', () => {
    const query = 'What changed in Bun 1.3.10 compared with Bun 1.3.9? Prefer official release notes and distinguish documented changes from inference.'
    const ranked = rankWebResults(query, [
      result({
        url: 'https://bun.com/blog/bun-v1.3.10',
        title: 'Bun v1.3.10 | Bun Blog',
        snippet: 'Bun v1.3.10 reduces bundled output overhead and adds --retry for bun test.',
        rank: 2,
        engines: ['google', 'brave'],
      }),
      result({
        url: 'https://example.com/bun-test',
        title: 'Blood urea nitrogen test',
        snippet: 'A medical BUN test guide.',
        rank: 1,
        engines: ['bing'],
      }),
    ], NOW)
    const selected = selectFusedEvidence(ranked, [], { limit: 18 })

    expect(ranked[0].url).toBe('https://bun.com/blog/bun-v1.3.10')
    expect(ranked[0].queryCoverage).toBe(1)
    expect(ranked[0].queryTermCount).toBe(2)
    expect(selected.web.map((candidate) => candidate.url)).toEqual([
      'https://bun.com/blog/bun-v1.3.10',
    ])
  })

  it('promotes a relevant lower-ranked result over an irrelevant top hit', () => {
    const ranked = rankWebResults('sqlite wal concurrency', [
      result({ url: 'https://spam.example.com/x', title: 'Buy cheap flights', snippet: 'deals', rank: 1 }),
      result({ url: 'https://sqlite.org/wal.html', title: 'SQLite WAL concurrency', snippet: 'Readers and writers proceed concurrently.', rank: 5 }),
    ], NOW)

    expect(ranked[0].url).toBe('https://sqlite.org/wal.html')
  })

  it('neutralizes recency bonus and rank prior for history results (KIX-04)', () => {
    const webResult = result({
      url: 'https://docs.example.com/topic',
      title: 'Documentation on topic',
      snippet: 'Guide to topic and architecture.',
      rank: 1,
      publishedDate: new Date(NOW).toISOString(),
      sourceType: 'web',
    })
    const historyResult = result({
      url: 'https://history.example.com/topic',
      title: 'Documentation on topic',
      snippet: 'Guide to topic and architecture.',
      rank: 1,
      publishedDate: new Date(NOW).toISOString(),
      sourceType: 'history',
    })
    const ranked = rankWebResults('topic', [webResult, historyResult], NOW)
    const rankedWeb = ranked.find((r) => r.url === webResult.url)!
    const rankedHistory = ranked.find((r) => r.url === historyResult.url)!

    expect(rankedWeb.relevanceScore).toBeGreaterThan(rankedHistory.relevanceScore)
  })

  it('is order-independent: shuffled input yields the same ranking', () => {
    const input = [
      result({ url: 'https://a.example.com/1', title: 'alpha topic', snippet: 'alpha', rank: 1 }),
      result({ url: 'https://b.example.com/2', title: 'beta topic', snippet: 'beta', rank: 2 }),
      result({ url: 'https://c.example.com/3', title: 'gamma topic', snippet: 'gamma', rank: 3 }),
      result({ url: 'https://d.example.com/4', title: 'delta topic', snippet: 'delta', rank: 4 }),
    ]
    const forward = rankWebResults('topic', input, NOW).map((r) => r.url)
    const reversed = rankWebResults('topic', [...input].reverse(), NOW).map((r) => r.url)
    expect(reversed).toEqual(forward)
  })

  it('rewards cross-engine agreement', () => {
    const ranked = rankWebResults('kubernetes ingress', [
      result({ url: 'https://one.example.com/a', title: 'kubernetes ingress guide', snippet: 'ingress', rank: 2, engines: ['google'] }),
      result({ url: 'https://two.example.com/b', title: 'kubernetes ingress guide', snippet: 'ingress', rank: 2, engines: ['google'] }),
      result({ url: 'http://www.two.example.com/b?utm_source=x', title: 'kubernetes ingress guide', snippet: 'ingress', rank: 2, engines: ['bing'] }),
      result({ url: 'https://two.example.com/b/', title: 'kubernetes ingress guide', snippet: 'ingress', rank: 2, engines: ['brave'] }),
    ], NOW)

    expect(ranked).toHaveLength(2)
    expect(ranked[0].url).toBe('https://two.example.com/b')
    expect(ranked[0].engines).toHaveLength(3)
  })

  it('does not inflate engine agreement bonus when multiple branches return the same engine (KIX-12)', () => {
    const ranked = rankWebResults('kubernetes ingress', [
      result({ url: 'https://one.example.com/a', title: 'kubernetes ingress guide', snippet: 'ingress', rank: 2, engines: ['bing'], mergedCount: 3 }),
      result({ url: 'https://two.example.com/b', title: 'kubernetes ingress guide', snippet: 'ingress', rank: 2, engines: ['bing'], mergedCount: 1 }),
    ], NOW)

    expect(ranked).toHaveLength(2)
    expect(ranked[0].relevanceScore).toBe(ranked[1].relevanceScore)
  })

  it('pins primary query as element 0 in mergeRankingQueries regardless of alphabetization (KIX-11)', () => {
    const primaryQuery = 'zzz primary query'
    const otherQueries = Array.from({ length: 20 }, (_, i) => `aaa query branch ${String(i).padStart(2, '0')}`)
    const merged = mergeRankingQueries(primaryQuery, otherQueries)
    expect(merged).toBeDefined()
    expect(merged![0]).toBe('zzz primary query')
    expect(merged!.length).toBeLessThanOrEqual(16)
  })

  it('produces a stable score independent of a missing rank field', () => {
    const ranked = rankWebResults('x', [result({ url: 'https://a.com/1', title: 'x' })], NOW)
    expect(Number.isFinite(ranked[0].relevanceScore)).toBe(true)
  })

  it('uses saved-host preference to break a relevant near-tie', () => {
    const input = [
      result({ url: 'https://a.example.com/guide', title: 'SQLite WAL guide', snippet: 'SQLite WAL guide', rank: 2 }),
      result({ url: 'https://z.example.com/guide', title: 'SQLite WAL guide', snippet: 'SQLite WAL guide', rank: 2 }),
    ]

    const baseline = rankWebResults('sqlite wal', input, NOW)
    const personalized = rankWebResults(
      'sqlite wal',
      input,
      NOW,
      new Map([['z.example.com', 5]])
    )

    expect(baseline[0].url).toBe('https://a.example.com/guide')
    expect(personalized[0].url).toBe('https://z.example.com/guide')
  })

  it('does not let rank or domain authority rescue a partial entity collision', () => {
    const ranked = rankWebResults('who is Marisol Venn', [
      result({
        url: 'https://en.wikipedia.org/wiki/Marisol_Canto',
        title: 'Marisol Canto',
        snippet: 'Marisol Canto is a fictional radio personality.',
        rank: 1,
        engines: ['google', 'bing', 'brave'],
      }),
      result({
        url: 'https://directory.example.edu/people/marisol-venn',
        title: 'Marisol Venn | Example University',
        snippet: 'Marisol Venn is a faculty member at Example University.',
        rank: 8,
        engines: ['google'],
      }),
    ], NOW)

    expect(ranked[0].url).toBe('https://directory.example.edu/people/marisol-venn')
    expect(ranked[0].queryCoverage).toBe(1)
    expect(ranked[0].queryTermCount).toBe(2)
    expect(ranked[1].queryCoverage).toBe(0)
    expect(ranked[1].queryTermCount).toBe(2)

    const admitted = selectFusedEvidence(ranked, [], { limit: 18 })
    expect(admitted.web.map((candidate) => candidate.url)).toEqual([
      'https://directory.example.edu/people/marisol-venn',
    ])
    expect(admitted.counts.usableWeb).toBe(1)
    expect(admitted.counts.rejectedWeb).toBe(1)
  })

  it('admits a gap result using its originating branch query', () => {
    const rootQuery = 'distributed storage architecture overview'
    const gapUrl = 'https://arxiv.org/abs/9999.00001'
    const ranked = rankWebResults(rootQuery, [
      result({
        url: gapUrl,
        title: 'Decisive missing benchmark results',
        snippet: 'The decisive missing benchmark reports measured numbers.',
        rank: 8,
        rankingQueries: ['decisive missing benchmark'],
      }),
      result({
        url: 'https://example.com/root',
        title: 'Distributed storage architecture overview',
        snippet: 'A general architecture overview.',
        rank: 1,
        rankingQueries: ['branch overview'],
      }),
    ], NOW)

    const gapResult = ranked.find((candidate) => candidate.url === gapUrl)!
    expect(queryTokenCoverage(rootQuery, gapResult)).toBe(0)
    expect(gapResult.queryCoverage).toBe(1)
    expect(gapResult.relevanceScore).toBeGreaterThan(0.9)

    const selected = selectFusedEvidence(ranked, [], { limit: 18 })
    expect(selected.web.some((candidate) => candidate.url === gapUrl)).toBe(true)
    expect(selected.counts.usableWeb).toBe(2)
  })
})

describe('selectDiversePack', () => {
  it('caps how many slots one host may occupy', () => {
    const ranked = [
      { url: 'https://hog.com/1' }, { url: 'https://hog.com/2' }, { url: 'https://hog.com/3' },
      { url: 'https://hog.com/4' }, { url: 'https://hog.com/5' }, { url: 'https://other.com/1' },
    ]
    const pack = selectDiversePack(ranked, 4)
    expect(pack.map((r) => r.url)).toEqual([
      'https://hog.com/1', 'https://hog.com/2', 'https://hog.com/3', 'https://other.com/1',
    ])
  })

  it('backfills from held-back results rather than returning a short pack', () => {
    const ranked = [
      { url: 'https://hog.com/1' }, { url: 'https://hog.com/2' },
      { url: 'https://hog.com/3' }, { url: 'https://hog.com/4' },
    ]
    // Only one host exists, so the cap must not starve the prompt.
    expect(selectDiversePack(ranked, 4)).toHaveLength(4)
  })

  it('treats www and bare host as the same publisher', () => {
    const pack = selectDiversePack(
      [
        { url: 'https://news.com/1' }, { url: 'https://www.news.com/2' },
        { url: 'https://news.com/3' }, { url: 'https://news.com/4' },
        { url: 'https://indie.com/1' },
      ],
      4
    )
    expect(pack.map((r) => r.url)).toContain('https://indie.com/1')
  })

  it('returns an empty pack for a non-positive limit', () => {
    expect(selectDiversePack([{ url: 'https://a.com' }], 0)).toEqual([])
  })
})

describe('selectFusedEvidence', () => {
  const web = (
    url: string,
    relevanceScore: number,
    queryCoverage = 1,
    queryTermCount = 1
  ) => ({
    title: url,
    url,
    snippet: '',
    canonicalUrl: canonicalizeUrl(url),
    relevanceScore,
    queryCoverage,
    queryTermCount,
    mergedCount: 1,
  })
  const local = (
    filePath: string,
    normalizedScore: number,
    startLine = 1,
    queryCoverage?: number,
    queryTermCount?: number
  ) => ({
    filePath,
    startLine,
    normalizedScore,
    ...(queryCoverage == null ? {} : { queryCoverage }),
    ...(queryTermCount == null ? {} : { queryTermCount }),
  })

  it('lets an exact vault match displace weak web evidence', () => {
    const selected = selectFusedEvidence(
      [web('https://weak.example.com/page', 0.8)],
      [local('/vault/exact.md', 1)],
      { limit: 1 }
    )
    expect(selected.web).toEqual([])
    expect(selected.local.map((item) => item.filePath)).toEqual(['/vault/exact.md'])
  })

  it('keeps near-maximum authoritative web evidence above a relative local maximum', () => {
    const selected = selectFusedEvidence(
      [web('https://sqlite.org/wal.html', 5.5)],
      [local('/vault/tangential.md', 1)],
      { limit: 1 }
    )
    expect(selected.web.map((item) => item.url)).toEqual(['https://sqlite.org/wal.html'])
    expect(selected.local).toEqual([])
  })

  it('fills the budget when only one source kind is available', () => {
    const webOnly = selectFusedEvidence(
      [web('https://a.example/1', 4), web('https://b.example/2', 3)],
      [],
      { limit: 2 }
    )
    const localOnly = selectFusedEvidence(
      [],
      [local('/vault/a.md', 1), local('/vault/b.md', 0.8)],
      { limit: 2 }
    )
    expect(webOnly.web).toHaveLength(2)
    expect(localOnly.local).toHaveLength(2)
  })

  it('is invariant to candidate arrival order', () => {
    const webCandidates = [
      web('https://b.example/2', 3.1),
      web('https://a.example/1', 4.2),
    ]
    const localCandidates = [
      local('/vault/b.md', 0.75),
      local('/vault/a.md', 1),
    ]
    const key = (selection: ReturnType<typeof selectFusedEvidence>) =>
      selection.ordered.map((item) => item.kind === 'web' ? item.source.url : item.source.filePath)
    const forward = selectFusedEvidence(webCandidates, localCandidates, { limit: 3 })
    const reversed = selectFusedEvidence(
      [...webCandidates].reverse(),
      [...localCandidates].reverse(),
      { limit: 3 }
    )
    expect(key(reversed)).toEqual(key(forward))
  })

  it('applies host and file diversity before backfilling', () => {
    const selected = selectFusedEvidence(
      [
        web('https://hog.example/1', 5),
        web('https://hog.example/2', 4.9),
        web('https://other.example/1', 3),
      ],
      [
        local('/vault/hog.md', 1, 1),
        local('/vault/hog.md', 0.95, 10),
        local('/vault/other.md', 0.7, 1),
      ],
      { limit: 4, maxPerHost: 1, maxPerFile: 1 }
    )
    expect(selected.web.some((item) => item.url === 'https://other.example/1')).toBe(true)
    expect(selected.local.some((item) => item.filePath === '/vault/other.md')).toBe(true)
  })

  it('prefers a distinct passage over a substantially overlapping chunk', () => {
    const selected = selectFusedEvidence(
      [],
      [
        { ...local('/vault/note.md', 1, 1), endLine: 40 },
        { ...local('/vault/note.md', 0.95, 35), endLine: 48 },
        { ...local('/vault/note.md', 0.9, 49), endLine: 60 },
      ],
      { limit: 2, maxPerFile: 3 }
    )

    expect(selected.local.map((item) => item.startLine)).toEqual([1, 49])
  })

  it('uses native ranks instead of comparing web scores with vault BM25 normalization', () => {
    const webCandidates = Array.from({ length: 18 }, (_, index) =>
      web(`https://web-${index + 1}.example/result`, 3.25 - index * 0.08)
    )
    const localCandidates = Array.from({ length: 18 }, (_, index) =>
      local(
        `/vault/chunk-${index + 1}.md`,
        1 - index * 0.025,
        1,
        index === 0 ? 1 : index === 1 ? 0.75 : 0.25
      )
    )

    const selected = selectFusedEvidence(webCandidates, localCandidates, { limit: 18 })

    // This is the real failure shape: every local score is numerically higher
    // than a normalized real-world web score. Rank fusion keeps the useful web
    // stream and rejects vault chunks that matched only boilerplate/query noise.
    expect(selected.web).toHaveLength(16)
    expect(selected.local).toHaveLength(2)
    expect(selected.web[0].url).toBe('https://web-1.example/result')
    expect(selected.counts).toEqual({
      candidateWeb: 18,
      candidateLocal: 18,
      usableWeb: 18,
      usableLocal: 2,
      rejectedWeb: 0,
      rejectedLocal: 16,
      selectedWeb: 16,
      selectedLocal: 2,
    })
    expect(selected.ordered.find((item) => item.kind === 'web')?.fusionScore)
      .toBeCloseTo(1 / 61, 8)
  })

  it('does not pad a thin pack with candidates that fail relevance admission', () => {
    const selected = selectFusedEvidence(
      [web('https://irrelevant.example/page', 0.4)],
      [
        local('/vault/relative-best-but-noisy.md', 1, 1, 0.25),
        local('/vault/low-relative-score.md', 0.2, 1, 1),
      ],
      { limit: 18 }
    )

    expect(selected.ordered).toEqual([])
    expect(selected.counts.usableWeb).toBe(0)
    expect(selected.counts.usableLocal).toBe(0)
    expect(selected.counts.rejectedWeb).toBe(1)
    expect(selected.counts.rejectedLocal).toBe(2)
  })

  it('uses the retriever term-count floor for a relevant longer vault query', () => {
    const knownQueryShape = selectFusedEvidence(
      [],
      [local('/vault/sqlite-wal.md', 1, 1, 0.38, 4)],
      { limit: 1 }
    )
    const legacyUnknownShape = selectFusedEvidence(
      [],
      [local('/vault/sqlite-wal.md', 1, 1, 0.38)],
      { limit: 1 }
    )

    expect(knownQueryShape.local).toHaveLength(1)
    expect(legacyUnknownShape.local).toEqual([])
  })

  it('reserves a slot only for an admitted source kind', () => {
    const selected = selectFusedEvidence(
      Array.from({ length: 6 }, (_, index) =>
        web(`https://web-${index}.example/page`, 4 - index * 0.1)
      ),
      [
        local('/vault/admitted.md', 0.9, 1, 1),
        local('/vault/rejected.md', 1, 1, 0.1),
      ],
      { limit: 3, webWeight: 10, localWeight: 0.01 }
    )

    expect(selected.web).toHaveLength(2)
    expect(selected.local.map((item) => item.filePath)).toEqual(['/vault/admitted.md'])
    expect(selected.counts.rejectedLocal).toBe(1)
  })

  it('fills an offline pack from one admitted kind without forcing a quota', () => {
    const selected = selectFusedEvidence(
      [],
      Array.from({ length: 8 }, (_, index) =>
        local(`/vault/relevant-${index}.md`, 1 - index * 0.05, 1, 0.8)
      ),
      { limit: 8 }
    )

    expect(selected.web).toEqual([])
    expect(selected.local).toHaveLength(8)
    expect(selected.counts.selectedLocal).toBe(8)
  })

  it('excludes metadataOnly chunks from citable local evidence (KIX-03)', () => {
    const selected = selectFusedEvidence(
      [],
      [
        { filePath: '/vault/real.md', score: 1.0, normalizedScore: 1.0, queryCoverage: 1.0, queryTermCount: 2, metadataOnly: false },
        { filePath: '/vault/stub.pdf', score: 1.0, normalizedScore: 1.0, queryCoverage: 1.0, queryTermCount: 2, metadataOnly: true },
      ],
      { limit: 5 }
    )

    expect(selected.local.map((item) => item.filePath)).toEqual(['/vault/real.md'])
  })

  it('weighted stream allocation does not force 9/9 50/50 alternation (KIX-06)', () => {
    const webCandidates = Array.from({ length: 18 }, (_, index) =>
      web(`https://web-${index + 1}.example/result`, 3.5 - index * 0.05)
    )
    const localCandidates = Array.from({ length: 18 }, (_, index) =>
      local(`/vault/chunk-${index + 1}.md`, 1 - index * 0.02, 1, 0.9)
    )

    const selected = selectFusedEvidence(webCandidates, localCandidates, {
      limit: 18,
      webWeight: 1,
      localWeight: 0.92,
    })

    expect(selected.web.length).toBeGreaterThan(selected.local.length)
    expect(selected.web.length).not.toBe(9)
  })

  it('keeps passage overlap check active across widening diversity tiers (KIX-07)', () => {
    const overlappingLocal = Array.from({ length: 10 }, (_, index) => ({
      ...local('/vault/crowded.md', 1 - index * 0.01, 1),
      startLine: 1 + index * 2,
      endLine: 40,
    }))
    const otherLocal = local('/vault/other.md', 0.8, 1)

    const selected = selectFusedEvidence([], [...overlappingLocal, otherLocal], {
      limit: 10,
      maxPerFile: 2,
    })

    expect(selected.local).toHaveLength(2)
    expect(selected.local.filter((c) => c.filePath === '/vault/crowded.md')).toHaveLength(1)
  })
})

describe('toPublicSource', () => {
  it('emits only client-facing fields', () => {
    const [ranked] = rankWebResults('x', [
      result({ url: 'https://a.com/1', title: 'x', snippet: 's', rank: 1, engines: ['google'], publishedDate: '2025-06-01' }),
    ], NOW)
    const publicSource = toPublicSource(ranked)
    expect(Object.keys(publicSource).sort()).toEqual(['engines', 'publishedDate', 'snippet', 'title', 'url'])
    expect('canonicalUrl' in publicSource).toBe(false)
    expect('relevanceScore' in publicSource).toBe(false)
  })

  it('omits optional fields the engines did not supply', () => {
    const [ranked] = rankWebResults('x', [result({ url: 'https://a.com/1', title: 'x', snippet: 's' })], NOW)
    expect(Object.keys(toPublicSource(ranked)).sort()).toEqual(['snippet', 'title', 'url'])
  })
})

describe('named project release retrieval', () => {
  it('keeps the project identity when the question also asks about generic features', () => {
    const query = 'latest on clio-coder release and features'
    expect(deriveRankingQueries(query)).not.toContain('features')
    expect(derivePrimaryRetrievalQuery(query)).toBe('clio-coder')
    expect(deriveDiscoveryQueries(query).every((q) => q.includes('clio-coder'))).toBe(true)
    const ranked = rankWebResults(query, [
      result({ url: 'https://github.com/iowarp/clio-coder/releases', title: 'Clio Coder releases', snippet: 'Release notes', rank: 1 }),
      result({ url: 'https://v8.dev/features', title: 'Features · V8', snippet: 'Latest features', rankingQueries: ['features'], rank: 1 }),
      result({ url: 'https://www.clio.com/features', title: 'Clio features', snippet: 'Latest release for law firms', rank: 1 }),
      result({ url: 'https://www.jpl.nasa.gov/news', title: 'Latest news and features', snippet: 'Space releases', rank: 1 }),
    ], NOW)
    const pack = selectFusedEvidence(ranked, [], { limit: 12 })
    expect(pack.web.map((r) => r.url)).toEqual(['https://github.com/iowarp/clio-coder/releases'])
  })
})

 it('keeps a release subject ahead of a hyphenated requested capability', () => {
  expect(projectReleaseSubject('latest on ollama release and cross-platform features')).toBe('ollama')
  expect(projectReleaseSubject('latest on llama.cpp release and features')).toBe('llama.cpp')
  expect(projectReleaseSubject('latest news and features')).toBeNull()
 })

 it('does not turn private browser-history repository URLs into public hydration requests', () => {
  const history = result({ url: 'https://github.com/private/widget-tool', title: 'Widget Tool', sourceType: 'history' })
  expect(deriveRepositoryReleaseSeeds('latest widget-tool release', [history])).toEqual([])
 })

 it('rejects a different surname even when a search snippet appends the missing requested name', () => {
  const ranked = rankWebResults('Who is Marina Stavrakantonaki?', [
    result({ url: 'https://example.org/profile', title: 'Marina Stavrakantonaki', snippet: 'Survey research profile', rank: 1 }),
    result({ url: 'https://example.org/artist', title: 'Marina Stavrakaki Art', snippet: 'Artist biography. Missing: Stavrakantonaki biography', rankingQueries: ['profile affiliation'], rank: 1 }),
  ], NOW)
  expect(selectFusedEvidence(ranked, [], { limit: 12 }).web.map((source) => source.url)).toEqual(['https://example.org/profile'])
 })

 it('does not substitute current-release discovery for a requested historical release', () => {
  expect(projectReleaseSubject('clio-coder v0.3.1 release notes')).toBeNull()
  expect(projectReleaseSubject('latest clio-coder release as of 2026-08-24')).toBeNull()
 })
