import { afterEach, describe, expect, it } from 'bun:test'
import app, { __test__ } from './index'

process.env.KEEPINDEX_SEARCH_MAX_RETRIES = process.env.KEEPINDEX_SEARCH_MAX_RETRIES ?? '2'
const EXPECTED_SEARCH_ATTEMPTS = Number(process.env.KEEPINDEX_SEARCH_MAX_RETRIES ?? 2) + 1

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  __test__.setKnowledgeIndex([])
})

type RetrievalSourceOutcome = {
  provider: string
  state: string
  attempted: boolean
  rawCandidateCount: number
  usableCandidateCount: number
  selectedCount: number
  latencyMs: number | null
  detail: string | null
}

type RetrievalDiagnostics = {
  strategy: string
  web: RetrievalSourceOutcome
  local: RetrievalSourceOutcome
  liveEngines: string[]
  failedEngines: Array<{ engine: string; reason: string }>
  engineCoveragePct: number | null
  fallbackAttempted: boolean
  fallbackReason: string | null
}

type EvalQueryRecord = {
  outcome: string
  degraded: boolean
  error: string | null
  sourceCount: number
  retrievalDiagnostics: RetrievalDiagnostics | null
}

type FailureClass = 'provider-failure' | 'relevance-miss'

/**
 * Every retrieval state except a clean miss means the provider, not the
 * corpus, is why the pack is empty. An evaluation harness scores a
 * provider failure as an infrastructure incident and a relevance miss as a
 * ranking result; conflating them poisons both metrics.
 */
const PROVIDER_FAILURE_STATES = new Set([
  'partial',
  'rate-limited',
  'unreachable',
  'timeout',
  'error',
])

function classifyRetrieval(record: EvalQueryRecord): FailureClass {
  const state = record.retrievalDiagnostics?.web.state
  if (state && PROVIDER_FAILURE_STATES.has(state)) return 'provider-failure'
  if (record.degraded) return 'provider-failure'
  return 'relevance-miss'
}

type SearxScript = (url: URL, calls: string[]) => Response | Promise<Response>

function scriptProviders(searx: SearxScript) {
  const calls: string[] = []
  const offNetwork: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/search?')) {
      calls.push(url)
      return searx(new URL(url), calls)
    }
    if (url.includes('/v1/chat/completions')) {
      return new Response(
        'data: {"choices":[{"delta":{"content":"Zorblex arrays tolerate more drift [1]."}}]}\n\n' +
        'data: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      )
    }
    offNetwork.push(url)
    return new Response('', { status: 599 })
  }) as typeof fetch
  return { calls, offNetwork }
}

const SINGLE_BRANCH_QUERY = 'zorblex array calibration drift tolerance in cold storage vaults'
const THREE_BRANCH_QUERY =
  'Compare the zorblex calibration protocol with the marnith alignment procedure and explain which one tolerates drift'

const PARTIAL_BRANCH_RESULTS = [
  {
    title: 'Zorblex drift note',
    url: 'https://example.com/zorblex-drift',
    content: 'Zorblex arrays tolerate calibration drift in cold storage.',
    engine: 'mojeek',
    score: 1,
  },
  {
    title: 'Marnith alignment note',
    url: 'https://example.com/marnith-alignment',
    content: 'The marnith alignment procedure tolerates less calibration drift.',
    engine: 'mojeek',
    score: 0.8,
  },
]

const searxScripts = {
  http429: () =>
    new Response(JSON.stringify({ error: 'Too Many Requests' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '0' },
    }),
  http403: () => new Response('Forbidden', { status: 403 }),
  http500: () =>
    new Response('Internal Server Error', { status: 500, headers: { 'Retry-After': '0' } }),
  timeout: () => {
    throw new Error('The operation timed out')
  },
  refused: () => {
    throw new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:8888')
  },
  // A captive portal or CAPTCHA interstitial answers 200 with markup. The
  // provider never returned a result set; the JSON parse is what fails.
  htmlInterstitial: () =>
    new Response(
      '<!doctype html><html><head><title>Verify you are human</title></head><body>CAPTCHA</body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    ),
  // The shape the live SearXNG container returns today: HTTP 200, valid JSON,
  // zero results, and every configured engine suspended behind a CAPTCHA.
  captchaSuspendedFleet: () =>
    Response.json({
      query: SINGLE_BRANCH_QUERY,
      number_of_results: 0,
      results: [],
      unresponsive_engines: [
        ['duckduckgo', 'CAPTCHA'],
        ['google', 'CAPTCHA'],
        ['brave', 'CAPTCHA'],
        ['startpage', 'CAPTCHA'],
      ],
    }),
  healthyEmpty: () =>
    Response.json({
      query: SINGLE_BRANCH_QUERY,
      number_of_results: 0,
      results: [],
      unresponsive_engines: [],
    }),
} satisfies Record<string, SearxScript>

/** One of three discovery branches is refused; the other two answer normally. */
function partialDiscoveryScript(): SearxScript {
  const refused = new Set<string>()
  return (url) => {
    const q = url.searchParams.get('q') ?? ''
    if (refused.size === 0 || refused.has(q)) {
      refused.add(q)
      return new Response('Forbidden', { status: 403 })
    }
    return Response.json({
      query: q,
      results: PARTIAL_BRANCH_RESULTS,
      unresponsive_engines: [],
    })
  }
}

type MatrixRow = {
  id: string
  label: string
  script: SearxScript
  expectedState: string
  expectedClass: FailureClass
}

const TOTAL_OUTAGE_MATRIX: MatrixRow[] = [
  {
    id: 'http-429',
    label: 'HTTP 429 throttling',
    script: searxScripts.http429,
    expectedState: 'rate-limited',
    expectedClass: 'provider-failure',
  },
  {
    id: 'http-403',
    label: 'HTTP 403 refusal',
    script: searxScripts.http403,
    expectedState: 'error',
    expectedClass: 'provider-failure',
  },
  {
    id: 'http-500',
    label: 'HTTP 500 provider fault',
    script: searxScripts.http500,
    expectedState: 'error',
    expectedClass: 'provider-failure',
  },
  {
    id: 'network-timeout',
    label: 'network timeout',
    script: searxScripts.timeout,
    expectedState: 'timeout',
    expectedClass: 'provider-failure',
  },
  {
    id: 'network-refused',
    label: 'rejected fetch',
    script: searxScripts.refused,
    expectedState: 'unreachable',
    expectedClass: 'provider-failure',
  },
  {
    id: 'html-interstitial',
    label: 'HTTP 200 HTML interstitial',
    script: searxScripts.htmlInterstitial,
    expectedState: 'error',
    expectedClass: 'provider-failure',
  },
  {
    id: 'captcha-suspended-fleet',
    label: 'HTTP 200 JSON with every engine CAPTCHA-suspended',
    script: searxScripts.captchaSuspendedFleet,
    expectedState: 'partial',
    expectedClass: 'provider-failure',
  },
  {
    id: 'genuine-relevance-miss',
    label: 'HTTP 200 JSON with a healthy engine fleet and no matches',
    script: searxScripts.healthyEmpty,
    expectedState: 'no-results',
    expectedClass: 'relevance-miss',
  },
]

async function readRecord(requestId: string): Promise<EvalQueryRecord> {
  const response = await app.request(`/api/queries/${requestId}`)
  expect(response.status).toBe(200)
  const { record } = await response.json() as { record: EvalQueryRecord }
  return record
}

async function runSearch(id: string, script: SearxScript, options?: {
  query?: string
  target?: string
}) {
  const { calls, offNetwork } = scriptProviders(script)
  const requestId = `provider-eval-search-${id}-${crypto.randomUUID()}`
  const query = options?.query ?? SINGLE_BRANCH_QUERY
  const target = options?.target ?? 'all'
  const response = await app.request(
    `/api/search?q=${encodeURIComponent(query)}&target=${target}&requestId=${requestId}`
  )
  const body = await response.json() as {
    degraded?: boolean
    results?: unknown[]
    error?: string
  }
  expect(offNetwork).toEqual([])
  return { response, body, record: await readRecord(requestId), calls }
}

function sseEvents(stream: string): Array<Record<string, unknown>> {
  return stream
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)) as Record<string, unknown>)
}

/**
 * A streaming caller must be able to reach the same verdict as a caller that
 * later reads the persisted record. Any frame carrying the diagnostics counts.
 */
function sseRetrievalVerdict(stream: string): {
  degraded?: unknown
  retrievalDiagnostics: RetrievalDiagnostics
} | null {
  for (const event of sseEvents(stream)) {
    for (const candidate of [event, event.data]) {
      if (
        candidate &&
        typeof candidate === 'object' &&
        'retrievalDiagnostics' in (candidate as Record<string, unknown>)
      ) {
        return candidate as { degraded?: unknown; retrievalDiagnostics: RetrievalDiagnostics }
      }
    }
  }
  return null
}

async function runAsk(id: string, script: SearxScript, options?: {
  query?: string
  target?: string
}) {
  const { calls, offNetwork } = scriptProviders(script)
  const requestId = `provider-eval-ask-${id}-${crypto.randomUUID()}`
  const response = await app.request('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: options?.query ?? SINGLE_BRANCH_QUERY,
      target: options?.target ?? 'all',
      requestId,
    }),
  })
  const stream = await response.text()
  expect(offNetwork).toEqual([])
  return { response, stream, record: await readRecord(requestId), calls }
}

describe('provider failure versus relevance failure on /api/search', () => {
  for (const row of TOTAL_OUTAGE_MATRIX) {
    it(`classifies ${row.label} as a ${row.expectedClass}`, async () => {
      const { record } = await runSearch(row.id, row.script)

      expect(record.retrievalDiagnostics?.web.state).toBe(row.expectedState)
      expect(classifyRetrieval(record)).toBe(row.expectedClass)
      expect(record.degraded).toBe(row.expectedClass === 'provider-failure')
    }, 30_000)
  }

  for (const row of TOTAL_OUTAGE_MATRIX.filter((entry) => entry.expectedClass === 'provider-failure')) {
    it(`records a failed outcome for ${row.label} on target=all`, async () => {
      const { record } = await runSearch(`${row.id}-outcome`, row.script)

      expect(record.sourceCount).toBe(0)
      expect(record.outcome).toBe('failed')
      expect(typeof record.error).toBe('string')
      expect(record.error).not.toBe('')
    }, 30_000)
  }

  it('reports a healthy empty engine fleet as a succeeded relevance miss', async () => {
    const { response, body, record } = await runSearch(
      'relevance-miss-control',
      searxScripts.healthyEmpty
    )

    expect(response.status).toBe(200)
    expect(body.results).toEqual([])
    expect(body.degraded).toBe(false)
    expect(record.outcome).toBe('succeeded')
    expect(record.error).toBeNull()
    expect(record.retrievalDiagnostics?.failedEngines).toEqual([])
    expect(record.retrievalDiagnostics?.engineCoveragePct).toBeNull()
    expect(classifyRetrieval(record)).toBe('relevance-miss')
  }, 30_000)

  it('keeps the CAPTCHA-suspended fleet distinguishable from a healthy empty fleet', async () => {
    const suspended = await runSearch('captcha-vs-miss-suspended', searxScripts.captchaSuspendedFleet)
    const miss = await runSearch('captcha-vs-miss-control', searxScripts.healthyEmpty)

    expect(suspended.record.retrievalDiagnostics?.failedEngines).toHaveLength(4)
    expect(suspended.record.retrievalDiagnostics?.engineCoveragePct).toBe(0)
    expect(miss.record.retrievalDiagnostics?.failedEngines).toEqual([])

    expect(classifyRetrieval(suspended.record)).toBe('provider-failure')
    expect(classifyRetrieval(miss.record)).toBe('relevance-miss')
    expect(suspended.record.retrievalDiagnostics?.web.state)
      .not.toBe(miss.record.retrievalDiagnostics?.web.state)
    expect(suspended.record.degraded).not.toBe(miss.record.degraded)
    expect(suspended.record.outcome).not.toBe(miss.record.outcome)
  }, 30_000)

  it('marks a partially failed discovery fan-out as degraded', async () => {
    const { response, body, record, calls } = await runSearch(
      'partial-discovery',
      partialDiscoveryScript(),
      { query: THREE_BRANCH_QUERY }
    )

    expect(calls).toHaveLength(3)
    expect(response.status).toBe(200)
    expect(record.sourceCount).toBeGreaterThan(0)
    expect(record.retrievalDiagnostics?.web.state).toBe('partial')
    expect(record.retrievalDiagnostics?.web.detail).toContain('1/3 discovery queries failed')
    expect(classifyRetrieval(record)).toBe('provider-failure')
    expect(record.degraded).toBe(true)
    expect(body.degraded).toBe(true)
  }, 30_000)

  it('still fails the record when target=web excludes every other provider', async () => {
    const { response, record } = await runSearch('web-only-outage', searxScripts.http429, {
      target: 'web',
    })

    expect(response.status).toBe(502)
    expect(record.outcome).toBe('failed')
    expect(record.degraded).toBe(true)
    expect(classifyRetrieval(record)).toBe('provider-failure')
  }, 30_000)
})

describe('provider failure versus relevance failure on /api/ask', () => {
  for (const row of TOTAL_OUTAGE_MATRIX) {
    it(`classifies ${row.label} as a ${row.expectedClass}`, async () => {
      const { record } = await runAsk(row.id, row.script)

      expect(record.retrievalDiagnostics?.web.state).toBe(row.expectedState)
      expect(classifyRetrieval(record)).toBe(row.expectedClass)
      expect(record.degraded).toBe(row.expectedClass === 'provider-failure')
    }, 30_000)
  }

  it('does not record a blocked provider as an evidence-absence result', async () => {
    const suspended = await runAsk('captcha-outcome', searxScripts.captchaSuspendedFleet)
    const miss = await runAsk('relevance-outcome', searxScripts.healthyEmpty)

    expect(miss.record.outcome).toBe('no_evidence')
    expect(suspended.record.outcome).toBe('failed')
  }, 30_000)

  it('reports a degraded answer when one discovery branch is refused', async () => {
    const { record, calls } = await runAsk('partial-discovery', partialDiscoveryScript(), {
      query: THREE_BRANCH_QUERY,
    })

    expect(calls).toHaveLength(3)
    expect(record.outcome).toBe('succeeded')
    expect(record.sourceCount).toBeGreaterThan(0)
    expect(record.retrievalDiagnostics?.web.state).toBe('partial')
    expect(record.retrievalDiagnostics?.web.detail).toContain('1/3 discovery queries failed')
    expect(record.degraded).toBe(true)
    expect(classifyRetrieval(record)).toBe('provider-failure')
  }, 30_000)
})

describe('retrieval verdict over SSE', () => {
  it('emits the provider verdict when web retrieval is throttled', async () => {
    const { stream } = await runAsk('sse-throttled', searxScripts.http429)
    const verdict = sseRetrievalVerdict(stream)

    expect(verdict).not.toBeNull()
    expect(verdict?.degraded).toBe(true)
    expect(verdict?.retrievalDiagnostics.web.state).toBe('rate-limited')
  }, 30_000)

  it('emits a provider verdict for a CAPTCHA-suspended engine fleet', async () => {
    const { stream } = await runAsk('sse-captcha', searxScripts.captchaSuspendedFleet)
    const verdict = sseRetrievalVerdict(stream)

    expect(verdict).not.toBeNull()
    expect(verdict?.degraded).toBe(true)
    expect(verdict?.retrievalDiagnostics.failedEngines).toHaveLength(4)
    expect(verdict?.retrievalDiagnostics.web.state).toBe('partial')
  }, 30_000)

  it('emits a healthy verdict for a genuine relevance miss', async () => {
    const { stream } = await runAsk('sse-relevance-miss', searxScripts.healthyEmpty)
    const verdict = sseRetrievalVerdict(stream)

    expect(verdict).not.toBeNull()
    expect(verdict?.degraded).toBe(false)
    expect(verdict?.retrievalDiagnostics.failedEngines).toEqual([])
    expect(verdict?.retrievalDiagnostics.web.state).toBe('no-results')
  }, 30_000)

  it('emits a degraded verdict when one discovery branch is refused', async () => {
    const { stream } = await runAsk('sse-partial', partialDiscoveryScript(), {
      query: THREE_BRANCH_QUERY,
    })
    const verdict = sseRetrievalVerdict(stream)

    expect(verdict).not.toBeNull()
    expect(verdict?.degraded).toBe(true)
    expect(verdict?.retrievalDiagnostics.web.state).toBe('partial')
  }, 30_000)
})

describe('search retry budget', () => {
  it('spends the configured attempt budget on a throttled provider', async () => {
    const { calls } = await runSearch('retry-429', searxScripts.http429, { target: 'web' })
    const perQuery = new Map<string, number>()
    for (const call of calls) {
      const q = new URL(call).searchParams.get('q') ?? ''
      perQuery.set(q, (perQuery.get(q) ?? 0) + 1)
    }

    expect(perQuery.size).toBe(1)
    expect(calls).toHaveLength(EXPECTED_SEARCH_ATTEMPTS)
  }, 30_000)

  it('spends the configured attempt budget on an unreachable provider', async () => {
    const { calls } = await runSearch('retry-refused', searxScripts.refused, { target: 'web' })

    expect(calls).toHaveLength(EXPECTED_SEARCH_ATTEMPTS)
  }, 30_000)

  it('does not retry a refusal the provider will repeat', async () => {
    const { calls } = await runSearch('retry-403', searxScripts.http403, { target: 'web' })

    expect(calls).toHaveLength(1)
  }, 30_000)

  it('does not retry a healthy empty result set', async () => {
    const { calls } = await runSearch('retry-healthy-empty', searxScripts.healthyEmpty, {
      target: 'web',
    })

    expect(calls).toHaveLength(1)
  }, 30_000)
})
