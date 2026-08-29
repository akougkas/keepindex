import { afterEach, describe, expect, it } from 'bun:test'
import app, { __test__, type KnowledgeChunk } from './index'
import { fuseFederatedSearch, type FederatedSearchResult } from './federated-search'

const originalFetch = globalThis.fetch

const PRIVATE_TARGETS = ['vault', 'files', 'documents', 'history'] as const
const LOCAL_ONLY_TARGETS = ['vault', 'files', 'documents'] as const

type SearchApiResponse = {
  results: FederatedSearchResult[]
  counts: { web: number; local: number; history: number; total: number }
}

function candidate(
  kind: FederatedSearchResult['kind'],
  id: string,
  overrides: Partial<FederatedSearchResult> = {}
): FederatedSearchResult {
  return {
    id,
    kind,
    title: id,
    url: kind === 'web' || kind === 'history' ? `https://${id}.example/page` : '',
    snippet: `${id} synthetic snippet`,
    score: 0.5,
    nativeRank: 1,
    sourceTypes: [kind],
    ...(kind !== 'web' && kind !== 'history' ? { filePath: `/synthetic/vault/${id}.md` } : {}),
    ...overrides,
  }
}

function strongWebPack(size = 10): FederatedSearchResult[] {
  return Array.from({ length: size }, (_, index) => candidate('web', `web-${index}`, {
    url: `https://web-${index}.example/page`,
    score: Number((0.96 - index * 0.005).toFixed(3)),
  }))
}

function knowledgeChunk(
  id: string,
  sourceKind: 'note' | 'document' | 'code',
  filePath: string,
  fileName: string
): KnowledgeChunk {
  return {
    id,
    filePath,
    fileName,
    content: 'Chunking evaluation retrieval notes written for this synthetic offline corpus.',
    startLine: 1,
    endLine: 4,
    metadata: { sourceKind, extension: fileName.slice(fileName.lastIndexOf('.')), modifiedAt: 1_767_225_600_000 },
  }
}

function offlineFetch(): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/search?')) {
      return new Response(JSON.stringify({ error: 'web retrieval disabled in this test' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch
}

async function searchTarget(target: string): Promise<SearchApiResponse> {
  const response = await app.request('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'chunking evaluation retrieval',
      target,
      requestId: `federated-eval-${target}-${crypto.randomUUID()}`,
    }),
  })
  expect(response.status).toBe(200)
  return await response.json() as SearchApiResponse
}

afterEach(() => {
  globalThis.fetch = originalFetch
  __test__.setKnowledgeIndex([])
})

describe('private search targets never leak the web stream', () => {
  for (const target of PRIVATE_TARGETS) {
    it(`keeps target=${target} free of web-kind rows`, async () => {
      offlineFetch()
      __test__.setKnowledgeIndex([
        knowledgeChunk('vault:0', 'note', '/synthetic/vault/chunking-notes.md', 'chunking-notes.md'),
        knowledgeChunk('doc:0', 'document', '/synthetic/library/chunking-evaluation.pdf', 'chunking-evaluation.pdf'),
        knowledgeChunk('code:0', 'code', '/synthetic/repo/chunking_retrieval.py', 'chunking_retrieval.py'),
      ])

      const body = await searchTarget(target)

      expect(body.results.filter((result) => result.kind === 'web')).toEqual([])
      expect(body.results.filter((result) => result.sourceTypes.includes('web'))).toEqual([])
      expect(body.counts.web).toBe(0)
    })
  }

  for (const target of LOCAL_ONLY_TARGETS) {
    it(`keeps target=${target} free of remote urls`, async () => {
      offlineFetch()
      __test__.setKnowledgeIndex([
        knowledgeChunk('vault:0', 'note', '/synthetic/vault/chunking-notes.md', 'chunking-notes.md'),
        knowledgeChunk('doc:0', 'document', '/synthetic/library/chunking-evaluation.pdf', 'chunking-evaluation.pdf'),
        knowledgeChunk('code:0', 'code', '/synthetic/repo/chunking_retrieval.py', 'chunking_retrieval.py'),
      ])

      const body = await searchTarget(target)

      expect(body.results.filter((result) => /^https?:\/\//i.test(result.url ?? ''))).toEqual([])
    })
  }

  it('keeps target=history restricted to browser-history provenance', async () => {
    offlineFetch()
    __test__.setKnowledgeIndex([
      knowledgeChunk('vault:0', 'note', '/synthetic/vault/chunking-notes.md', 'chunking-notes.md'),
    ])

    const body = await searchTarget('history')

    expect(body.results.every((result) => result.sourceTypes.every((type) => type === 'history'))).toBe(true)
  })
})

describe('fusion admission floor', () => {
  it('does not admit a negligible local match above strong web results', () => {
    const fused = fuseFederatedSearch({
      web: strongWebPack(),
      local: [candidate('note', 'weak-local', { score: 0.02 })],
      history: [],
    }, 8)

    const order = fused.results.map((result) => result.id)
    const weakIndex = order.indexOf('weak-local')
    const webBelowWeak = weakIndex >= 0 && order.slice(weakIndex + 1).some((id) => id.startsWith('web-'))

    expect(webBelowWeak).toBe(false)
  })

  it('does not admit a negligible history match above strong web results', () => {
    const fused = fuseFederatedSearch({
      web: strongWebPack(12),
      local: [],
      history: [candidate('history', 'weak-history', {
        url: 'https://private-history.example/stale-tab',
        score: 0.01,
        visitCount: 1,
        lastVisitedAt: 1_700_000_000_000,
      })],
    }, 13)

    const order = fused.results.map((result) => result.id)
    const weakIndex = order.indexOf('weak-history')
    const webBelowWeak = weakIndex >= 0 && order.slice(weakIndex + 1).some((id) => id.startsWith('web-'))

    expect(webBelowWeak).toBe(false)
  })

  it('still admits a strong local match alongside strong web results', () => {
    const fused = fuseFederatedSearch({
      web: strongWebPack(),
      local: [candidate('note', 'strong-local', { score: 0.88 })],
      history: [],
    }, 8)

    expect(fused.results.map((result) => result.id)).toContain('strong-local')
  })
})

describe('fusion counts', () => {
  it('partitions the displayed rows across web and local, with history overlapping web', () => {
    const sharedUrl = 'https://shared.example/guide'
    const fused = fuseFederatedSearch({
      web: [
        candidate('web', 'live-shared', { url: sharedUrl, snippet: 'Live snippet for the shared guide' }),
        candidate('web', 'live-other', { url: 'https://other.example/page' }),
      ],
      local: [candidate('note', 'vault-note')],
      history: [candidate('history', 'visited-shared', {
        url: 'http://www.shared.example/guide?utm_source=newsletter',
        visitCount: 9,
        browser: 'firefox',
      })],
    }, 10)

    expect(fused.counts.total).toBe(fused.results.length)
    expect(fused.counts.web + fused.counts.local).toBe(fused.counts.total)
    expect(fused.counts.web).toBe(fused.results.filter((result) => result.kind === 'web').length)
    expect(fused.counts.local).toBe(
      fused.results.filter((result) => result.kind !== 'web' && result.kind !== 'history').length
    )
    expect(fused.counts.history).toBe(
      fused.results.filter((result) => result.sourceTypes.includes('history')).length
    )
  })

  it('keeps a history-corroborated web row identifiable without counting it twice', () => {
    const sharedUrl = 'https://shared.example/guide'
    const fused = fuseFederatedSearch({
      web: [candidate('web', 'live-shared', { url: sharedUrl, snippet: 'Live snippet for the shared guide' })],
      local: [],
      history: [candidate('history', 'visited-shared', {
        url: 'http://www.shared.example/guide?utm_source=newsletter',
        visitCount: 9,
        browser: 'firefox',
      })],
    }, 10)

    expect(fused.results).toHaveLength(1)
    expect(fused.results[0]).toMatchObject({ kind: 'web', visitCount: 9, sourceTypes: ['history', 'web'] })
    // history overlaps web on purpose, so the row is counted in both. The defect
    // was the consumer: buildSingleRetrievalDiagnostics summed the two buckets
    // and reported two selected web sources where one card was shown.
    expect(fused.counts).toEqual({ web: 1, local: 0, history: 1, total: 1 })
    expect(fused.counts.web).toBe(fused.results.length)
  })
})

describe('host diversity backfill', () => {
  it('places every other-host row ahead of any over-cap row from the dominant host', () => {
    const dominant = Array.from({ length: 12 }, (_, index) => candidate('web', `dominant-${index}`, {
      url: `https://dominant.example/page-${index}`,
    }))
    const varied = Array.from({ length: 4 }, (_, index) => candidate('web', `varied-${index}`, {
      url: `https://varied-${index}.example/page`,
    }))

    const fused = fuseFederatedSearch({ web: [...dominant, ...varied], local: [], history: [] }, 12)
    const order = fused.results.map((result) => result.id)
    const firstOverCap = order.findIndex((id, index) =>
      id.startsWith('dominant-') && order.slice(0, index).filter((seen) => seen.startsWith('dominant-')).length >= 3
    )
    const lastVaried = order.reduce((last, id, index) => (id.startsWith('varied-') ? index : last), -1)

    expect(order).toHaveLength(12)
    expect(order.slice(0, 3).every((id) => id.startsWith('dominant-'))).toBe(true)
    expect(order.filter((id) => id.startsWith('varied-'))).toHaveLength(4)
    expect(firstOverCap).toBeGreaterThan(lastVaried)
  })

  it('places every other-file row ahead of any over-cap chunk from the dominant file', () => {
    const dominant = Array.from({ length: 6 }, (_, index) => candidate('note', `dominant-chunk-${index}`, {
      filePath: '/synthetic/vault/dominant.md',
      startLine: index * 10 + 1,
      endLine: index * 10 + 6,
    }))
    const varied = Array.from({ length: 3 }, (_, index) => candidate('note', `varied-file-${index}`, {
      filePath: `/synthetic/vault/varied-${index}.md`,
    }))

    const fused = fuseFederatedSearch({ web: [], local: [...dominant, ...varied], history: [] }, 8)
    const order = fused.results.map((result) => result.id)
    const firstOverCap = order.findIndex((id, index) =>
      id.startsWith('dominant-chunk-') &&
      order.slice(0, index).filter((seen) => seen.startsWith('dominant-chunk-')).length >= 2
    )
    const lastVaried = order.reduce((last, id, index) => (id.startsWith('varied-file-') ? index : last), -1)

    expect(order.filter((id) => id.startsWith('varied-file-'))).toHaveLength(3)
    expect(firstOverCap).toBeGreaterThan(lastVaried)
  })
})

describe('fusion limits', () => {
  it('returns nothing when the caller asks for zero results', () => {
    const fused = fuseFederatedSearch({
      web: strongWebPack(),
      local: [candidate('note', 'vault-note')],
      history: [candidate('history', 'visited', { url: 'https://visited.example/page' })],
    }, 0)

    expect(fused.results).toEqual([])
    expect(fused.counts).toEqual({ web: 0, local: 0, history: 0, total: 0 })
    expect(fused.available).toEqual({ web: 10, local: 1, history: 1 })
  })

  it('never returns more rows than the requested limit', () => {
    for (const limit of [0, 1, 2, 5]) {
      const fused = fuseFederatedSearch({
        web: strongWebPack(),
        local: [candidate('note', 'vault-note')],
        history: [],
      }, limit)
      expect(fused.results.length).toBeLessThanOrEqual(limit)
    }
  })
})
