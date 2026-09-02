import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import app, { DEFAULT_MODEL, __test__ } from './index'
import {
  LATEST_SCHEMA_VERSION,
  clearQueryRecords,
  clearSharedSessionIfRevision,
  getSharedSessionRecord,
  saveSharedSessionIfRevision,
  type SharedSessionRecord,
} from './database'

const originalFetch = globalThis.fetch
let initialSession: SharedSessionRecord

type StreamEvent = {
  type: string
  data?: unknown
  requestId?: string
}

function streamEvents(body: string): StreamEvent[] {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as StreamEvent)
}

beforeAll(async () => {
  initialSession = await getSharedSessionRecord()
  await clearQueryRecords()

  const current = await getSharedSessionRecord()
  const cleared = await clearSharedSessionIfRevision(current.revision)
  if (!cleared.ok) throw new Error('Could not isolate shared-session route test state')
})

afterEach(() => {
  globalThis.fetch = originalFetch
  __test__.setKnowledgeIndex([])
})

afterAll(async () => {
  globalThis.fetch = originalFetch
  __test__.setKnowledgeIndex([])
  await clearQueryRecords()

  const current = await getSharedSessionRecord()
  const restored = initialSession.session
    ? await saveSharedSessionIfRevision(initialSession.session, current.revision)
    : await clearSharedSessionIfRevision(current.revision)
  if (!restored.ok) throw new Error('Could not restore shared-session state after route tests')
})

describe('shared-session optimistic concurrency routes', () => {
  it('publishes an ETag, rejects a stale writer without clobbering, and deletes at the current revision', async () => {
    const initialResponse = await app.request('/api/session')
    const initialBody = await initialResponse.json() as {
      session: unknown
      revision: number
      updatedAt: number | null
    }
    const initialEtag = initialResponse.headers.get('etag')

    expect(initialResponse.status).toBe(200)
    expect(initialBody.session).toBeNull()
    expect(initialEtag).toBe(`"shared-session-${initialBody.revision}"`)

    const winner = {
      lastQuery: 'durable WAL behavior',
      lastMode: 'ai',
      lastFocusMode: 'technical',
      lastAnswer: 'The first writer won.',
      lastSources: [{
        title: 'SQLite WAL',
        url: 'https://sqlite.org/wal.html',
        snippet: 'Write-ahead logging documentation.',
      }],
      lastLocalSources: [],
    } as const
    const unguardedWrite = await app.request('/api/session', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(winner),
    })
    expect(unguardedWrite.status).toBe(428)

    const firstWrite = await app.request('/api/session', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': initialEtag!,
      },
      body: JSON.stringify(winner),
    })
    const firstWriteBody = await firstWrite.json() as {
      saved: boolean
      revision: number
      updatedAt: number
    }
    const winnerEtag = firstWrite.headers.get('etag')

    expect(firstWrite.status).toBe(200)
    expect(firstWriteBody.saved).toBe(true)
    expect(firstWriteBody.revision).toBe(initialBody.revision + 1)
    expect(winnerEtag).toBe(`"shared-session-${firstWriteBody.revision}"`)

    const staleWrite = await app.request('/api/session', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': initialEtag!,
      },
      body: JSON.stringify({
        ...winner,
        lastQuery: 'stale overwrite',
        lastAnswer: 'This value must not be stored.',
      }),
    })
    const conflict = await staleWrite.json() as {
      error: string
      revision: number
      session: typeof winner
    }

    expect(staleWrite.status).toBe(412)
    expect(staleWrite.headers.get('etag')).toBe(winnerEtag)
    expect(conflict.error).toBe('session revision conflict')
    expect(conflict.revision).toBe(firstWriteBody.revision)
    expect(conflict.session).toEqual(winner)

    const afterConflict = await app.request('/api/session')
    const afterConflictBody = await afterConflict.json() as {
      session: typeof winner
      revision: number
    }
    expect(afterConflict.status).toBe(200)
    expect(afterConflict.headers.get('etag')).toBe(winnerEtag)
    expect(afterConflictBody.session).toEqual(winner)
    expect(afterConflictBody.revision).toBe(firstWriteBody.revision)

    const deletion = await app.request('/api/session', {
      method: 'DELETE',
      headers: { 'If-Match': winnerEtag! },
    })
    const deletionBody = await deletion.json() as {
      cleared: boolean
      revision: number
      updatedAt: number
    }
    const deletedEtag = deletion.headers.get('etag')

    expect(deletion.status).toBe(200)
    expect(deletionBody.cleared).toBe(true)
    expect(deletionBody.revision).toBe(firstWriteBody.revision + 1)
    expect(deletedEtag).toBe(`"shared-session-${deletionBody.revision}"`)

    const afterDeletion = await app.request('/api/session')
    const afterDeletionBody = await afterDeletion.json() as {
      session: unknown
      revision: number
    }
    expect(afterDeletion.status).toBe(200)
    expect(afterDeletion.headers.get('etag')).toBe(deletedEtag)
    expect(afterDeletionBody.session).toBeNull()
    expect(afterDeletionBody.revision).toBe(deletionBody.revision)
  })
})

describe('durable query-record routes', () => {
  it('persists and reconstructs the exact grounded answer, source pack, citations, model, and metrics', async () => {
    const requestId = `persistence-route-${crypto.randomUUID()}`
    const query = 'How does SQLite WAL preserve read concurrency?'
    const expectedAnswer = 'SQLite WAL lets readers continue while a writer appends frames [1].'
    const servedModel = 'served-model-id'
    __test__.setKnowledgeIndex([])

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/search?')) {
        return new Response(JSON.stringify({
          results: [{
            title: 'Write-Ahead Logging',
            url: 'https://sqlite.org/wal.html?utm_source=persistence-test',
            content: 'Readers can continue while changes are appended to the WAL file.',
            engines: ['brave', 'google'],
            score: 8.5,
            publishedDate: '2025-02-03T00:00:00Z',
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/v1/chat/completions')) {
        return new Response(
          [
            `data: ${JSON.stringify({
              model: servedModel,
              choices: [{ delta: { content: 'SQLite WAL lets readers continue ' } }],
            })}`,
            '',
            `data: ${JSON.stringify({
              choices: [{ delta: { content: 'while a writer appends frames [1].' } }],
              usage: { prompt_tokens: 41, completion_tokens: 13, total_tokens: 54 },
              timings: { predicted_per_second: 65.5 },
            })}`,
            '',
            'data: [DONE]',
            '',
          ].join('\n'),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        )
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    const answerResponse = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, requestId, model: DEFAULT_MODEL }),
    })
    const answerStream = await answerResponse.text()
    const events = streamEvents(answerStream)
    const sourceEvent = events.find((event) => event.type === 'sources')
    const qualityEvent = events.find((event) => event.type === 'quality')
    const metricsEvent = events.find((event) => event.type === 'metrics')
    const streamedAnswer = events
      .filter((event) => event.type === 'delta')
      .map((event) => String(event.data ?? ''))
      .join('')

    expect(answerResponse.status).toBe(200)
    expect(events.every((event) => event.requestId === requestId)).toBe(true)
    expect(events.some((event) => event.type === 'error')).toBe(false)
    expect(events.some((event) => event.type === 'done')).toBe(true)
    expect(streamedAnswer).toBe(expectedAnswer)
    expect(sourceEvent?.data).toEqual({
      web: [{
        title: 'Write-Ahead Logging',
        url: 'https://sqlite.org/wal.html?utm_source=persistence-test',
        snippet: 'Readers can continue while changes are appended to the WAL file.',
        publishedDate: '2025-02-03T00:00:00Z',
        engines: ['brave', 'google'],
      }],
      local: [],
    })

    const recordResponse = await app.request(`/api/queries/${encodeURIComponent(requestId)}`)
    const recordPayload = await recordResponse.json() as { record: Record<string, any> }
    const record = recordPayload.record

    expect(recordResponse.status).toBe(200)
    expect(record.requestId).toBe(requestId)
    expect(record.endpoint).toBe('/api/ask')
    expect(record.query).toBe(query)
    expect(record.mode).toBe('ai')
    expect(record.requestedModel).toBe(DEFAULT_MODEL)
    expect(record.actualModel).toBe(servedModel)
    expect(record.answerText).toBe(expectedAnswer)
    expect(record.sourcePack).toEqual(sourceEvent?.data)
    expect(record.citationIds).toEqual(['1'])
    expect(record.grounding).toEqual(qualityEvent?.data)
    expect(record.grounding.status).toBe('strong')
    expect(record.metrics).toEqual({
      promptTokens: 41,
      outputTokens: 13,
      totalTokens: 54,
      tokenCountsEstimated: false,
    })
    expect(record.timings.generationMs).toBeGreaterThanOrEqual(1)
    expect(record.timings.timeToFirstTokenMs).toBeGreaterThanOrEqual(0)
    expect(record.timings.tokensPerSecond).toBe(65.5)
    expect(record.timings.endToEndMs).toBeGreaterThanOrEqual(0)
    expect(record.sourceCount).toBe(1)
    expect(record.candidateSourceCount).toBe(2)
    expect(record.degraded).toBe(false)
    expect(record.outcome).toBe('succeeded')
    expect(record.error).toBeNull()
    expect(record.completedAt).toBeNumber()
    expect(record.updatedAt).toBe(record.completedAt)

    expect(metricsEvent?.data).toMatchObject({
      promptTokens: 41,
      outputTokens: 13,
      totalTokens: 54,
      tokenCountsEstimated: false,
      model: servedModel,
    })

    const listResponse = await app.request('/api/queries?mode=ai&limit=200')
    const listPayload = await listResponse.json() as { records: Array<Record<string, unknown>> }
    const listed = listPayload.records.find((candidate) => candidate.requestId === requestId)

    expect(listResponse.status).toBe(200)
    expect(listed).toBeDefined()
    expect(listed).toMatchObject({
      requestId,
      endpoint: '/api/ask',
      query,
      mode: 'ai',
      requestedModel: DEFAULT_MODEL,
      actualModel: servedModel,
      sourceCount: 1,
      candidateSourceCount: 2,
      degraded: false,
      outcome: 'succeeded',
    })
    expect(listed).not.toHaveProperty('answerText')
    expect(listed).not.toHaveProperty('sourcePack')
  }, 10_000)
})

describe('database diagnostics routes', () => {
  it('reports cached diagnostics and runs an explicit quick check', async () => {
    const diagnosticsResponse = await app.request('/api/diagnostics/database')
    const diagnosticsPayload = await diagnosticsResponse.json() as {
      diagnostics: Record<string, any>
    }

    expect(diagnosticsResponse.status).toBe(200)
    expect(diagnosticsPayload.diagnostics).toMatchObject({
      reachable: true,
      schemaVersion: LATEST_SCHEMA_VERSION,
      expectedSchemaVersion: LATEST_SCHEMA_VERSION,
    })
    expect(diagnosticsPayload.diagnostics.path).toBe(':memory:')
    expect(diagnosticsPayload.diagnostics.integrity.status).toBe('ok')

    const quickCheckResponse = await app.request('/api/diagnostics/database/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'quick_check' }),
    })
    const quickCheckPayload = await quickCheckResponse.json() as {
      action: string
      diagnostics: Record<string, any>
    }

    expect(quickCheckResponse.status).toBe(200)
    expect(quickCheckPayload.action).toBe('quick_check')
    expect(quickCheckPayload.diagnostics.reachable).toBe(true)
    expect(quickCheckPayload.diagnostics.integrity).toMatchObject({
      kind: 'quick',
      status: 'ok',
      messages: ['ok'],
    })
    expect(quickCheckPayload.diagnostics.integrity.checkedAt).toBeNumber()
    expect(quickCheckPayload.diagnostics.maintenance.lastRunAt).toBeNumber()
  })
})
