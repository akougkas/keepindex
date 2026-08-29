import { afterEach, describe, expect, it } from 'bun:test'
import app, { __test__ } from './index'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  __test__.setKnowledgeIndex([])
})

type AskEvent = {
  type: string
  data?: {
    model?: string | null
    grounded?: boolean
    status?: string
    invalidCitations?: string[]
    citationCoveragePct?: number
    web?: unknown[]
    local?: unknown[]
  }
}

type AskRecord = {
  outcome: string
  answerText: string
  citationIds: string[]
  error: string | null
  grounding: {
    status: string
    citationCoveragePct: number
    invalidCitations: string[]
  }
}

const REFUSAL_OUTCOMES = ['no_evidence', 'failed', 'interrupted']

function parseAskEvents(stream: string): AskEvent[] {
  return stream
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)) as AskEvent)
}

/**
 * Classifies the terminal SSE frame using only shapes the route already emits.
 * `done` with `grounded: false` is the refusal frame the pre-generation gate
 * writes at index.ts:5084; `error` is the frame the interrupted-stream path
 * writes. Anything else is an ordinary success handed to the user.
 */
function terminalSignal(events: AskEvent[]): string {
  const terminal = events.at(-1)
  if (!terminal) return 'no-terminal-frame'
  if (terminal.type === 'error') return 'refused-error'
  if (terminal.type === 'done') {
    return terminal.data?.grounded === false ? 'refused-done' : 'ordinary-success'
  }
  return `unterminated:${terminal.type}`
}

/**
 * Collapses the two user-visible signals into one string so a failure reports
 * both the terminal frame and the persisted outcome at once.
 */
function groundingGateVerdict(events: AskEvent[], record: AskRecord): string {
  const terminal = terminalSignal(events)
  const detail = `terminal=${terminal}, outcome=${record.outcome}, coverage=${record.grounding.citationCoveragePct}%, invalid=[${record.grounding.invalidCitations.join(',')}]`
  return terminal === 'ordinary-success' || record.outcome === 'succeeded'
    ? `shipped-as-success(${detail})`
    : `refused(${detail})`
}

function webSourcePack() {
  return {
    results: [
      {
        title: 'SQLite WAL reader writer concurrency',
        url: 'https://sqlite.example/wal.html',
        content: 'SQLite WAL reader writer concurrency lets readers proceed while a single writer appends frames.',
      },
      {
        title: 'WAL reader writer concurrency notes',
        url: 'https://dbnotes.example/wal-concurrency',
        content: 'SQLite WAL reader writer concurrency uses snapshots so readers never block the active writer.',
      },
      {
        title: 'WAL reader writer concurrency limits',
        url: 'https://manual.example/wal-limits',
        content: 'SQLite WAL reader writer concurrency allows one writer and many readers at a time.',
      },
    ],
  }
}

function scriptedLlm(options: {
  draft: string
  repairReply?: string
  onLlmCall?: (body: { stream?: boolean }) => void
}) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/search?')) {
      return new Response(JSON.stringify(webSourcePack()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.includes('/v1/chat/completions')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { stream?: boolean }
      options.onLlmCall?.(body)
      if (body.stream === false) {
        return Response.json({
          choices: [{ message: { content: options.repairReply ?? options.draft } }],
        })
      }
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: options.draft } }] })}\n\n` +
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      )
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch
}

describe('post-generation grounding gate on /api/ask', () => {
  it('refuses an answer whose citation identifiers do not exist in the source pack', async () => {
    const requestId = `grounding-gate-fabricated-${crypto.randomUUID()}`
    globalThis.fetch = scriptedLlm({
      draft: 'SQLite WAL lets multiple readers proceed while a single writer appends frames [7].',
    })

    const response = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'SQLite WAL reader writer concurrency', requestId }),
    })
    const stream = await response.text()
    const events = parseAskEvents(stream)
    const recordResponse = await app.request(`/api/queries/${requestId}`)
    const { record } = await recordResponse.json() as { record: AskRecord }

    const sources = events.find((event) => event.type === 'sources')
    expect(sources?.data?.web).toHaveLength(3)
    expect(record.grounding.invalidCitations).toEqual(['7'])
    expect(record.grounding.citationCoveragePct).toBe(0)
    expect(record.grounding.status).not.toBe('strong')
    expect(record.grounding.status).not.toBe('mixed')

    expect(groundingGateVerdict(events, record)).toMatch(/^refused\(/)
    expect(terminalSignal(events)).not.toBe('ordinary-success')
    expect(record.outcome).not.toBe('succeeded')
    expect(REFUSAL_OUTCOMES).toContain(record.outcome)
  }, 15_000)

  it('refuses a mixed answer when even one citation is outside the source pack', async () => {
    const requestId = `grounding-gate-mixed-invalid-${crypto.randomUUID()}`
    globalThis.fetch = scriptedLlm({
      draft: [
        'SQLite WAL lets multiple readers proceed while a single writer appends frames [1].',
        'Checkpointing always doubles transaction throughput under load [99].',
      ].join(' '),
    })

    const response = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'SQLite WAL reader writer concurrency', requestId }),
    })
    const events = parseAskEvents(await response.text())
    const recordResponse = await app.request(`/api/queries/${requestId}`)
    const { record } = await recordResponse.json() as { record: AskRecord }

    expect(record.grounding.invalidCitations).toEqual(['99'])
    expect(record.error).toContain('outside the retrievable source pack')
    expect(groundingGateVerdict(events, record)).toMatch(/^refused\(/)
    expect(record.outcome).not.toBe('succeeded')
  }, 15_000)

  it('refuses an answer that carries no citations at all', async () => {
    const requestId = `grounding-gate-uncited-${crypto.randomUUID()}`
    const draft = 'SQLite WAL lets multiple readers proceed while a single writer appends frames.'
    globalThis.fetch = scriptedLlm({ draft })

    const response = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'SQLite WAL reader writer concurrency', requestId }),
    })
    const stream = await response.text()
    const events = parseAskEvents(stream)
    const recordResponse = await app.request(`/api/queries/${requestId}`)
    const { record } = await recordResponse.json() as { record: AskRecord }

    expect(record.citationIds).toEqual([])
    expect(record.grounding.citationCoveragePct).toBe(0)
    expect(record.grounding.status).not.toBe('strong')
    expect(record.grounding.status).not.toBe('mixed')

    expect(groundingGateVerdict(events, record)).toMatch(/^refused\(/)
    expect(terminalSignal(events)).not.toBe('ordinary-success')
    expect(record.outcome).not.toBe('succeeded')
    expect(REFUSAL_OUTCOMES).toContain(record.outcome)
  }, 15_000)

  it('refuses a sparsely cited answer that remains below the repair threshold', async () => {
    const requestId = `grounding-gate-low-coverage-${crypto.randomUUID()}`
    const draft = [
      'SQLite WAL lets multiple readers proceed while a single writer appends frames [1].',
      'Every checkpoint always completes without waiting for active readers.',
      'The write-ahead log can never grow beyond one database page.',
      'All storage devices provide identical durability under every synchronous mode.',
    ].join(' ')
    globalThis.fetch = scriptedLlm({ draft })

    const response = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'SQLite WAL reader writer concurrency', requestId }),
    })
    const events = parseAskEvents(await response.text())
    const recordResponse = await app.request(`/api/queries/${requestId}`)
    const { record } = await recordResponse.json() as { record: AskRecord }

    expect(record.grounding.invalidCitations).toEqual([])
    expect(record.grounding.citationCoveragePct).toBeLessThan(80)
    expect(record.error).toContain('citation coverage threshold')
    expect(groundingGateVerdict(events, record)).toMatch(/^refused\(/)
    expect(record.outcome).not.toBe('succeeded')
  }, 15_000)

  it('leaves a well-grounded answer citing only real identifiers untouched', async () => {
    const requestId = `grounding-gate-control-${crypto.randomUUID()}`
    const draft = [
      'SQLite WAL lets multiple readers proceed while a single writer appends frames [1].',
      'Checkpointing copies committed frames back into the main database file [2].',
    ].join(' ')
    let llmCalls = 0
    globalThis.fetch = scriptedLlm({ draft, onLlmCall: () => { llmCalls += 1 } })

    const response = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'SQLite WAL reader writer concurrency', requestId }),
    })
    const stream = await response.text()
    const events = parseAskEvents(stream)
    const recordResponse = await app.request(`/api/queries/${requestId}`)
    const { record } = await recordResponse.json() as { record: AskRecord }

    expect(llmCalls).toBe(1)
    expect(events.some((event) => event.type === 'error')).toBe(false)
    expect(events.some((event) => event.type === 'answer_replace')).toBe(false)
    expect(events.find((event) => event.type === 'quality')?.data).toMatchObject({
      status: 'strong',
      citationCoveragePct: 100,
      invalidCitations: [],
    })
    expect(terminalSignal(events)).toBe('ordinary-success')
    expect(record.outcome).toBe('succeeded')
    expect(record.answerText).toBe(draft)
    expect(record.citationIds).toEqual(['1', '2'])
    expect(record.grounding.invalidCitations).toEqual([])
    expect(stream).toContain('"type":"done"')
  }, 15_000)
})
