import { afterEach, describe, expect, it } from 'bun:test'
import app, { __test__ } from './index'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  __test__.setKnowledgeIndex([])
})

describe('grounded answer degradation', () => {
  it('lets local-only evidence fill the shared prompt budget beyond the old local quota', async () => {
    const independentDimensions = [
      'reader snapshots remain stable while writers append fresh frames',
      'writer lock handoff controls transaction serialization under load',
      'passive mode yields whenever an active reader pins an older frame',
      'full mode waits for busy handlers before copying committed pages',
      'restart mode also prevents new writers before resetting the log',
      'truncate mode releases disk space after a successful reset cycle',
      'automatic thresholds trade larger logs for less frequent copy work',
      'manual scheduling moves maintenance away from latency critical traffic',
      'long lived readers can delay recycling without blocking new appends',
      'synchronous settings change durability cost during frame publication',
      'single writer semantics still allow many concurrent snapshot readers',
      'busy timeouts bound how long maintenance waits for competing activity',
      'page cache pressure changes the practical cadence of maintenance work',
      'replication tooling must preserve ordering around committed frame marks',
      'crash recovery validates checksums before replaying the durable log',
    ]
    __test__.setKnowledgeIndex(independentDimensions.map((dimension, index) => ({
      id: `vault:${index}`,
      filePath: `/home/user/vault/wal-note-${index}.md`,
      fileName: `wal-note-${index}.md`,
      content: `SQLite WAL checkpoint concurrency evidence: ${dimension}.`,
      startLine: index + 1,
      endLine: index + 1,
    })))

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/search?')) {
        return new Response(JSON.stringify({ error: 'web disabled' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/v1/chat/completions')) {
        return new Response(
          'data: {"choices":[{"delta":{"content":"Local evidence is available [L1]."}}]}\n\n' +
          'data: [DONE]\n\n',
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        )
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    const requestId = `local-budget-${crypto.randomUUID()}`
    const response = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'SQLite WAL checkpoint concurrency evidence',
        requestId,
      }),
    })
    const stream = await response.text()
    const sourceLine = stream
      .split('\n')
      .find((line) => line.includes('"type":"sources"'))
    const sourceEvent = JSON.parse(sourceLine!.slice('data: '.length)) as {
      data: { web: unknown[]; local: unknown[] }
    }

    expect(response.status).toBe(200)
    expect(sourceEvent.data.web).toEqual([])
    expect(sourceEvent.data.local).toHaveLength(15)
    expect(stream).toContain('"type":"done"')

    const recordResponse = await app.request(`/api/queries/${requestId}`)
    const { record } = await recordResponse.json() as {
      record: {
        retrievalDiagnostics: {
          strategy: string
          web: { provider: string; state: string; selectedCount: number }
          local: {
            provider: string
            state: string
            rawCandidateCount: number
            usableCandidateCount: number
            selectedCount: number
          }
          fallbackAttempted: boolean
        }
      }
    }
    expect(record.retrievalDiagnostics).toMatchObject({
      strategy: 'weighted-rrf-v1',
      web: { provider: 'searxng', state: 'error', selectedCount: 0 },
      local: {
        provider: 'local-hybrid-bm25',
        state: 'ok',
        rawCandidateCount: 15,
        usableCandidateCount: 15,
        selectedCount: 15,
      },
      fallbackAttempted: true,
    })
  })

  it('answers from matching vault evidence when web search is unavailable', async () => {
    __test__.setKnowledgeIndex([{
      id: 'vault:1',
      filePath: '/home/user/vault/sqlite-wal.md',
      fileName: 'sqlite-wal.md',
      content: 'SQLite WAL checkpoints copy completed frames from the write-ahead log back into the main database file.',
      startLine: 10,
      endLine: 10,
    }])

    let synthesisPrompt = ''
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

      if (url.includes('/search?')) {
        return new Response(JSON.stringify({ error: 'search offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/v1/chat/completions')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          messages?: Array<{ role: string; content: string }>
        }
        synthesisPrompt = body.messages?.[0]?.content ?? ''
        return new Response(
          [
            'data: {"choices":[{"delta":{"content":"A checkpoint copies completed WAL frames back into the main database [L1]."}}]}',
            '',
            'data: [DONE]',
            '',
          ].join('\n'),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        )
      }

      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    const response = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'How do SQLite WAL checkpoints work?',
        requestId: `offline-vault-test-${crypto.randomUUID()}`,
      }),
    })
    const stream = await response.text()
    const events = stream
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)) as {
        type: string
        data?: { web?: unknown[]; local?: unknown[]; status?: string }
      })

    expect(response.status).toBe(200)
    expect(events.some((event) => event.type === 'error')).toBe(false)
    const sources = events.find((event) => event.type === 'sources')
    expect(sources?.data?.web).toEqual([])
    expect(sources?.data?.local).toHaveLength(1)
    expect(synthesisPrompt).toContain('SQLite WAL checkpoints copy completed frames')
    expect(stream).toContain('[L1]')
    expect(events.find((event) => event.type === 'quality')?.data?.status).toBe('strong')
    expect(events.some((event) => event.type === 'done')).toBe(true)
  }, 10_000)

  it('repairs incomplete sentence-level citations and stops once target coverage is reached', async () => {
    __test__.setKnowledgeIndex([{
      id: 'vault:repair',
      filePath: '/home/user/vault/citation-repair.md',
      fileName: 'citation-repair.md',
      content: 'The documented scheduler uses a bounded queue and applies backpressure when the queue is full.',
      startLine: 1,
      endLine: 1,
    }])

    let llmCalls = 0
    let citationRepairPrompt = ''
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/search?')) {
        return new Response(JSON.stringify({ error: 'search offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/v1/chat/completions')) {
        llmCalls += 1
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          stream?: boolean
          messages?: Array<{ role?: string; content?: string }>
        }
        if (body.stream === false) {
          citationRepairPrompt = body.messages?.find((message) => message.role === 'system')?.content ?? ''
          return Response.json({
            choices: [{ message: { content:
              'The documented scheduler uses a bounded queue [L1]. Backpressure is applied whenever that queue becomes full [L1].' } }],
          })
        }
        return new Response(
          'data: {"choices":[{"delta":{"content":"The documented scheduler uses a bounded queue without citation. Backpressure is applied whenever that queue becomes full [L1]."}}]}\n\n' +
          'data: [DONE]\n\n',
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        )
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    const requestId = `citation-repair-${crypto.randomUUID()}`
    const response = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'How does the documented scheduler handle a full queue?', requestId }),
    })
    const stream = await response.text()
    const recordResponse = await app.request(`/api/queries/${requestId}`)
    const { record } = await recordResponse.json() as {
      record: { answerText: string; grounding: { citationCoveragePct: number } }
    }

    expect(llmCalls).toBe(2)
    expect(citationRepairPrompt).toContain('<<<UNCITED_CLAIMS>>>')
    expect(citationRepairPrompt).toContain('The documented scheduler uses a bounded queue without citation.')
    expect(citationRepairPrompt).not.toContain('Backpressure is applied whenever that queue becomes full [L1].')
    expect(citationRepairPrompt).toContain('You may add or repeat only valid supplied citation identifiers')
    expect(citationRepairPrompt).toContain('multi-sentence quotation covers only the final sentence')
    expect(citationRepairPrompt).not.toContain('Do not add facts, interpretations, sources, or citation identifiers.')
    expect(stream.match(/"type":"answer_replace"/g)).toHaveLength(1)
    expect(record.answerText).toContain('bounded queue [L1]')
    expect(record.grounding.citationCoveragePct).toBe(100)
  })

  it('runs a second bounded repair pass when the first improves but remains below target', async () => {
    __test__.setKnowledgeIndex([{
      id: 'vault:two-pass-repair',
      filePath: '/home/user/vault/two-pass-citation-repair.md',
      fileName: 'two-pass-citation-repair.md',
      content: [
        'The documented scheduler uses a bounded queue for every submitted job.',
        'Workers apply backpressure whenever the bounded queue reaches its configured limit.',
        'The dispatcher resumes accepting work after queue capacity becomes available again.',
      ].join(' '),
      startLine: 1,
      endLine: 3,
    }])

    const firstPass = [
      'The documented scheduler uses a bounded queue for every submitted job [L1].',
      'Workers apply backpressure whenever the bounded queue reaches its configured limit [L1].',
      'The dispatcher resumes accepting work after queue capacity becomes available again.',
    ].join(' ')
    const secondPass = [
      'The documented scheduler uses a bounded queue for every submitted job [L1].',
      'Workers apply backpressure whenever the bounded queue reaches its configured limit [L1].',
      'Unknown: The dispatcher resumes accepting work after queue capacity becomes available again.',
    ].join(' ')
    let llmCalls = 0
    let repairCalls = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/search?')) {
        return new Response(JSON.stringify({ error: 'search offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/v1/chat/completions')) {
        llmCalls += 1
        const body = JSON.parse(String(init?.body ?? '{}')) as { stream?: boolean }
        if (body.stream === false) {
          repairCalls += 1
          return Response.json({
            choices: [{ message: { content: repairCalls === 1 ? firstPass : secondPass } }],
          })
        }
        const draft = [
          'The documented scheduler uses a bounded queue for every submitted job.',
          'Workers apply backpressure whenever the bounded queue reaches its configured limit [L1].',
          'The dispatcher resumes accepting work after queue capacity becomes available again.',
        ].join(' ')
        return new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: draft } }] })}\n\n` +
          'data: [DONE]\n\n',
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        )
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    const requestId = `two-pass-citation-repair-${crypto.randomUUID()}`
    const response = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'How does the documented scheduler handle a full bounded queue?',
        requestId,
      }),
    })
    const stream = await response.text()
    const recordResponse = await app.request(`/api/queries/${requestId}`)
    const { record } = await recordResponse.json() as {
      record: { answerText: string; grounding: { citationCoveragePct: number } }
    }

    expect(llmCalls).toBe(3)
    expect(repairCalls).toBe(2)
    expect(stream.match(/"type":"answer_replace"/g)).toHaveLength(2)
    expect(record.answerText).toBe(secondPass)
    expect(record.grounding.citationCoveragePct).toBe(100)
  })

  it('uses a citation-preserving cleanup after a non-improving source-aware edit', async () => {
    __test__.setKnowledgeIndex([{
      id: 'vault:cleanup-retry',
      filePath: '/home/user/vault/cleanup-retry.md',
      fileName: 'cleanup-retry.md',
      content: 'The documented scheduler uses a bounded queue for every submitted job in a no-cloud deployment with measured latency evidence.',
      startLine: 1,
      endLine: 1,
    }])

    const draft = [
      '# Scheduler report',
      '',
      'The documented scheduler uses a bounded queue for every submitted job in a no-cloud deployment [L1].',
      '**Deployment requirement.** The user requested a no-cloud deployment recommendation for this scheduler.',
      '**Evidence gap.** Published latency measurements for this exact deployment are not present in SOURCE_PACK.',
    ].join('\n')
    // Compact editors often preserve a bold lead before emitting the requested
    // marker. The server normalizes that visible marker to the required first
    // position before it accepts and scores the cleanup.
    const rawCleanup = [
      '# Scheduler report',
      '',
      'The documented scheduler uses a bounded queue for every submitted job in a no-cloud deployment [L1].',
      '**Deployment requirement.** Task premise: The user requested a no-cloud deployment recommendation for this scheduler.',
      '**Evidence gap.** Unknown: Published latency measurements for this exact deployment are not present in SOURCE_PACK.',
    ].join('\n')
    const cleanup = [
      '# Scheduler report',
      '',
      'The documented scheduler uses a bounded queue for every submitted job in a no-cloud deployment [L1].',
      'Task premise: **Deployment requirement.** The user requested a no-cloud deployment recommendation for this scheduler.',
      'Unknown: **Evidence gap.** Published latency measurements for this exact deployment are not present in SOURCE_PACK.',
    ].join('\n')
    const repairSystemPrompts: string[] = []
    let llmCalls = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/search?')) {
        return new Response(JSON.stringify({ error: 'search offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/v1/chat/completions')) {
        llmCalls += 1
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          stream?: boolean
          messages?: Array<{ role?: string; content?: string }>
        }
        if (body.stream === false) {
          repairSystemPrompts.push(
            body.messages?.find((message) => message.role === 'system')?.content ?? ''
          )
          return Response.json({
            choices: [{ message: { content: repairSystemPrompts.length === 1 ? draft : rawCleanup } }],
          })
        }
        return new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: draft } }] })}\n\n` +
          'data: [DONE]\n\n',
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        )
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    const requestId = `cleanup-retry-${crypto.randomUUID()}`
    const response = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'documented scheduler bounded queue no-cloud deployment latency evidence',
        requestId,
      }),
    })
    const stream = await response.text()
    const recordResponse = await app.request(`/api/queries/${requestId}`)
    const { record } = await recordResponse.json() as {
      record: { answerText: string; grounding: { citationCoveragePct: number } }
    }

    expect(llmCalls).toBe(3)
    expect(repairSystemPrompts).toHaveLength(2)
    expect(repairSystemPrompts[0]).toContain('<<<SOURCE_PACK>>>')
    expect(repairSystemPrompts[1]).not.toContain('<<<SOURCE_PACK>>>')
    expect(repairSystemPrompts[1]).toContain('Do not add facts or citations')
    expect(repairSystemPrompts[1]).not.toContain('You may add or repeat only valid supplied citation identifiers')
    expect(stream.match(/"type":"answer_replace"/g)).toHaveLength(1)
    expect(record.answerText).toBe(cleanup)
    expect(record.grounding.citationCoveragePct).toBe(100)
  })

  it('retrieves on a standalone query while answering the user-visible follow-up', async () => {
    let searchedFor = ''
    let userPrompt = ''
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/search?')) {
        searchedFor = new URL(url).searchParams.get('q') ?? ''
        return new Response(JSON.stringify({
          results: [{
            title: 'SQLite journaling comparison',
            url: 'https://sqlite.org/wal.html',
            content: 'WAL and rollback journals use different concurrency models.',
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/v1/chat/completions')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          messages?: Array<{ role: string; content: string }>
        }
        userPrompt = body.messages?.at(-1)?.content ?? ''
        return new Response(
          'data: {"choices":[{"delta":{"content":"WAL improves reader/writer concurrency [1]."}}]}\n\n' +
          'data: [DONE]\n\n',
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        )
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    const response = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'How does it compare?',
        retrievalQuery: 'SQLite WAL versus rollback journal concurrency',
        requestId: `rewritten-followup-test-${crypto.randomUUID()}`,
      }),
    })
    const stream = await response.text()

    expect(searchedFor).toBe('SQLite WAL versus rollback journal concurrency')
    expect(userPrompt).toBe('How does it compare?')
    expect(stream).toContain('https://sqlite.org/wal.html')
    expect(stream).toContain('"type":"done"')
  })

  it('does not report success when llama-server closes before a terminal frame', async () => {
    const requestId = `truncated-upstream-${crypto.randomUUID()}`
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/search?')) {
        return new Response(JSON.stringify({
          results: [{
            title: 'SQLite WAL',
            url: 'https://sqlite.org/wal.html',
            content: 'WAL permits concurrent readers.',
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/v1/chat/completions')) {
        return new Response(
          'data: {"choices":[{"delta":{"content":"A partial grounded answer [1]"}}]}\n\n',
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        )
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    const response = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'SQLite WAL readers', requestId }),
    })
    const stream = await response.text()
    const recordResponse = await app.request(`/api/queries/${requestId}`)
    const { record } = await recordResponse.json() as {
      record: { outcome: string; degraded: boolean; answerText: string; metrics: { outputTokens: number } }
    }

    expect(response.status).toBe(200)
    expect(stream).toContain('"type":"error"')
    expect(stream).not.toContain('"type":"done"')
    expect(recordResponse.status).toBe(200)
    expect(record.outcome).toBe('interrupted')
    expect(record.degraded).toBe(true)
    expect(record.answerText).toContain('partial grounded answer')
    expect(record.metrics.outputTokens).toBeGreaterThan(0)
  })

  it('retries a reasoning-only length completion once with thinking disabled', async () => {
    const requestId = `reasoning-budget-retry-${crypto.randomUUID()}`
    const llmBodies: Array<Record<string, unknown>> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/search?')) {
        return new Response(JSON.stringify({
          results: [{
            title: 'SQLite WAL documentation',
            url: 'https://sqlite.org/wal.html',
            content: 'SQLite WAL permits readers and a writer to proceed concurrently.',
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/v1/chat/completions')) {
        llmBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
        if (llmBodies.length === 1) {
          return new Response([
            'data: {"choices":[{"delta":{"reasoning_content":"Long private reasoning with no answer."}}]}',
            '',
            'data: {"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"prompt_tokens":100,"completion_tokens":1800,"total_tokens":1900}}',
            '',
          ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
        }
        return new Response([
          'data: {"choices":[{"delta":{"content":"WAL allows concurrent readers and one writer [1]."}}]}',
          '',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":12,"total_tokens":112}}',
          '',
        ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    const response = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'SQLite WAL concurrency', requestId }),
    })
    const stream = await response.text()
    const recordResponse = await app.request(`/api/queries/${requestId}`)
    const { record } = await recordResponse.json() as {
      record: { outcome: string; answerText: string; degraded: boolean; metrics: { outputTokens: number } }
    }

    expect(llmBodies).toHaveLength(2)
    expect(llmBodies[0]?.chat_template_kwargs).toEqual({ enable_thinking: false })
    expect(llmBodies[1]?.chat_template_kwargs).toEqual({ enable_thinking: false })
    expect(stream).toContain('Reasoning budget reached')
    expect(stream).toContain('WAL allows concurrent readers')
    expect(stream).not.toContain('"type":"error"')
    expect(stream).toContain('"type":"done"')
    expect(record.outcome).toBe('succeeded')
    expect(record.answerText).toContain('WAL allows concurrent readers')
    expect(record.degraded).toBe(true)
    expect(record.metrics.outputTokens).toBe(1812)
  })

  it('never records success when both reasoning and answer retry are empty', async () => {
    const requestId = `reasoning-budget-empty-${crypto.randomUUID()}`
    let llmCalls = 0
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/search?')) {
        return new Response(JSON.stringify({
          results: [{
            title: 'SQLite WAL documentation',
            url: 'https://sqlite.org/wal.html',
            content: 'SQLite WAL concurrency evidence.',
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/v1/chat/completions')) {
        llmCalls += 1
        return new Response(llmCalls === 1
          ? 'data: {"choices":[{"delta":{"reasoning_content":"reasoning only"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n'
          : 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    const response = await app.request('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'SQLite WAL concurrency', requestId }),
    })
    const stream = await response.text()
    const recordResponse = await app.request(`/api/queries/${requestId}`)
    const { record } = await recordResponse.json() as {
      record: { outcome: string; answerText: string; error: string | null }
    }

    expect(llmCalls).toBe(2)
    expect(stream).toContain('stopped instead of returning an empty result')
    expect(stream).toContain('"type":"error"')
    expect(stream).not.toContain('"type":"done"')
    expect(record.outcome).toBe('interrupted')
    expect(record.answerText).toBe('')
    expect(record.error).toContain('produced no answer')
  })
})
