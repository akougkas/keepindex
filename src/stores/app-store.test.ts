import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { useAppStore, type FocusMode } from './app-store'
import { useChatHistoryStore } from './chat-history-store'
import { sessionMutationQueue } from '@/lib/mutation-queue'
import { useJourneyStore } from './journey-store'
import { useSessionStore } from './session-store'

const originalFetch = globalThis.fetch

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createSseResponse(
  events: Array<Record<string, unknown>>,
  options?: { signal?: AbortSignal; initialDelayMs?: number; betweenMs?: number }
): Response {
  const encoder = new TextEncoder()
  let timer: ReturnType<typeof setTimeout> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const safeClose = () => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          /* stream already closed */
        }
      }
      let index = 0
      const push = () => {
        if (closed) return
        if (options?.signal?.aborted) return safeClose()
        if (index >= events.length) {
          return safeClose()
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(events[index])}\n`))
        index += 1
        timer = setTimeout(push, options?.betweenMs ?? 0)
      }
      timer = setTimeout(push, options?.initialDelayMs ?? 0)
      options?.signal?.addEventListener(
        'abort',
        () => {
          if (timer) clearTimeout(timer)
          safeClose()
        },
        { once: true }
      )
    },
    cancel() {
      if (timer) clearTimeout(timer)
    },
  })

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function createRawSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function resetStores(): void {
  useAppStore.getState().abortActiveRequests(false)
  useAppStore.setState({
    mode: 'ai',
    modeManuallySet: false,
    modeJustSwitched: null,
    query: '',
    activeRetrievalQuery: '',
    isLoading: false,
    isChatStreaming: false,
    isResearching: false,
    isThinking: false,
    thinking: '',
    researchThinking: '',
    chatThinking: {},
    answerMetrics: null,
    researchMetrics: null,
    chatMetrics: {},
    answerQuality: null,
    researchQuality: null,
    error: null,
    answer: '',
    sources: [],
    localSources: [],
    searchResults: [],
    searchResultsQuery: '',
    relatedQuestions: [],
    relatedQuestionsLoading: false,
    chatMessages: [],
    focusMode: 'all' as FocusMode,
    collectionsOpen: false,
    researchPlan: [],
    researchSteps: [],
    researchReport: '',
    researchSources: { web: [], local: [] },
    researchStartTime: null,
    researchEndTime: null,
    takeaways: [],
    answerStartTime: null,
  })
  useSessionStore.setState({
    lastQuery: '',
    lastMode: 'ai',
    lastFocusMode: 'all',
    lastAnswer: '',
    lastSources: [],
    lastLocalSources: [],
    searchHistory: [],
  })
  useJourneyStore.setState({ nodes: [], edges: [] })
  useChatHistoryStore.setState({ conversations: [], activeConversationId: null })
}

beforeEach(() => {
  resetStores()
})

afterEach(() => {
  useAppStore.getState().abortActiveRequests(false)
  globalThis.fetch = originalFetch
})

describe('app-store concurrency guards', () => {
  it('keeps the display query separate from a normalized retrieval query', async () => {
    let requestBody: Record<string, unknown> | null = null
    let duplicateHistoryWrites = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === '/api/ask') {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return createSseResponse([
          { type: 'delta', data: 'answer' },
          { type: 'done' },
        ])
      }
      if (url === '/api/related') return jsonResponse({ questions: [] })
      if (url === '/api/takeaways') return jsonResponse({ takeaways: [] })
      if (url === '/api/history') {
        duplicateHistoryWrites += 1
        return jsonResponse({ saved: true })
      }
      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as typeof fetch

    await useAppStore.getState().streamAnswer('  How does it compare?  ', {
      retrievalQuery: '  Rust versus Go memory safety comparison  ',
    })
    await sessionMutationQueue.runAfterPending(async () => {})

    expect(requestBody?.query).toBe('How does it compare?')
    expect(requestBody?.retrievalQuery).toBe('Rust versus Go memory safety comparison')
    expect(requestBody?.retrievalQuery).not.toBe(requestBody?.query)
    expect(useAppStore.getState().query).toBe('How does it compare?')
    expect(useAppStore.getState().activeRetrievalQuery).toBe('Rust versus Go memory safety comparison')
    expect(duplicateHistoryWrites).toBe(0)
  })

  it('processes a final SSE frame even when the stream closes without a newline', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === '/api/ask') {
        return createRawSseResponse([
          'data: {"type":"delta","data":"grounded answer"}\n',
          'data: {"type":"done"}',
        ])
      }
      if (url === '/api/related') return jsonResponse({ questions: [] })
      if (url === '/api/takeaways') return jsonResponse({ takeaways: [] })
      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as typeof fetch

    await useAppStore.getState().streamAnswer('unterminated final frame')

    expect(useAppStore.getState().answer).toBe('grounded answer')
    expect(useAppStore.getState().error).toBeNull()
    expect(useAppStore.getState().isLoading).toBe(false)
  })

  it('replaces the streamed draft after server-side citation repair', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === '/api/ask') {
        return createSseResponse([
          { type: 'delta', data: 'uncited draft' },
          { type: 'answer_replace', data: 'repaired answer [1]' },
          { type: 'done' },
        ])
      }
      if (url === '/api/related') return jsonResponse({ questions: [] })
      if (url === '/api/takeaways') return jsonResponse({ takeaways: [] })
      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as typeof fetch

    await useAppStore.getState().streamAnswer('repair the citations')

    expect(useAppStore.getState().answer).toBe('repaired answer [1]')
    expect(useAppStore.getState().error).toBeNull()
  })

  it('shows an explicit error when done follows reasoning without an answer delta', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === '/api/ask') {
        return createSseResponse([
          { type: 'thinking_delta', data: 'reasoning consumed the budget' },
          { type: 'done' },
        ])
      }
      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as typeof fetch

    await useAppStore.getState().streamAnswer('reasoning-only response')

    const state = useAppStore.getState()
    expect(state.answer).toBe('')
    expect(state.thinking).toContain('reasoning consumed the budget')
    expect(state.isLoading).toBe(false)
    expect(state.isThinking).toBe(false)
    expect(state.error).toContain('finished without producing an answer')
  })

  it('keeps only latest AI answer under rapid submits', async () => {
    let chatCall = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url

      if (url === '/api/ask') {
        chatCall += 1
        if (chatCall === 1) {
          return createSseResponse(
            [
              { type: 'sources', data: { web: [], local: [] } },
              { type: 'delta', data: 'first-answer' },
              { type: 'done' },
            ],
            { signal: (init?.signal ?? undefined) as AbortSignal | undefined, initialDelayMs: 60, betweenMs: 5 }
          )
        }
        return createSseResponse(
          [
            { type: 'sources', data: { web: [], local: [] } },
            { type: 'delta', data: 'second-answer' },
            { type: 'done' },
          ],
          { signal: (init?.signal ?? undefined) as AbortSignal | undefined, initialDelayMs: 2, betweenMs: 2 }
        )
      }

      if (url === '/api/related') return jsonResponse({ questions: ['next'] })
      if (url === '/api/takeaways') return jsonResponse({ takeaways: ['one'] })

      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as typeof fetch

    void useAppStore.getState().streamAnswer('first query')
    await wait(5)
    void useAppStore.getState().streamAnswer('second query')
    await wait(130)

    const state = useAppStore.getState()
    expect(state.query).toBe('second query')
    expect(state.answer).toBe('second-answer')
    expect(state.answer.includes('first-answer')).toBe(false)
    expect(state.isLoading).toBe(false)
  })

  it('renders reasoning_content events before the first answer token', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === '/api/ask') {
        return createSseResponse(
          [
            { type: 'thinking_delta', data: 'checking evidence now' },
            { type: 'delta', data: 'grounded answer' },
            { type: 'done' },
          ],
          { signal: (init?.signal ?? undefined) as AbortSignal | undefined, initialDelayMs: 1, betweenMs: 35 }
        )
      }
      if (url === '/api/related') return jsonResponse({ questions: [] })
      if (url === '/api/takeaways') return jsonResponse({ takeaways: [] })
      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as typeof fetch

    void useAppStore.getState().streamAnswer('reasoning stream test')
    await wait(12)
    expect(useAppStore.getState().thinking).toBe('checking evidence now')
    expect(useAppStore.getState().answer).toBe('')
    expect(useAppStore.getState().isThinking).toBe(true)

    await wait(100)
    expect(useAppStore.getState().answer).toBe('grounded answer')
    expect(useAppStore.getState().isThinking).toBe(false)
  })

  it('drops in-flight AI stream updates after mode switch', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === '/api/ask') {
        return createSseResponse(
          [
            { type: 'sources', data: { web: [{ title: 't', url: 'u', snippet: 's' }], local: [] } },
            { type: 'delta', data: 'should-not-land' },
            { type: 'done' },
          ],
          { signal: (init?.signal ?? undefined) as AbortSignal | undefined, initialDelayMs: 40, betweenMs: 5 }
        )
      }
      if (url === '/api/related') return jsonResponse({ questions: [] })
      if (url === '/api/takeaways') return jsonResponse({ takeaways: [] })
      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as typeof fetch

    void useAppStore.getState().streamAnswer('cancel me')
    await wait(8)
    useAppStore.getState().setMode('search')
    await wait(90)

    const state = useAppStore.getState()
    expect(state.mode).toBe('search')
    expect(state.answer).toBe('')
    expect(state.sources.length).toBe(0)
    expect(state.isLoading).toBe(false)
  })

  it('removes empty assistant placeholder on chat abort-and-retry', async () => {
    let chatCall = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === '/api/chat/conversation') {
        chatCall += 1
        if (chatCall === 1) {
          return createSseResponse(
            [{ type: 'delta', data: 'late-first' }, { type: 'done' }],
            { signal: (init?.signal ?? undefined) as AbortSignal | undefined, initialDelayMs: 60, betweenMs: 5 }
          )
        }
        return createSseResponse(
          [{ type: 'delta', data: 'reply-two' }, { type: 'done' }],
          { signal: (init?.signal ?? undefined) as AbortSignal | undefined, initialDelayMs: 2, betweenMs: 2 }
        )
      }
      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as typeof fetch

    useAppStore.setState({ mode: 'chat' })
    void useAppStore.getState().sendChatMessage('first')
    await wait(6)
    void useAppStore.getState().sendChatMessage('second')
    await wait(130)

    const state = useAppStore.getState()
    const hasEmptyAssistant = state.chatMessages.some(
      (m) => m.role === 'assistant' && !m.content.trim()
    )
    expect(state.isChatStreaming).toBe(false)
    expect(state.chatMessages[state.chatMessages.length - 1]?.content).toBe('reply-two')
    expect(hasEmptyAssistant).toBe(false)
  })

  it('keeps only latest search results under rapid submits', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url
      if (url.startsWith('/api/search')) {
        if (url.includes('q=first%20search')) {
          await wait(70)
          return jsonResponse({
            results: [{ title: 'first', url: 'https://first', snippet: 'first' }],
          })
        }
        await wait(5)
        return jsonResponse({
          results: [{ title: 'second', url: 'https://second', snippet: 'second' }],
        })
      }
      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as typeof fetch

    void useAppStore.getState().fetchSearchResults('first search')
    await wait(8)
    void useAppStore.getState().fetchSearchResults('second search')
    await wait(120)

    const state = useAppStore.getState()
    expect(state.query).toBe('second search')
    expect(state.searchResultsQuery).toBe('second search')
    expect(state.searchResults.length).toBe(1)
    expect(state.searchResults[0]?.title).toBe('second')
    expect(state.isLoading).toBe(false)
  })

  it('sets actionable error when AI stream ends without done event', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === '/api/ask') {
        return createSseResponse(
          [
            { type: 'sources', data: { web: [], local: [] } },
            { type: 'delta', data: 'partial' },
          ],
          { signal: (init?.signal ?? undefined) as AbortSignal | undefined, initialDelayMs: 2, betweenMs: 2 }
        )
      }
      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as typeof fetch

    await useAppStore.getState().streamAnswer('interrupted stream test')
    await wait(30)

    const state = useAppStore.getState()
    expect(state.answer).toBe('partial')
    expect(state.isLoading).toBe(false)
    expect(state.error).toBe('Response interrupted before completion. Please retry.')
  })

  it('sets actionable error when chat stream ends without done event', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === '/api/chat/conversation') {
        return createSseResponse(
          [{ type: 'delta', data: 'chat-partial' }],
          { signal: (init?.signal ?? undefined) as AbortSignal | undefined, initialDelayMs: 2, betweenMs: 2 }
        )
      }
      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as typeof fetch

    useAppStore.setState({ mode: 'chat' })
    await useAppStore.getState().sendChatMessage('chat interrupted test')
    await wait(30)

    const state = useAppStore.getState()
    expect(state.chatMessages[state.chatMessages.length - 1]?.content).toBe('chat-partial')
    expect(state.isChatStreaming).toBe(false)
    expect(state.error).toBe('Response interrupted before completion. Please retry.')
  })

  it('sets actionable error when research stream ends without done event', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === '/api/research') {
        return createSseResponse(
          [
            { type: 'plan', data: { subQuestions: ['q1'] } },
            { type: 'delta', data: 'research-partial' },
          ],
          { signal: (init?.signal ?? undefined) as AbortSignal | undefined, initialDelayMs: 2, betweenMs: 2 }
        )
      }
      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as typeof fetch

    useAppStore.setState({ mode: 'research' })
    await useAppStore.getState().startResearch('research interrupted test')
    await wait(30)

    const state = useAppStore.getState()
    expect(state.researchReport).toBe('research-partial')
    expect(state.isResearching).toBe(false)
    expect(state.error).toBe('Research stream interrupted before completion. Please retry.')
  })
})

describe('app-store workspace reset', () => {
  it('clears every transient trace, metric, progress flag, and preview', () => {
    useAppStore.setState({
      query: 'previous query',
      isLoading: true,
      isChatStreaming: true,
      isResearching: true,
      isThinking: true,
      thinking: 'answer reasoning',
      researchThinking: 'research reasoning',
      chatThinking: { assistant: 'chat reasoning' },
      chatMetrics: {
        assistant: {
          model: 'test-model',
          promptTokens: 1,
          outputTokens: 2,
          totalTokens: 3,
          durationMs: 4,
          endToEndMs: 5,
          timeToFirstTokenMs: 1,
          tokensPerSecond: 2,
          tokenCountsEstimated: false,
        },
      },
      relatedQuestionsLoading: true,
      researchStartTime: 100,
      researchEndTime: 200,
      sourcePreview: {
        type: 'web',
        index: 0,
        source: { title: 'old', url: 'https://example.com', snippet: 'old' },
      },
    })

    useAppStore.getState().resetResults()
    const state = useAppStore.getState()

    expect(state.isLoading).toBe(false)
    expect(state.isChatStreaming).toBe(false)
    expect(state.isResearching).toBe(false)
    expect(state.isThinking).toBe(false)
    expect(state.thinking).toBe('')
    expect(state.researchThinking).toBe('')
    expect(state.chatThinking).toEqual({})
    expect(state.chatMetrics).toEqual({})
    expect(state.relatedQuestionsLoading).toBe(false)
    expect(state.researchStartTime).toBeNull()
    expect(state.researchEndTime).toBeNull()
    expect(state.sourcePreview).toBeNull()
  })

  it('drops stale non-chat traces when loading a collection without clearing chat', () => {
    const chatMessages = [
      { id: 'user-1', role: 'user' as const, content: 'keep this conversation' },
      { id: 'assistant-1', role: 'assistant' as const, content: 'kept reply' },
    ]
    useAppStore.setState({
      thinking: 'old answer trace',
      researchThinking: 'old research trace',
      chatMessages,
      chatThinking: { 'assistant-1': 'kept chat trace' },
      sourcePreview: {
        type: 'web',
        index: 0,
        source: { title: 'old', url: 'https://example.com/old', snippet: 'old' },
      },
    })

    useAppStore.getState().loadFromCollection({
      query: 'saved query',
      answer: 'saved answer',
      sources: [],
      mode: 'ai',
    })
    const state = useAppStore.getState()

    expect(state.thinking).toBe('')
    expect(state.researchThinking).toBe('')
    expect(state.sourcePreview).toBeNull()
    expect(state.chatMessages).toEqual(chatMessages)
    expect(state.chatThinking).toEqual({ 'assistant-1': 'kept chat trace' })
  })
})

describe('rejected synthesis', () => {
  it('discards the draft and never derives or saves content when the server rejects grounding', async () => {
    const calls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      calls.push(url)
      if (url === '/api/ask') return createSseResponse([
        { type: 'sources', data: { web: [{ title: 'Official release', url: 'https://example.org/releases', snippet: 'Release notes' }], local: [] } },
        { type: 'delta', data: 'Invented project architecture with no supporting source.' },
        { type: 'done', data: { grounded: false } },
      ])
      throw new Error(`Rejected answers must not trigger ${url}`)
    }) as typeof fetch
    await useAppStore.getState().streamAnswer('latest widget-tool release and features')
    expect(useAppStore.getState().answer).toBe('')
    expect(useAppStore.getState().error).toContain('unverified draft was discarded')
    expect(useAppStore.getState().sources).toHaveLength(1)
    expect(useAppStore.getState().takeaways).toEqual([])
    expect(useAppStore.getState().relatedQuestions).toEqual([])
    expect(calls).toEqual(['/api/ask'])
    expect(useSessionStore.getState().lastAnswer).toBe('')
    expect(useJourneyStore.getState().nodes).toEqual([])
  })
})
