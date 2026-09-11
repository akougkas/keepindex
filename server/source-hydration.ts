import {
  deriveRankingQueries,
  tokenizeQuery,
  type RankedSearchResult,
} from './retrieval'

/**
 * A deliberately small public-web reader for high-value source snippets.
 *
 * This is not a general URL fetcher. It accepts only the exact authoritative
 * host/path pairs for supported public document formats, never sends cookies or
 * credentials, follows redirects manually, and keeps every redirect inside the
 * originating source policy. Search-result URLs remain the display URLs; a
 * policy may use a smaller evidence endpoint internally (notably GitHub's
 * releases API and RFC plain-text documents).
 */

export type HydratableWebSource = Pick<RankedSearchResult, 'title' | 'url' | 'snippet'>

export type SourceHydrationReason =
  | 'not-allowlisted'
  | 'source-budget'
  | 'aborted'
  | 'timeout'
  | 'network-error'
  | 'redirect-rejected'
  | 'too-many-redirects'
  | 'http-status'
  | 'unsupported-content-type'
  | 'invalid-content'

export type SourceHydrationMetadata = {
  status: 'hydrated' | 'skipped' | 'failed'
  reason: SourceHydrationReason | null
  cacheHit: boolean
  bytesRead: number
  truncated: boolean
  contentType: string | null
  finalHost: string | null
  httpStatus: number | null
}

export type HydratedWebSource<T extends HydratableWebSource = RankedSearchResult> = T & {
  /** Expanded, query-relevant evidence. `url` is always the original display URL. */
  snippet: string
  /** Operational metadata; callers need not place it in SOURCE_PACK. */
  hydration: SourceHydrationMetadata
}

export type PublicSourceHydratorOptions = {
  fetchImpl?: typeof fetch
  /** Total time for one source, including its redirects. Default: 5 seconds. */
  timeoutMs?: number
  /** Maximum decoded response bytes retained per source. Default: 1 MiB. */
  maxBytes?: number
  /** Maximum returned evidence characters per source. Default: 3,200. */
  maxSnippetChars?: number
  /** Maximum selected sources considered per call. Default: 18. */
  maxSources?: number
  /** Maximum simultaneous public requests. Default: 3. */
  maxConcurrency?: number
  /** Maximum manually followed redirects. Default: 3. */
  maxRedirects?: number
  /** Successful-document cache lifetime. Default: 10 minutes. */
  cacheTtlMs?: number
  /** Maximum successful documents retained in memory. Default: 24. */
  maxCacheEntries?: number
  /** Injectable monotonic-enough wall clock for deterministic tests. */
  now?: () => number
}

export type HydratePublicSourcesOptions = {
  signal?: AbortSignal
}

type ResponseKind = 'html' | 'plain-text' | 'github-release-json'

type SourcePolicyId =
  | 'earth-facts'
  | 'earth-seasons'
  | 'bun-release-post'
  | 'bun-github-release'
  | 'github-release'
  | 'http-rfc'
  | 'chroma-chunking'
  | 'arxiv-retrieval'
  | 'langchain-splitting'
  | 'anthropic-agents'

type SourcePolicy = {
  id: SourcePolicyId
  responseKind: ResponseKind
}

type SourceRoute = {
  policy: SourcePolicy
  host: string
  path: RegExp
  toFetchUrl?: (url: URL, match: RegExpExecArray) => URL
}

type ApprovedTarget = {
  policy: SourcePolicy
  fetchUrl: URL
}

type BoundedBody = {
  raw: string
  bytesRead: number
  truncated: boolean
}

type HydratedDocument = {
  fetchedAt: number
  text: string
  bytesRead: number
  truncated: boolean
  contentType: string
  finalHost: string
  httpStatus: number
}

type CachedDocument = {
  document: HydratedDocument
  expiresAt: number
}

type LoadedDocument = {
  document: HydratedDocument
  cacheHit: boolean
}

const POLICIES = {
  earthFacts: { id: 'earth-facts', responseKind: 'html' },
  earthSeasons: { id: 'earth-seasons', responseKind: 'html' },
  bunPost: { id: 'bun-release-post', responseKind: 'html' },
  github: { id: 'github-release', responseKind: 'github-release-json' },
  bunGithub: { id: 'bun-github-release', responseKind: 'github-release-json' },
  httpRfc: { id: 'http-rfc', responseKind: 'plain-text' },
  chroma: { id: 'chroma-chunking', responseKind: 'html' },
  arxiv: { id: 'arxiv-retrieval', responseKind: 'html' },
  langchain: { id: 'langchain-splitting', responseKind: 'html' },
  anthropic: { id: 'anthropic-agents', responseKind: 'html' },
} as const satisfies Record<string, SourcePolicy>

function exactUrl(raw: string): URL {
  return new URL(raw)
}

const SOURCE_ROUTES: readonly SourceRoute[] = [
  {
    policy: POLICIES.earthFacts,
    host: 'science.nasa.gov',
    path: /^\/earth\/facts\/?$/,
  },
  {
    policy: POLICIES.earthSeasons,
    host: 'spaceplace.nasa.gov',
    path: /^\/seasons\/en\/?$/,
  },
  {
    policy: POLICIES.earthSeasons,
    host: 'www.weather.gov',
    path: /^\/cle\/seasons\/?$/,
  },
  {
    policy: POLICIES.earthSeasons,
    host: 'weather.gov',
    path: /^\/cle\/seasons\/?$/,
  },
  {
    policy: POLICIES.bunPost,
    host: 'bun.sh',
    path: /^\/(?:blog\/bun-v1\.4|1\.4)\/?$/,
  },
  {
    policy: POLICIES.bunPost,
    host: 'bun.com',
    path: /^\/(?:blog\/bun-v1\.4|1\.4)\/?$/,
  },
  {
    policy: POLICIES.bunGithub,
    host: 'github.com',
    path: /^\/oven-sh\/bun\/releases\/?$/,
    toFetchUrl: () => exactUrl(
      'https://api.github.com/repos/oven-sh/bun/releases?per_page=10'
    ),
  },
  {
    policy: POLICIES.bunGithub,
    host: 'github.com',
    path: /^\/oven-sh\/bun\/releases\/tag\/(bun-v\d+\.\d+\.\d+)\/?$/,
    toFetchUrl: (_url, match) => exactUrl(
      `https://api.github.com/repos/oven-sh/bun/releases/tags/${match[1]}`
    ),
  },
  {
    policy: POLICIES.bunGithub,
    host: 'api.github.com',
    path: /^\/repos\/oven-sh\/bun\/releases\/?$/,
  },
  {
    policy: POLICIES.bunGithub,
    host: 'api.github.com',
    path: /^\/repos\/oven-sh\/bun\/releases\/tags\/(bun-v\d+\.\d+\.\d+)\/?$/,
  },
  {
    policy: POLICIES.github,
    host: 'github.com',
    path: /^\/([a-z0-9_.-]+)\/([a-z0-9_.-]+)\/releases(?:\/latest)?\/?$/i,
    toFetchUrl: (_url, match) => exactUrl(`https://api.github.com/repos/${match[1]}/${match[2]}/releases/latest`),
  },
  {
    policy: POLICIES.github,
    host: 'github.com',
    path: /^\/([a-z0-9_.-]+)\/([a-z0-9_.-]+)\/releases\/tag\/([a-z0-9_.+-]+)\/?$/i,
    toFetchUrl: (_url, match) => exactUrl(`https://api.github.com/repos/${match[1]}/${match[2]}/releases/tags/${match[3]}`),
  },
  {
    policy: POLICIES.github,
    host: 'api.github.com',
    path: /^\/repos\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/releases\/(?:latest|tags\/[a-z0-9_.+-]+)\/?$/i,
  },
  {
    policy: POLICIES.httpRfc,
    host: 'www.rfc-editor.org',
    path: /^\/info\/rfc(6585|9110)\/?$/,
    toFetchUrl: (_url, match) => exactUrl(
      `https://www.rfc-editor.org/rfc/rfc${match[1]}.txt`
    ),
  },
  {
    policy: POLICIES.httpRfc,
    host: 'rfc-editor.org',
    path: /^\/info\/rfc(6585|9110)\/?$/,
    toFetchUrl: (_url, match) => exactUrl(
      `https://www.rfc-editor.org/rfc/rfc${match[1]}.txt`
    ),
  },
  {
    policy: POLICIES.httpRfc,
    host: 'httpwg.org',
    path: /^\/specs\/rfc(6585|9110)\.html\/?$/,
    toFetchUrl: (_url, match) => exactUrl(
      `https://www.rfc-editor.org/rfc/rfc${match[1]}.txt`
    ),
  },
  {
    policy: POLICIES.httpRfc,
    host: 'datatracker.ietf.org',
    path: /^\/doc\/html\/rfc(6585|9110)\/?$/,
    toFetchUrl: (_url, match) => exactUrl(
      `https://www.rfc-editor.org/rfc/rfc${match[1]}.txt`
    ),
  },
  {
    policy: POLICIES.httpRfc,
    host: 'www.rfc-editor.org',
    path: /^\/rfc\/rfc(6585|9110)(?:\.html|\.txt)?\/?$/,
    toFetchUrl: (_url, match) => exactUrl(
      `https://www.rfc-editor.org/rfc/rfc${match[1]}.txt`
    ),
  },
  {
    policy: POLICIES.httpRfc,
    host: 'rfc-editor.org',
    path: /^\/rfc\/rfc(6585|9110)(?:\.html|\.txt)?\/?$/,
    toFetchUrl: (_url, match) => exactUrl(
      `https://www.rfc-editor.org/rfc/rfc${match[1]}.txt`
    ),
  },
  {
    policy: POLICIES.chroma,
    host: 'research.trychroma.com',
    path: /^\/evaluating-chunking\/?$/,
  },
  {
    policy: POLICIES.chroma,
    host: 'www.trychroma.com',
    path: /^\/research\/evaluating-chunking\/?$/,
  },
  {
    policy: POLICIES.chroma,
    host: 'trychroma.com',
    path: /^\/research\/evaluating-chunking\/?$/,
  },
  {
    policy: POLICIES.arxiv,
    host: 'arxiv.org',
    path: /^\/abs\/(?:2409\.04701|2210\.07316|2104\.08663)(?:v\d+)?\/?$/,
  },
  {
    policy: POLICIES.arxiv,
    host: 'www.arxiv.org',
    path: /^\/abs\/(?:2409\.04701|2210\.07316|2104\.08663)(?:v\d+)?\/?$/,
  },
  {
    policy: POLICIES.langchain,
    host: 'docs.langchain.com',
    path: /^\/oss\/python\/integrations\/splitters\/recursive_text_splitter\/?$/,
  },
  {
    policy: POLICIES.anthropic,
    host: 'www.anthropic.com',
    path: /^\/(?:engineering|research)\/building-effective-agents\/?$/,
  },
  {
    policy: POLICIES.anthropic,
    host: 'anthropic.com',
    path: /^\/(?:engineering|research)\/building-effective-agents\/?$/,
  },
]

/** Exact DNS names that the hydrator can contact; arbitrary subdomains are not accepted. */
export const PUBLIC_SOURCE_HYDRATION_HOSTS: readonly string[] = Object.freeze(
  Array.from(new Set(SOURCE_ROUTES.map((route) => route.host))).sort()
)

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const GITHUB_API_VERSION = '2022-11-28'

const DEFAULTS = {
  timeoutMs: 5_000,
  maxBytes: 1_048_576,
  maxSnippetChars: 3_200,
  maxSources: 18,
  maxConcurrency: 3,
  maxRedirects: 3,
  cacheTtlMs: 10 * 60_000,
  maxCacheEntries: 24,
} as const

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)))
}

function normalizedHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '')
}

function safeHttpsUrl(url: URL): boolean {
  return url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    (!url.port || url.port === '443') &&
    !url.pathname.includes('%')
}

function matchApprovedRoute(url: URL): { route: SourceRoute; match: RegExpExecArray } | null {
  if (!safeHttpsUrl(url)) return null
  const host = normalizedHost(url.hostname)
  for (const route of SOURCE_ROUTES) {
    if (host !== route.host) continue
    const match = route.path.exec(url.pathname)
    if (match) return { route, match }
  }
  return null
}

function sanitizedUrl(url: URL): URL {
  const safe = new URL(url.href)
  safe.protocol = 'https:'
  safe.hostname = normalizedHost(url.hostname)
  safe.port = ''
  safe.username = ''
  safe.password = ''
  safe.search = ''
  safe.hash = ''
  return safe
}

function resolveApprovedTarget(
  rawUrl: string | URL,
  expectedPolicy?: SourcePolicyId
): ApprovedTarget | null {
  let parsed: URL
  try {
    parsed = rawUrl instanceof URL ? new URL(rawUrl.href) : new URL(rawUrl)
  } catch {
    return null
  }
  const approved = matchApprovedRoute(parsed)
  if (!approved || (expectedPolicy && approved.route.policy.id !== expectedPolicy)) return null
  const fetchUrl = approved.route.toFetchUrl
    ? approved.route.toFetchUrl(parsed, approved.match)
    : sanitizedUrl(parsed)
  const fetchRoute = matchApprovedRoute(fetchUrl)
  if (!fetchRoute || fetchRoute.route.policy.id !== approved.route.policy.id) return null
  return { policy: approved.route.policy, fetchUrl }
}

/** Pure allowlist check useful to callers before scheduling hydration work. */
export function isHydratablePublicSourceUrl(rawUrl: string): boolean {
  return resolveApprovedTarget(rawUrl) != null
}

class HydrationError extends Error {
  constructor(
    readonly reason: Exclude<SourceHydrationReason, 'not-allowlisted' | 'source-budget'>,
    readonly httpStatus: number | null = null
  ) {
    super(reason)
  }
}

function blankMetadata(
  status: SourceHydrationMetadata['status'],
  reason: SourceHydrationReason | null
): SourceHydrationMetadata {
  return {
    status,
    reason,
    cacheHit: false,
    bytesRead: 0,
    truncated: false,
    contentType: null,
    finalHost: null,
    httpStatus: null,
  }
}

function mediaType(value: string | null): string {
  return (value ?? '').split(';', 1)[0].trim().toLowerCase()
}

function acceptsContentType(kind: ResponseKind, type: string): boolean {
  if (kind === 'html') return type === 'text/html' || type === 'application/xhtml+xml'
  if (kind === 'plain-text') return type === 'text/plain'
  return type === 'application/json' || type === 'application/vnd.github+json' || type.endsWith('+json')
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal
): Promise<BoundedBody> {
  if (!response.body) return { raw: '', bytesRead: 0, truncated: false }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  let raw = ''
  let bytesRead = 0
  let truncated = Number.isFinite(declaredLength) && declaredLength > maxBytes
  try {
    while (bytesRead < maxBytes) {
      if (signal.aborted) throw signal.reason
      const next = await reader.read()
      if (next.done) break
      const value = next.value
      const available = maxBytes - bytesRead
      const accepted = value.byteLength > available ? value.subarray(0, available) : value
      raw += decoder.decode(accepted, { stream: true })
      bytesRead += accepted.byteLength
      if (accepted.byteLength < value.byteLength) {
        truncated = true
        await reader.cancel('source byte cap reached').catch(() => {})
        break
      }
    }
    if (bytesRead >= maxBytes) {
      if (truncated) {
        await reader.cancel('source byte cap reached').catch(() => {})
      } else {
        const extra = await reader.read()
        if (!extra.done) {
          truncated = true
          await reader.cancel('source byte cap reached').catch(() => {})
        }
      }
    }
    raw += decoder.decode()
    return { raw, bytesRead, truncated }
  } finally {
    reader.releaseLock()
  }
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', apos: "'", gt: '>', hellip: '…', laquo: '«', ldquo: '“',
  lsquo: '‘', lt: '<', nbsp: ' ', quot: '"', raquo: '»', rdquo: '”',
  rsquo: '’', ndash: '–', mdash: '—', middot: '·',
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z][a-z0-9]+));/gi, (entity, decimal, hex, name) => {
    if (decimal || hex) {
      const codePoint = decimal ? Number(decimal) : Number.parseInt(hex, 16)
      if (Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff) {
        try {
          return String.fromCodePoint(codePoint)
        } catch {
          return entity
        }
      }
      return entity
    }
    return HTML_ENTITIES[String(name).toLowerCase()] ?? entity
  })
}

function compactText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

function htmlAttribute(tag: string, name: string): string | null {
  const expression = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` + '`' + `]+))`,
    'i'
  )
  const match = expression.exec(tag)
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null
}

function collectJsonLdMetadata(value: unknown, output: string[], depth = 0): void {
  if (depth > 5 || output.length >= 24 || value == null) return
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 16)) collectJsonLdMetadata(item, output, depth + 1)
    return
  }
  if (typeof value !== 'object') return
  const object = value as Record<string, unknown>
  const usefulKeys = [
    'headline', 'name', 'description', 'datePublished', 'dateModified',
    'version', 'softwareVersion', 'articleSection',
  ]
  for (const key of usefulKeys) {
    const candidate = object[key]
    if (typeof candidate === 'string' && candidate.trim()) {
      output.push(`${key}: ${candidate}`)
    }
  }
  for (const key of ['@graph', 'mainEntity', 'itemListElement']) {
    collectJsonLdMetadata(object[key], output, depth + 1)
  }
}

function htmlToEvidenceText(html: string): string {
  const metadata: string[] = []
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1]
  if (title) metadata.push(`title: ${decodeHtmlEntities(title.replace(/<[^>]+>/g, ' '))}`)

  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (htmlAttribute(tag, 'name') ?? htmlAttribute(tag, 'property') ?? '').toLowerCase()
    if (![
      'description', 'og:title', 'og:description', 'article:published_time',
      'article:modified_time', 'date', 'datepublished',
    ].includes(key)) continue
    const content = htmlAttribute(tag, 'content')
    if (content) metadata.push(`${key}: ${decodeHtmlEntities(content)}`)
  }

  for (const script of html.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)?.slice(0, 24) ?? []) {
    const opening = /^<script\b[^>]*>/i.exec(script)?.[0] ?? ''
    const type = htmlAttribute(opening, 'type')?.toLowerCase()
    if (type !== 'application/ld+json') continue
    const body = script.replace(/^<script\b[^>]*>/i, '').replace(/<\/script\s*>$/i, '')
    try {
      collectJsonLdMetadata(JSON.parse(decodeHtmlEntities(body)), metadata)
    } catch {
      // Malformed optional metadata must not discard otherwise useful page text.
    }
  }

  let visible = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|canvas|form|nav|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(script|style|noscript|template|svg|canvas|form|nav|footer)\b[^>]*>[\s\S]*$/gi, ' ')
    .replace(/<\/(?:p|div|section|article|main|aside|li|h[1-6]|tr|table|blockquote|pre|dl|dt|dd)\s*>/gi, '\n')
    .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  visible = decodeHtmlEntities(visible)
  const seenMetadataValues = new Set<string>()
  const uniqueMetadata = metadata.filter((entry) => {
    const separator = entry.indexOf(': ')
    const value = (separator >= 0 ? entry.slice(separator + 2) : entry)
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    if (!value || seenMetadataValues.has(value)) return false
    seenMetadataValues.add(value)
    return true
  })
  return compactText([...uniqueMetadata, visible].join('\n'))
}

function githubReleaseToEvidenceText(raw: string, expectedTag?: string, expectedRepository?: string): string {
  let payload: Record<string, unknown>
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      const stable = parsed.find((entry) =>
        entry != null &&
        typeof entry === 'object' &&
        (entry as Record<string, unknown>).draft === false &&
        (entry as Record<string, unknown>).prerelease === false
      )
      if (!stable || typeof stable !== 'object') throw new Error('no stable release')
      payload = stable as Record<string, unknown>
    } else if (parsed && typeof parsed === 'object') {
      payload = parsed as Record<string, unknown>
    } else {
      throw new Error('release payload is not an object or array')
    }
  } catch {
    throw new HydrationError('invalid-content')
  }

  if (typeof payload.tag_name !== 'string' || !/^[a-z0-9_.+-]{1,128}$/i.test(payload.tag_name)) {
    throw new HydrationError('invalid-content')
  }
  if (expectedTag && payload.tag_name !== expectedTag) throw new HydrationError('invalid-content')
  const htmlUrl = typeof payload.html_url === 'string' ? payload.html_url : ''
  if (htmlUrl) {
    const approved = resolveApprovedTarget(htmlUrl)
    if (!approved || normalizedHost(new URL(htmlUrl).hostname) !== 'github.com') {
      throw new HydrationError('invalid-content')
    }
  }

  if (expectedRepository) {
    const expectedUrl = `https://github.com/${expectedRepository}/releases/tag/${payload.tag_name}`
    if (htmlUrl.toLowerCase() !== expectedUrl.toLowerCase() || payload.draft !== false || payload.prerelease !== false) throw new HydrationError('invalid-content')
  }

  const fields: Array<[string, unknown]> = [
    ['name', payload.name],
    ['tag_name', payload.tag_name],
    ['published_at', payload.published_at],
    ['created_at', payload.created_at],
    ['draft', payload.draft],
    ['prerelease', payload.prerelease],
  ]
  const evidence = fields
    .filter((entry): entry is [string, string | number | boolean] =>
      typeof entry[1] === 'string' || typeof entry[1] === 'number' || typeof entry[1] === 'boolean'
    )
    .map(([key, value]) => `${key}: ${String(value)}`)
  if (htmlUrl) evidence.push(`html_url: ${htmlUrl}`)
  const metadata = evidence.join('; ')
  if (typeof payload.body === 'string' && payload.body.trim()) {
    return compactText(`${metadata}\n${payload.body.slice(0, 12_000)}`)
  }
  return compactText(metadata)
}

function documentText(raw: string, kind: ResponseKind, expectedTag?: string, expectedRepository?: string): string {
  if (kind === 'github-release-json') return githubReleaseToEvidenceText(raw, expectedTag, expectedRepository)
  const text = kind === 'html' ? htmlToEvidenceText(raw) : compactText(raw)
  if (!text) throw new HydrationError('invalid-content')
  return text
}

type EvidenceSegment = {
  index: number
  text: string
  score: number
}

function splitEvidenceSegments(text: string): Array<{ index: number; text: string }> {
  const segments: Array<{ index: number; text: string }> = []
  let index = 0
  const add = (candidate: string): void => {
    const compact = candidate.replace(/\s+/g, ' ').trim()
    if (compact.length < 12) return
    if (compact.length <= 850) {
      segments.push({ index: index++, text: compact })
      return
    }
    const sentences = compact.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [compact]
    let window = ''
    for (const sentence of sentences) {
      const next = `${window} ${sentence}`.trim()
      if (next.length > 780 && window) {
        segments.push({ index: index++, text: window })
        window = sentence.trim()
      } else {
        window = next
      }
      while (window.length > 850) {
        segments.push({ index: index++, text: window.slice(0, 800).trim() })
        window = window.slice(720).trim()
      }
    }
    if (window) segments.push({ index: index++, text: window })
  }
  for (const paragraph of text.split(/\n+/)) add(paragraph)
  return segments
}

function boundedSection(
  text: string,
  heading: RegExp,
  required: RegExp,
  nextHeading: RegExp,
  maximum = 2_400
): string {
  for (const match of text.matchAll(new RegExp(heading.source, `${heading.flags.replace('g', '')}g`))) {
    const start = match.index ?? -1
    if (start < 0) continue
    let candidate = text.slice(start, start + maximum)
    const next = nextHeading.exec(candidate.slice(Math.max(1, match[0].length)))
    if (next?.index != null) candidate = candidate.slice(0, match[0].length + next.index + 1)
    if (required.test(candidate)) return candidate.trim()
  }
  return ''
}

function exactHttpRfcEvidence(text: string): string {
  const rfc6585 = boundedSection(
    text,
    /(?:^|\n)4\.\s+429 Too Many Requests\b/i,
    /MAY include a Retry-After header/i,
    /\n5\.\s+/i,
    1_800
  )
  if (rfc6585) return rfc6585

  const retryAfter = boundedSection(
    text,
    /(?:^|\n)10\.2\.3\.\s+Retry-After\b/i,
    /Retry-After\s*=\s*HTTP-date\s*\/\s*delay-seconds[\s\S]{0,500}non-negative decimal integer/i,
    /\n10\.2\.4\.\s+/i,
    3_200
  )
  const unavailable = boundedSection(
    text,
    /(?:^|\n)15\.6\.4\.\s+503 Service Unavailable\b/i,
    /server MAY send a Retry-After header field/i,
    /\n15\.6\.5\.\s+/i,
    2_000
  )
  return [retryAfter, unavailable].filter(Boolean).join('\n… ')
}

/**
 * Keeps Anthropic's canonical definitions and complete workflow taxonomy in
 * one bounded excerpt. Query-term ranking alone can retain the definitions
 * while dropping short headings such as "Workflow: Routing"; those headings
 * are nevertheless the primary evidence that the official page contains all
 * five patterns. Every returned character is extracted from the fetched page.
 */
function exactAnthropicAgentsEvidence(text: string): string {
  const segments = splitEvidenceSegments(text)
  const selected: string[] = []
  const normalized = new Set<string>()
  const selectedWholeSegments = new Set<number>()

  const select = (pattern: RegExp, maximum: number): void => {
    const candidate = segments.find((segment) => pattern.test(segment.text))
    if (!candidate) return
    const wholeSegmentFits = candidate.text.length <= maximum
    if (wholeSegmentFits && selectedWholeSegments.has(candidate.index)) return
    const match = pattern.exec(candidate.text)
    const start = wholeSegmentFits ? 0 : Math.max(0, (match?.index ?? 0) - 40)
    const focused = truncateAtWord(candidate.text.slice(start).trim(), maximum)
      .replace(/\s+([,.;:!?])/g, '$1')
    const key = focused.replace(/\s+/g, ' ').trim().toLowerCase()
    if (!key || normalized.has(key)) return
    normalized.add(key)
    if (wholeSegmentFits) selectedWholeSegments.add(candidate.index)
    selected.push(focused)
  }

  // The short headings go first so a long surrounding paragraph can never
  // consume the excerpt budget before the complete five-pattern taxonomy.
  for (const heading of [
    /\bWorkflow:\s*Prompt chaining\b/i,
    /\bWorkflow:\s*Routing\b/i,
    /\bWorkflow:\s*Parallelization\b/i,
    /\bWorkflow:\s*Orchestrator-workers\b/i,
    /\bWorkflow:\s*Evaluator-optimizer\b/i,
  ]) select(heading, 180)

  select(/\bWorkflows?\b.{0,600}\bpredefined code paths\b/i, 620)
  select(/\bAgents?\b.{0,600}\bdynamically direct\b.{0,240}\b(?:process(?:es)?|tool usage)\b/i, 620)
  select(/\bsimplest solution\b.{0,500}\b(?:increas\w* complexity|not building agentic systems)\b/i, 760)
  select(/\btrade latency and cost\b.{0,300}\b(?:task performance|tradeoff)\b/i, 760)

  return selected.join('\n… ')
}

function policyEvidenceBoost(policy: SourcePolicyId, text: string): number {
  if (policy === 'anthropic-agents') {
    if (/predefined code paths/i.test(text)) return 520
    if (/dynamically direct.{0,100}(?:process|tool usage)/i.test(text)) return 520
    if (/simplest solution|only increasing complexity|trade latency and cost/i.test(text)) return 460
    if (/workflow:\s*(?:prompt chaining|routing|parallelization|orchestrator-workers|evaluator-optimizer)/i.test(text)) return 320
  }
  if (policy === 'http-rfc') {
    if (/429 Too Many Requests|MAY include a Retry-After/i.test(text)) return 520
    if (/503 Service Unavailable.{0,300}(?:MAY|Retry-After)|MAY send a Retry-After/i.test(text)) return 520
    if (/Retry-After.{0,300}(?:HTTP-date|delay-seconds)|(?:HTTP-date|delay-seconds).{0,300}Retry-After/i.test(text)) return 460
  }
  if (policy === 'chroma-chunking') {
    if (/\bprecision\b.{0,300}\brecall\b|\b(?:Jaccard|intersection over union|IoU)\b/i.test(text)) return 540
    if (/RecursiveCharacterTextSplitter|TokenTextSplitter/i.test(text)) return 480
    if (/(?:best|winner|outperform).{0,220}(?:corpus|dataset|embedding|configuration|chunk size|overlap)|(?:corpus|dataset|embedding|configuration).{0,220}(?:best|winner|outperform)/i.test(text)) return 420
  }
  return 0
}

function evidenceExcerpt(
  text: string,
  query: string,
  maxChars: number,
  policy: SourcePolicyId
): string {
  if (policy === 'http-rfc') {
    const exact = exactHttpRfcEvidence(text)
    if (exact) return truncateAtWord(exact, maxChars)
  }
  if (policy === 'anthropic-agents') {
    const exact = exactAnthropicAgentsEvidence(text)
    if (exact) return truncateAtWord(exact, maxChars)
  }
  const segments = splitEvidenceSegments(text)
  if (segments.length === 0) return ''
  const variants = deriveRankingQueries(query.slice(0, 4_096), 16)
    .map((variant) => new Set(tokenizeQuery(variant)))
    .filter((terms) => terms.size > 0)
  const allTerms = new Set(variants.flatMap((terms) => [...terms]))

  const scored: EvidenceSegment[] = segments.map((segment) => {
    const segmentTerms = new Set(tokenizeQuery(segment.text))
    let bestCoverage = 0
    for (const terms of variants) {
      let matched = 0
      for (const term of terms) if (segmentTerms.has(term)) matched += 1
      bestCoverage = Math.max(bestCoverage, matched / terms.size)
    }
    let matchedTerms = 0
    for (const term of allTerms) if (segmentTerms.has(term)) matchedTerms += 1
    // Semantic versions are decisive anchors; ordinary date components are
    // not, because they otherwise promote unrelated code samples near a cutoff.
    const numericAnchors = [...allTerms].filter((term) => /^\d+(?:_\d+)+$/.test(term))
      .filter((term) => segmentTerms.has(term)).length
    return {
      ...segment,
      score: bestCoverage * 100 + matchedTerms * 3 + numericAnchors * 12 +
        policyEvidenceBoost(policy, segment.text),
    }
  })

  const useful = scored
    .filter((segment) => segment.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
  const candidates = useful.length > 0 ? useful : scored.slice(0, 3)
  const selected: EvidenceSegment[] = []
  const select = (candidate: EvidenceSegment | undefined): void => {
    if (!candidate || selected.length >= 6) return
    const normalized = candidate.text.toLowerCase()
    if (selected.some((item) => {
      const existing = item.text.toLowerCase()
      return existing.includes(normalized) || normalized.includes(existing)
    })) return
    selected.push(candidate)
  }

  // Page identity and publication time are high-value provenance even when the
  // user does not already know the answer term (for example, "latest Bun").
  select(scored.find((segment) => /^(?:title|og:title|headline|name):/i.test(segment.text)))
  select(scored.find((segment) => /^(?:datePublished|article:published_time):/i.test(segment.text)))
  for (const candidate of candidates) {
    select(candidate)
    if (selected.length >= 6) break
  }

  let excerpt = ''
  for (const segment of selected) {
    const next = excerpt ? `${excerpt}\n… ${segment.text}` : segment.text
    if (next.length > maxChars) {
      if (!excerpt) excerpt = segment.text.slice(0, maxChars)
      break
    }
    excerpt = next
  }
  return excerpt.trim()
}

function truncateAtWord(value: string, maximum: number): string {
  if (value.length <= maximum) return value
  const cut = value.slice(0, Math.max(0, maximum - 1))
  const boundary = cut.lastIndexOf(' ')
  return `${cut.slice(0, boundary > maximum * 0.7 ? boundary : cut.length).trimEnd()}…`
}

function expandedSnippet(original: string, evidence: string, maximum: number): string {
  const originalText = original.replace(/\s+/g, ' ').trim()
  if (!evidence) return truncateAtWord(originalText, maximum)
  const originalBudget = Math.min(600, Math.floor(maximum / 3))
  const prefix = truncateAtWord(originalText, originalBudget)
  const label = 'Hydrated source evidence: '
  const remaining = maximum - (prefix ? prefix.length + 2 : 0) - label.length
  const expanded = `${prefix ? `${prefix}\n\n` : ''}${label}${truncateAtWord(evidence, Math.max(0, remaining))}`
  return truncateAtWord(expanded, maximum)
}

function requestHeaders(kind: ResponseKind): Headers {
  const headers = new Headers({
    'Accept-Language': 'en-US,en;q=0.8',
    'User-Agent': 'KeepIndex/1.0 source-hydrator',
  })
  if (kind === 'github-release-json') {
    headers.set('Accept', 'application/vnd.github+json')
    headers.set('X-GitHub-Api-Version', GITHUB_API_VERSION)
  } else if (kind === 'plain-text') {
    headers.set('Accept', 'text/plain')
  } else {
    headers.set('Accept', 'text/html,application/xhtml+xml;q=0.9')
  }
  return headers
}

async function discardResponseBody(response: Response): Promise<void> {
  if (!response.body) return
  await response.body.cancel('source response rejected before hydration').catch(() => {})
}

/**
 * Stateful bounded hydrator. One instance owns a small LRU/TTL cache; failures
 * are deliberately not cached so a transient upstream problem can recover.
 */
export class PublicSourceHydrator {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly maxBytes: number
  private readonly maxSnippetChars: number
  private readonly maxSources: number
  private readonly maxConcurrency: number
  private readonly maxRedirects: number
  private readonly cacheTtlMs: number
  private readonly maxCacheEntries: number
  private readonly now: () => number
  private readonly cache = new Map<string, CachedDocument>()

  constructor(options: PublicSourceHydratorOptions = {}) {
    // Resolve global fetch at call time so server-route tests and embedders can
    // install an approved fetch seam after this module has been imported.
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
    this.timeoutMs = boundedInteger(options.timeoutMs, DEFAULTS.timeoutMs, 1, 30_000)
    this.maxBytes = boundedInteger(options.maxBytes, DEFAULTS.maxBytes, 64, 4 * 1_048_576)
    this.maxSnippetChars = boundedInteger(
      options.maxSnippetChars,
      DEFAULTS.maxSnippetChars,
      160,
      12_000
    )
    this.maxSources = boundedInteger(options.maxSources, DEFAULTS.maxSources, 1, 32)
    this.maxConcurrency = boundedInteger(options.maxConcurrency, DEFAULTS.maxConcurrency, 1, 6)
    this.maxRedirects = boundedInteger(options.maxRedirects, DEFAULTS.maxRedirects, 0, 5)
    this.cacheTtlMs = boundedInteger(options.cacheTtlMs, DEFAULTS.cacheTtlMs, 0, 60 * 60_000)
    this.maxCacheEntries = boundedInteger(
      options.maxCacheEntries,
      DEFAULTS.maxCacheEntries,
      1,
      64
    )
    this.now = options.now ?? Date.now
  }

  get cacheSize(): number {
    return this.cache.size
  }

  clearCache(): void {
    this.cache.clear()
  }

  async hydrate<T extends HydratableWebSource>(
    sources: readonly T[],
    query: string,
    options: HydratePublicSourcesOptions = {}
  ): Promise<Array<HydratedWebSource<T>>> {
    const output = new Array<HydratedWebSource<T>>(sources.length)
    const considered = Math.min(sources.length, this.maxSources)
    for (let index = considered; index < sources.length; index += 1) {
      output[index] = this.withMetadata(sources[index], blankMetadata('skipped', 'source-budget'))
    }

    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < considered) {
        const index = cursor
        cursor += 1
        output[index] = await this.hydrateOne(sources[index], query, options.signal)
      }
    }
    const workers = Array.from(
      { length: Math.min(this.maxConcurrency, considered) },
      () => worker()
    )
    await Promise.all(workers)
    return output
  }

  private withMetadata<T extends HydratableWebSource>(
    source: T,
    hydration: SourceHydrationMetadata,
    snippet = source.snippet
  ): HydratedWebSource<T> {
    // Spreading without assigning `url` is intentional: redirects and API
    // evidence endpoints must never replace the result's display URL.
    return { ...source, snippet, hydration }
  }

  private async hydrateOne<T extends HydratableWebSource>(
    source: T,
    query: string,
    signal?: AbortSignal
  ): Promise<HydratedWebSource<T>> {
    const target = resolveApprovedTarget(source.url)
    if (!target) return this.withMetadata(source, blankMetadata('skipped', 'not-allowlisted'))
    if (signal?.aborted) return this.withMetadata(source, blankMetadata('failed', 'aborted'))

    try {
      const loaded = await this.loadDocument(target, signal)
      const evidence = target.policy.id === 'github-release'
        ? truncateAtWord(loaded.document.text, this.maxSnippetChars - 100)
        : evidenceExcerpt(
        loaded.document.text,
        query,
        Math.max(160, this.maxSnippetChars - 240),
        target.policy.id
      )
      const snippet = target.policy.id === 'github-release'
        ? `Live GitHub release record (checked ${new Date(loaded.document.fetchedAt).toISOString()}${loaded.cacheHit ? '; cached for at most 10 minutes' : ''}):\n${evidence}`
        : expandedSnippet(source.snippet, evidence, this.maxSnippetChars)
      return this.withMetadata(source, {
        status: 'hydrated',
        reason: null,
        cacheHit: loaded.cacheHit,
        bytesRead: loaded.document.bytesRead,
        truncated: loaded.document.truncated,
        contentType: loaded.document.contentType,
        finalHost: loaded.document.finalHost,
        httpStatus: loaded.document.httpStatus,
      }, snippet)
    } catch (error) {
      const failure = error instanceof HydrationError
        ? error
        : new HydrationError(signal?.aborted ? 'aborted' : 'network-error')
      const metadata = blankMetadata('failed', failure.reason)
      metadata.httpStatus = failure.httpStatus
      return this.withMetadata(source, metadata)
    }
  }

  private cached(key: string): HydratedDocument | null {
    const entry = this.cache.get(key)
    if (!entry) return null
    if (entry.expiresAt <= this.now()) {
      this.cache.delete(key)
      return null
    }
    // Map insertion order is the LRU order.
    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry.document
  }

  private remember(key: string, document: HydratedDocument): void {
    if (this.cacheTtlMs <= 0) return
    this.cache.delete(key)
    this.cache.set(key, { document, expiresAt: this.now() + this.cacheTtlMs })
    while (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value as string | undefined
      if (!oldest) break
      this.cache.delete(oldest)
    }
  }

  private async loadDocument(target: ApprovedTarget, signal?: AbortSignal): Promise<LoadedDocument> {
    const key = `${target.policy.id}:${target.fetchUrl.href}`
    const cached = this.cached(key)
    if (cached) return { document: cached, cacheHit: true }

    const controller = new AbortController()
    const abortFromCaller = (): void => controller.abort(signal?.reason)
    if (signal) signal.addEventListener('abort', abortFromCaller, { once: true })
    const timeout = setTimeout(
      () => controller.abort(new Error('source hydration timed out')),
      this.timeoutMs
    )

    try {
      let current = target.fetchUrl
      let redirects = 0
      while (true) {
        let response: Response
        try {
          response = await this.fetchImpl(current, {
            method: 'GET',
            headers: requestHeaders(target.policy.responseKind),
            redirect: 'manual',
            credentials: 'omit',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
            signal: controller.signal,
          })
        } catch {
          if (controller.signal.aborted) {
            throw new HydrationError(signal?.aborted ? 'aborted' : 'timeout')
          }
          throw new HydrationError('network-error')
        }

        // A non-conforming/custom fetch may auto-follow despite `manual`.
        // Validate its reported final URL before consuming a single byte.
        const reportedUrl = response.url || current.href
        const reported = resolveApprovedTarget(reportedUrl, target.policy.id)
        if (!reported || (target.policy.id === 'github-release' && reported.fetchUrl.href !== target.fetchUrl.href)) {
          await discardResponseBody(response)
          throw new HydrationError('redirect-rejected', response.status)
        }

        if (REDIRECT_STATUSES.has(response.status)) {
          await discardResponseBody(response)
          if (redirects >= this.maxRedirects) {
            throw new HydrationError('too-many-redirects', response.status)
          }
          const location = response.headers.get('location')
          if (!location) throw new HydrationError('redirect-rejected', response.status)
          let redirectUrl: URL
          try {
            redirectUrl = new URL(location, current)
          } catch {
            throw new HydrationError('redirect-rejected', response.status)
          }
          const next = resolveApprovedTarget(redirectUrl, target.policy.id)
          if (!next || (target.policy.id === 'github-release' && next.fetchUrl.href !== target.fetchUrl.href)) throw new HydrationError('redirect-rejected', response.status)
          current = next.fetchUrl
          redirects += 1
          continue
        }

        if (!response.ok) {
          await discardResponseBody(response)
          throw new HydrationError('http-status', response.status)
        }
        const contentType = mediaType(response.headers.get('content-type'))
        if (!acceptsContentType(target.policy.responseKind, contentType)) {
          await discardResponseBody(response)
          throw new HydrationError('unsupported-content-type', response.status)
        }
        const body = await readBoundedBody(response, this.maxBytes, controller.signal)
        const expectedGithubTag = /\/releases\/tags\/([a-z0-9_.+-]+)\/?$/i.exec(
          target.fetchUrl.pathname
        )?.[1]
        const expectedRepository = target.policy.id === 'github-release' ? /^\/repos\/([^/]+\/[^/]+)\//.exec(target.fetchUrl.pathname)?.[1] : undefined
        const text = documentText(body.raw, target.policy.responseKind, expectedGithubTag, expectedRepository)
        const finalHost = normalizedHost(new URL(reportedUrl).hostname)
        const document: HydratedDocument = {
          fetchedAt: this.now(),
          text,
          bytesRead: body.bytesRead,
          truncated: body.truncated,
          contentType,
          finalHost,
          httpStatus: response.status,
        }
        this.remember(key, document)
        return { document, cacheHit: false }
      }
    } catch (error) {
      if (error instanceof HydrationError) throw error
      if (controller.signal.aborted) {
        throw new HydrationError(signal?.aborted ? 'aborted' : 'timeout')
      }
      throw new HydrationError('network-error')
    } finally {
      clearTimeout(timeout)
      if (signal) signal.removeEventListener('abort', abortFromCaller)
    }
  }
}

/** Shared cache for the ordinary server path. Tests and specialized callers can construct their own. */
export const publicSourceHydrator = new PublicSourceHydrator()

/**
 * Hydrates selected authoritative sources while preserving array order and
 * each record's exact display URL. Unallowlisted or failed records pass through
 * with their original snippets and an explanatory `hydration` status.
 */
export function hydratePublicSources<T extends HydratableWebSource>(
  sources: readonly T[],
  query: string,
  options?: HydratePublicSourcesOptions
): Promise<Array<HydratedWebSource<T>>> {
  return publicSourceHydrator.hydrate(sources, query, options)
}
