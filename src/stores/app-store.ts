import { create } from 'zustand'
import { useSessionStore } from './session-store'
import { useSettingsStore } from './settings-store'
import { useChatHistoryStore } from './chat-history-store'
import { useJourneyStore } from './journey-store'
import { readJsonSse, type JsonSseEvent } from '@/lib/sse'
import { createId } from '@/lib/utils'

export type Mode = 'search' | 'ai' | 'chat' | 'research'

export type SearchTarget = 'all' | 'web' | 'files' | 'vault' | 'documents' | 'history'
export type SourceKind = 'web' | 'history' | 'note' | 'document' | 'code' | 'file'

export type Source = {
  id?: string
  kind?: SourceKind
  title: string
  url: string
  snippet: string
  score?: number
  nativeRank?: number
  sourceTypes?: SourceKind[]
  engines?: string[]
  publishedDate?: string
  filePath?: string
  fileName?: string
  startLine?: number
  endLine?: number
  resourceId?: string
  resourceLabel?: string
  extension?: string
  mimeType?: string
  metadataOnly?: boolean
  aliases?: string[]
  tags?: string[]
  modifiedAt?: number
  sourceType?: 'web' | 'history'
  browser?: string
  profile?: string
  visitCount?: number
  lastVisitedAt?: number
}

export type KnowledgeSource = {
  filePath: string
  fileName: string
  content: string
  startLine?: number
  endLine?: number
  score?: number
  resourceId?: string
  resourceLabel?: string
  indexedAt?: number
  sourceKind?: 'note' | 'document' | 'code' | 'file'
  extension?: string
  mimeType?: string
  extractor?: string
  metadataOnly?: boolean
  aliases?: string[]
  tags?: string[]
  outgoingLinks?: string[]
  modifiedAt?: number
}

export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string }

export type QueryMetrics = {
  model: string | null
  promptTokens: number
  outputTokens: number
  totalTokens: number
  durationMs: number
  endToEndMs: number
  timeToFirstTokenMs: number | null
  tokensPerSecond: number
  tokenCountsEstimated: boolean
}

export type GroundingAssessment = {
  answerMode?: 'synthesis' | 'extractive'
  status: 'strong' | 'mixed' | 'weak' | 'ungrounded'
  score: number
  citationCoveragePct: number
  citedSourceCount: number
  sourceCount: number
  invalidCitations: string[]
  note: string
  addedCitationCount?: number
}

export type ResearchStep = {
  type: 'plan' | 'searching' | 'reading' | 'search_results' | 'analyzing' | 'analysis' | 'gap_fill' | 'synthesizing' | 'warning' | 'done'
  data: unknown
  timestamp: number
}

type RequestEvent<Type extends string, Data = unknown> = JsonSseEvent<Type, Data>

export type AnswerProgress = {
  phase: string
  status: 'ok' | 'error' | 'aborted' | 'skipped'
  elapsedMs: number
  durationMs: number
  detail: Record<string, string | number | boolean | null>
}

type AnswerStreamEvent =
  | RequestEvent<'error', string>
  | RequestEvent<'progress', AnswerProgress>
  | RequestEvent<'sources', { web?: Source[]; local?: KnowledgeSource[] }>
  | RequestEvent<'thinking_delta', string>
  | RequestEvent<'delta', string>
  | RequestEvent<'answer_replace', string>
  | RequestEvent<'quality', GroundingAssessment>
  | RequestEvent<'metrics', QueryMetrics>
  | RequestEvent<'done', { grounded?: boolean; model?: string }>

type ChatStreamEvent =
  | RequestEvent<'error', string>
  | RequestEvent<'thinking_delta', string>
  | RequestEvent<'delta', string>
  | RequestEvent<'metrics', QueryMetrics>
  | RequestEvent<'done'>

type ResearchStreamEvent =
  | RequestEvent<'error', string>
  | RequestEvent<'plan', { subQuestions?: string[] }>
  | RequestEvent<'searching' | 'reading' | 'search_results' | 'analyzing' | 'analysis' | 'gap_fill' | 'synthesizing' | 'warning' | 'done'>
  | RequestEvent<'sources', { web?: Source[]; local?: KnowledgeSource[] }>
  | RequestEvent<'thinking_delta', string>
  | RequestEvent<'delta', string>
  | RequestEvent<'answer_replace', string>
  | RequestEvent<'quality', GroundingAssessment>
  | RequestEvent<'metrics', QueryMetrics>

export type FocusMode = 'all' | 'news' | 'academic' | 'videos' | 'images' | 'code' | 'social' | 'reddit' | 'x'

export type PinnedResult = {
  query: string
  answer: string
  sources: Source[]
  localSources: KnowledgeSource[]
  mode: 'ai' | 'research'
  pinnedAt: number
}

export interface QueryContextOptions {
  handoffContext?: string
  retrievalQuery?: string
}

export type FederatedSearchMeta = {
  counts: { web: number; local: number; history: number; total: number }
  available: { web: number; local: number; history: number }
  semantic: {
    requested: boolean
    mode: 'embedding-rerank' | 'keyword'
    queries: string[]
    warning?: string
  }
  degraded: boolean
}

const QUERY_MAX_LENGTH = 1000
const CONTEXT_HINT_MAX_LENGTH = 3000
const ANSWER_STREAM_ENDPOINT = typeof window === 'undefined' ? '/api/ask' : '/api/ask/stream'

// Module-level abort controllers (not serializable, outside store)
let answerAbort: AbortController | null = null
let searchAbort: AbortController | null = null
let chatAbort: AbortController | null = null
let researchAbort: AbortController | null = null
let relatedAbort: AbortController | null = null
let takeawaysAbort: AbortController | null = null

let answerGeneration = 0
let searchGeneration = 0
let chatGeneration = 0
let researchGeneration = 0

function nextGeneration(kind: 'answer' | 'search' | 'chat' | 'research'): number {
  if (kind === 'answer') {
    answerGeneration += 1
    return answerGeneration
  }
  if (kind === 'search') {
    searchGeneration += 1
    return searchGeneration
  }
  if (kind === 'chat') {
    chatGeneration += 1
    return chatGeneration
  }
  researchGeneration += 1
  return researchGeneration
}

function isCurrentGeneration(kind: 'answer' | 'search' | 'chat' | 'research', generation: number): boolean {
  if (kind === 'answer') return answerGeneration === generation
  if (kind === 'search') return searchGeneration === generation
  if (kind === 'chat') return chatGeneration === generation
  return researchGeneration === generation
}

function normalizeQuery(input: string): string {
  const trimmed = input.trim()
  return trimmed.length > QUERY_MAX_LENGTH ? trimmed.slice(0, QUERY_MAX_LENGTH) : trimmed
}

function normalizeContextHint(input?: string): string {
  if (!input) return ''
  const cleaned = input.replace(/\s+/g, ' ').trim()
  return cleaned.length > CONTEXT_HINT_MAX_LENGTH ? `${cleaned.slice(0, CONTEXT_HINT_MAX_LENGTH)}...` : cleaned
}

function wordCount(input: string): number {
  return input.trim().split(/\s+/).filter(Boolean).length
}

function isContextGenerationCurrent(contextMode: 'ai' | 'research' | undefined, generation: number | undefined): boolean {
  if (generation == null) return true
  if (contextMode === 'research') return isCurrentGeneration('research', generation)
  return isCurrentGeneration('answer', generation)
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

function setError(msg: string | null) {
  return { error: msg }
}

function buildJourneyContext(query: string, mode: Mode): string {
  return useJourneyStore.getState().buildContextBlock(query, mode)
}

interface AppState {
  mode: Mode
  modeManuallySet: boolean
  modeJustSwitched: Mode | null
  query: string
  activeRetrievalQuery: string
  isLoading: boolean
  isChatStreaming: boolean
  isResearching: boolean
  isThinking: boolean
  thinking: string
  researchThinking: string
  chatThinking: Record<string, string>
  answerMetrics: QueryMetrics | null
  researchMetrics: QueryMetrics | null
  chatMetrics: Record<string, QueryMetrics>
  answerQuality: GroundingAssessment | null
  researchQuality: GroundingAssessment | null
  answerProgress: AnswerProgress[]
  error: string | null
  answer: string
  sources: Source[]
  localSources: KnowledgeSource[]
  searchResults: Source[]
  searchResultsQuery: string
  relatedQuestions: string[]
  relatedQuestionsLoading: boolean
  relatedQuestionsStatus: 'idle' | 'loading' | 'ok' | 'unavailable'
  chatMessages: ChatMessage[]
  focusMode: FocusMode
  searchTarget: SearchTarget
  semanticSearch: boolean
  searchMeta: FederatedSearchMeta | null
  collectionsOpen: boolean
  setCollectionsOpen: (open: boolean) => void
  setMode: (mode: Mode) => void
  setModeFromIntent: (mode: Mode) => void
  abortActiveRequests: (persistPartial?: boolean) => void
  setFocusMode: (mode: FocusMode) => void
  setSearchTarget: (target: SearchTarget) => void
  setSemanticSearch: (enabled: boolean) => void
  clearError: () => void
  submitQuery: (query: string) => void
  setIsLoading: (isLoading: boolean) => void
  streamAnswer: (query: string, options?: QueryContextOptions) => Promise<void>
  startResearch: (query: string, options?: QueryContextOptions) => Promise<void>
  fetchSearchResults: (query: string) => Promise<void>
  fetchRelatedQuestions: (query: string, answer: string, generation?: number) => Promise<void>
  sendChatMessage: (content: string) => Promise<void>
  clearChat: () => void
  loadFromCollection: (item: {
    query: string
    answer: string
    sources: Source[]
    localSources?: KnowledgeSource[]
    mode?: Mode
    researchPlan?: string[]
  }) => void
  resetResults: () => void
  // Research state
  researchPlan: string[]
  researchSteps: ResearchStep[]
  researchReport: string
  researchSources: { web: Source[]; local: KnowledgeSource[] }
  researchStartTime: number | null
  researchEndTime: number | null
  takeaways: string[]
  answerStartTime: number | null
  fetchTakeaways: (answer: string, contextMode?: 'ai' | 'research', generation?: number) => Promise<void>
  // Source preview drawer
  pinnedResult: PinnedResult | null
  pinCurrentResult: () => void
  clearPinnedResult: () => void
  sourcePreview:
    | { type: 'web'; index: number; source: Source }
    | { type: 'local'; index: number; source: KnowledgeSource }
    | null
  setSourcePreview: (
    preview:
      | { type: 'web'; index: number; source: Source }
      | { type: 'local'; index: number; source: KnowledgeSource }
      | null
  ) => void
  clearSourcePreview: () => void
}

export const useAppStore = create<AppState>()((set, get) => ({
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
  answerProgress: [],
  error: null,
  answer: '',
  sources: [],
  localSources: [],
  searchResults: [],
  searchResultsQuery: '',
  relatedQuestions: [],
  relatedQuestionsLoading: false,
  relatedQuestionsStatus: 'idle',
  chatMessages: [],
  focusMode: 'all',
  searchTarget: 'all',
  semanticSearch: true,
  searchMeta: null,
  collectionsOpen: false,
  setCollectionsOpen: (open) => set({ collectionsOpen: open }),
  clearError: () => set(setError(null)),
  abortActiveRequests: (persistPartial = true) => {
    const interrupted = get()
    nextGeneration('answer')
    nextGeneration('search')
    nextGeneration('chat')
    nextGeneration('research')
    answerAbort?.abort()
    searchAbort?.abort()
    chatAbort?.abort()
    researchAbort?.abort()
    relatedAbort?.abort()
    takeawaysAbort?.abort()
    set({
      isLoading: false,
      isChatStreaming: false,
      isResearching: false,
      isThinking: false,
      relatedQuestionsLoading: false,
    })
    if (persistPartial) {
      const partialAnswer = interrupted.mode === 'research' ? interrupted.researchReport : interrupted.answer
      const partialSources = interrupted.mode === 'research' ? interrupted.researchSources.web : interrupted.sources
      const partialLocalSources = interrupted.mode === 'research' ? interrupted.researchSources.local : interrupted.localSources
      if ((interrupted.mode === 'ai' || interrupted.mode === 'research') && partialAnswer.trim()) {
        useSessionStore.getState().setLastSession({
          query: interrupted.query,
          mode: interrupted.mode,
          focusMode: interrupted.focusMode,
          answer: partialAnswer,
          sources: partialSources,
          localSources: partialLocalSources,
        })
      }
      if (interrupted.mode === 'chat' && interrupted.chatMessages.some((message) => message.content.trim())) {
        useChatHistoryStore.getState().saveConversation(
          interrupted.chatMessages.filter((message) => message.content.trim())
        )
      }
    }
  },

  setMode: (mode) => {
    if (get().mode === mode) return
    // Snapshot any partial work while the old mode is still authoritative.
    get().abortActiveRequests()
    set({
      mode,
      modeManuallySet: true,
      modeJustSwitched: null,
      error: null,
      relatedQuestionsLoading: false,
    })
  },

  setModeFromIntent: (mode) => {
    set({ mode, modeManuallySet: false, modeJustSwitched: mode, error: null })
    setTimeout(() => set({ modeJustSwitched: null }), 1500)
  },
  setFocusMode: (focusMode) => set({ focusMode }),
  setSearchTarget: (searchTarget) => set({ searchTarget }),
  setSemanticSearch: (semanticSearch) => set({ semanticSearch }),
  submitQuery: (query) => set({ query, isLoading: true }),
  setIsLoading: (isLoading) => set({ isLoading }),

  streamAnswer: async (query, options) => {
    answerAbort?.abort()
    relatedAbort?.abort()
    takeawaysAbort?.abort()
    answerAbort = new AbortController()
    const signal = answerAbort.signal
    const generation = nextGeneration('answer')
    const requestId = createId()

    const truncated = normalizeQuery(query)
    if (!truncated) return
    const handoffContext = normalizeContextHint(options?.handoffContext)
    const retrievalQuery = normalizeQuery(options?.retrievalQuery ?? '')
    const selectedModel = useSettingsStore.getState().selectedModel

    set({
      query: truncated,
      activeRetrievalQuery: retrievalQuery || truncated,
      isLoading: true,
      isThinking: false,
      thinking: '',
      error: null,
      answer: '',
      sources: [],
      localSources: [],
      relatedQuestions: [],
      relatedQuestionsLoading: false,
      takeaways: [],
      answerMetrics: null,
      answerQuality: null,
      answerProgress: [],
      searchMeta: null,
      answerStartTime: Date.now(),
      modeManuallySet: false,
    })
    try {
      const focusMode = get().focusMode
      const searchTarget = get().searchTarget
      const semanticSearch = get().semanticSearch
      const journeyContext = buildJourneyContext(truncated, 'ai')
      const res = await fetch(ANSWER_STREAM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: truncated,
          retrievalQuery: retrievalQuery || undefined,
          focus: focusMode,
          target: searchTarget,
          semantic: semanticSearch,
          journeyContext,
          handoffContext: handoffContext || undefined,
          requestId,
          model: selectedModel,
        }),
        signal,
      })
      if (!res.ok || !res.body) throw new Error('Chat request failed')
      let receivedDone = false
      let receivedTerminalError = false
      await readJsonSse<AnswerStreamEvent>(res.body, {
        signal,
        shouldContinue: () => isCurrentGeneration('answer', generation),
        onEvent: (payload) => {
          if (payload.requestId && payload.requestId !== requestId) return
          if (!isCurrentGeneration('answer', generation)) return false
          if (payload.type === 'error') {
            receivedTerminalError = true
            set({ answer: '', isLoading: false, isThinking: false, relatedQuestionsLoading: false, ...setError(payload.data ?? 'Something went wrong.') })
            return false
          }
          if (payload.type === 'progress') {
            if (payload.data) {
              set((state) => ({ answerProgress: [...state.answerProgress, payload.data!].slice(-12) }))
            }
          } else if (payload.type === 'sources') {
            const d = payload.data ?? {}
            set({ sources: d.web ?? [], localSources: d.local ?? [] })
          } else if (payload.type === 'thinking_delta') {
            set((s) => ({ thinking: s.thinking + (payload.data ?? ''), isThinking: true }))
          } else if (payload.type === 'delta') {
            set((s) => ({ answer: s.answer + (payload.data ?? ''), isThinking: false }))
          } else if (payload.type === 'answer_replace') {
            set({ answer: payload.data ?? '', isThinking: false })
          } else if (payload.type === 'quality') {
            set({ answerQuality: payload.data ?? null })
          } else if (payload.type === 'metrics') {
            set({ answerMetrics: payload.data ?? null })
          } else if (payload.type === 'done') {
            receivedDone = true
            if (payload.data?.grounded === false) {
              receivedTerminalError = true
              set({ answer: '', thinking: '', isLoading: false, isThinking: false,
                relatedQuestions: [], takeaways: [], relatedQuestionsLoading: false,
                ...setError('KeepIndex could not support this answer with the retrieved evidence. The unverified draft was discarded. Review the sources or narrow your question.'),
              })
              return false
            }
            set({ isLoading: false, isThinking: false })
            const q = get().query
            const a = get().answer
            if (!a.trim()) {
              receivedTerminalError = true
              set({
                isLoading: false,
                isThinking: false,
                relatedQuestionsLoading: false,
                ...setError('The model finished without producing an answer. KeepIndex stopped the empty response; retry or choose a non-reasoning model.'),
              })
              return false
            }
            if (q && a) {
              void get().fetchRelatedQuestions(q, a, generation)
              void get().fetchTakeaways(a, 'ai', generation)
              useSessionStore.getState().setLastSession({
                query: q,
                mode: 'ai',
                focusMode: get().focusMode,
                answer: a,
                sources: get().sources,
                localSources: get().localSources,
              })
              useSessionStore.getState().addToSearchHistory(q, false)
              useJourneyStore.getState().addNode({
                mode: 'ai',
                action: 'answer_completed',
                query: q,
                answer: a,
                metadata: {
                  webSourceCount: get().sources.length,
                  localSourceCount: get().localSources.length,
                },
              })
            } else {
              set({ relatedQuestionsLoading: false })
            }
          }
        },
      })
      if (receivedTerminalError) return
      if (isCurrentGeneration('answer', generation)) {
        if (!receivedDone && !signal.aborted) {
          set({
            isLoading: false,
            isThinking: false,
            relatedQuestionsLoading: false,
            ...setError('Response interrupted before completion. Please retry.'),
          })
        } else {
          set({ isLoading: false, isThinking: false })
        }
      }
    } catch (err) {
      if (!isCurrentGeneration('answer', generation)) return
      if (isAbortError(err)) {
        set({ isLoading: false, isThinking: false, relatedQuestionsLoading: false })
        return
      }
      const msg =
        err instanceof TypeError && err.message.includes('fetch')
          ? 'Could not connect to the server. Is bun run dev running?'
          : err instanceof Error && (err.message.includes('refused') || err.message.includes('Failed to fetch'))
            ? 'Engine unavailable. Check that your local inference server is running and configured.'
            : 'Something went wrong. Please try again.'
      set({ isLoading: false, isThinking: false, relatedQuestionsLoading: false, ...setError(msg) })
    }
  },

  fetchRelatedQuestions: async (query, answer, generation) => {
    if (generation != null && !isCurrentGeneration('answer', generation)) return
    const trimmedQuery = query.trim()
    const trimmedAnswer = answer.trim()
    if (!trimmedQuery || trimmedAnswer.length < 80 || wordCount(trimmedAnswer) < 12) {
      set({ relatedQuestions: [], relatedQuestionsLoading: false, relatedQuestionsStatus: 'idle' })
      return
    }
    relatedAbort?.abort()
    relatedAbort = new AbortController()
    const signal = relatedAbort.signal
    const selectedModel = useSettingsStore.getState().selectedModel
    set({ relatedQuestionsLoading: true, relatedQuestions: [], relatedQuestionsStatus: 'loading' })
    try {
      const res = await fetch('/api/related', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmedQuery, answer: trimmedAnswer, model: selectedModel }),
        signal,
      })
      if (!res.ok) throw new Error('related request failed')
      const data = (await res.json()) as { status?: string; questions?: string[] }
      if (signal.aborted) return
      if (generation != null && !isCurrentGeneration('answer', generation)) return
      if (get().mode !== 'ai' || get().query !== query) {
        set({ relatedQuestionsLoading: false, relatedQuestionsStatus: 'idle' })
        return
      }
      const isUnavailable = data.status === 'unavailable'
      set({
        relatedQuestions: data.questions ?? [],
        relatedQuestionsLoading: false,
        relatedQuestionsStatus: isUnavailable ? 'unavailable' : 'ok',
      })
    } catch (err) {
      if (isAbortError(err)) {
        if (generation == null || isCurrentGeneration('answer', generation)) {
          set({ relatedQuestionsLoading: false })
        }
        return
      }
      if (generation == null || isCurrentGeneration('answer', generation)) {
        set({ relatedQuestions: [], relatedQuestionsLoading: false, relatedQuestionsStatus: 'unavailable' })
      }
    }
  },

  fetchSearchResults: async (query) => {
    searchAbort?.abort()
    searchAbort = new AbortController()
    const signal = searchAbort.signal
    const generation = nextGeneration('search')

    const truncated = normalizeQuery(query)
    if (!truncated) {
      set({ query: '', activeRetrievalQuery: '', isLoading: false, searchResults: [], searchResultsQuery: '', searchMeta: null })
      return
    }

    set({
      query: truncated,
      activeRetrievalQuery: truncated,
      isLoading: true,
      error: null,
      searchResults: [],
      searchResultsQuery: truncated,
      searchMeta: null,
      modeManuallySet: false,
    })
    try {
      const focus = get().focusMode
      const target = get().searchTarget
      const semantic = get().semanticSearch
      const searchCount = useSettingsStore.getState().searchResultsCount
      const selectedModel = useSettingsStore.getState().selectedModel
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: truncated,
          focus,
          target,
          semantic,
          count: searchCount,
          model: selectedModel,
          requestId: createId(),
        }),
        signal,
      })
      const data = (await res.json()) as {
        results?: Source[]
        counts?: FederatedSearchMeta['counts']
        available?: FederatedSearchMeta['available']
        semantic?: FederatedSearchMeta['semantic']
        degraded?: boolean
        error?: string
      }
      if (!isCurrentGeneration('search', generation)) return
      if (data.error === 'request aborted') {
        set({ isLoading: false })
        return
      }
      if (data.error) {
        set({ searchResults: [], isLoading: false, ...setError(data.error) })
        return
      }
      set({
        searchResults: data.results ?? [],
        searchResultsQuery: truncated,
        searchMeta: data.counts && data.available && data.semantic
          ? { counts: data.counts, available: data.available, semantic: data.semantic, degraded: !!data.degraded }
          : null,
        isLoading: false,
      })
      useSessionStore.getState().setLastSession({
        query: truncated,
        mode: 'search',
        focusMode: get().focusMode,
        sources: data.results ?? [],
      })
      useSessionStore.getState().addToSearchHistory(truncated, false)
      useJourneyStore.getState().addNode({
        mode: 'search',
        action: 'search_completed',
        query: truncated,
        metadata: { webSourceCount: (data.results ?? []).length },
      })
    } catch (err) {
      if (!isCurrentGeneration('search', generation)) return
      if (isAbortError(err)) {
        set({ isLoading: false })
        return
      }
      const msg =
        err instanceof TypeError && err.message.includes('fetch')
          ? 'Could not connect to the server. Is bun run dev running?'
          : 'Search unavailable. Check that SearXNG is running (docker compose up -d).'
      set({ searchResults: [], isLoading: false, ...setError(msg) })
    }
  },

  sendChatMessage: async (content) => {
    const wasStreaming = get().isChatStreaming
    chatAbort?.abort()
    chatAbort = new AbortController()
    const signal = chatAbort.signal
    const generation = nextGeneration('chat')
    const requestId = createId()

    const truncated = normalizeQuery(content)
    if (!truncated) return

    const currentMessages = get().chatMessages
    const sanitizedMessages =
      wasStreaming && currentMessages[currentMessages.length - 1]?.role === 'assistant'
        ? currentMessages.slice(0, -1)
        : currentMessages

    const userMsg: ChatMessage = { id: createId(), role: 'user', content: truncated }
    const assistantPlaceholder: ChatMessage = {
      id: createId(),
      role: 'assistant',
      content: '',
    }
    const toSend = sanitizedMessages.length > 50 ? sanitizedMessages.slice(-20) : sanitizedMessages
    const llmMessages = [...toSend, userMsg].map((m) => ({
      role: m.role,
      content: m.content.slice(0, 2000),
    }))
    const journeyContext = buildJourneyContext(truncated, 'chat')
    const focus = get().focusMode

    set({
      query: truncated,
      activeRetrievalQuery: truncated,
      chatMessages: [...sanitizedMessages, userMsg, assistantPlaceholder],
      isChatStreaming: true,
      error: null,
      modeManuallySet: false,
    })

    const selectedModel = useSettingsStore.getState().selectedModel
    const assistantId = assistantPlaceholder.id

    try {
      const res = await fetch('/api/chat/conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: llmMessages, journeyContext, requestId, model: selectedModel, focus }),
        signal,
      })
      if (!res.ok || !res.body) throw new Error('Chat request failed')

      let assistantContent = ''
      let receivedDone = false
      let receivedTerminalError = false

      await readJsonSse<ChatStreamEvent>(res.body, {
        signal,
        shouldContinue: () => isCurrentGeneration('chat', generation),
        onEvent: (payload) => {
          if (payload.requestId && payload.requestId !== requestId) return
          if (!isCurrentGeneration('chat', generation)) return false
          if (payload.type === 'error') {
            receivedTerminalError = true
            set((s) => {
              const msgs = [...s.chatMessages]
              const last = msgs[msgs.length - 1]
              if (last?.role === 'assistant') {
                msgs[msgs.length - 1] = { ...last, content: last.content || payload.data || 'Something went wrong.' }
              }
              return { chatMessages: msgs, isChatStreaming: false, isThinking: false, ...setError(payload.data ?? 'Something went wrong.') }
            })
            return false
          }
          if (payload.type === 'thinking_delta') {
            set((s) => ({
              isThinking: true,
              chatThinking: {
                ...s.chatThinking,
                [assistantId]: (s.chatThinking[assistantId] || '') + (payload.data ?? ''),
              },
            }))
          } else if (payload.type === 'delta') {
            assistantContent += payload.data ?? ''
            set((s) => {
              const msgs = [...s.chatMessages]
              const last = msgs[msgs.length - 1]
              if (last?.role === 'assistant') {
                msgs[msgs.length - 1] = { ...last, content: assistantContent }
              }
              return { chatMessages: msgs, isThinking: false }
            })
          } else if (payload.type === 'metrics' && payload.data) {
            set((s) => ({ chatMetrics: { ...s.chatMetrics, [assistantId]: payload.data as QueryMetrics } }))
          } else if (payload.type === 'done') {
            receivedDone = true
            set({ isChatStreaming: false, isThinking: false })
            useSessionStore.getState().setLastSession({
              query: truncated,
              mode: 'chat',
              focusMode: get().focusMode,
            })
            useSessionStore.getState().addToSearchHistory(truncated, false)
            useChatHistoryStore.getState().saveConversation(get().chatMessages)
            useJourneyStore.getState().addNode({
              mode: 'chat',
              action: 'chat_turn_completed',
              query: truncated,
              answer: get().chatMessages[get().chatMessages.length - 1]?.content,
              metadata: {
                conversationId: useChatHistoryStore.getState().activeConversationId,
                messageCount: get().chatMessages.length,
              },
            })
          }
        },
      })
      if (receivedTerminalError) return
      if (isCurrentGeneration('chat', generation)) {
        if (!receivedDone && !signal.aborted) {
          set({ isChatStreaming: false, isThinking: false, ...setError('Response interrupted before completion. Please retry.') })
        } else {
          set({ isChatStreaming: false, isThinking: false })
        }
      }
    } catch (err) {
      if (!isCurrentGeneration('chat', generation)) return
      if (isAbortError(err)) {
        set((s) => {
          const msgs = [...s.chatMessages]
          const last = msgs[msgs.length - 1]
          if (last?.role === 'assistant' && !last.content.trim()) msgs.pop()
          return { chatMessages: msgs, isChatStreaming: false, isThinking: false }
        })
        return
      }
      set((s) => {
        const msgs = [...s.chatMessages]
        const last = msgs[msgs.length - 1]
        if (last?.role === 'assistant') {
          msgs[msgs.length - 1] = { ...last, content: last.content || 'Sorry, something went wrong.' }
        }
        const errorMsg =
          err instanceof TypeError && err.message.includes('fetch')
            ? 'Could not connect to the server. Is bun run dev running?'
            : 'Engine unavailable. Check that your local inference server is running and configured.'
        return { chatMessages: msgs, isChatStreaming: false, isThinking: false, ...setError(errorMsg) }
      })
    }
  },

  clearChat: () => {
    nextGeneration('chat')
    chatAbort?.abort()
    set({ chatMessages: [], chatThinking: {}, chatMetrics: {}, isChatStreaming: false, query: '', activeRetrievalQuery: '' })
    useChatHistoryStore.setState({ activeConversationId: null })
  },

  loadFromCollection: (item) => {
    get().abortActiveRequests(false)
    const mode = item.mode ?? 'ai'
    const local = item.localSources ?? []
    set({ searchMeta: null })
    if (mode === 'search') {
      set({
        mode,
        modeManuallySet: true,
        modeJustSwitched: null,
        query: item.query,
        activeRetrievalQuery: item.query,
        answer: '',
        sources: [],
        localSources: [],
        searchResults: item.sources,
        searchResultsQuery: item.query,
        relatedQuestions: [],
        relatedQuestionsLoading: false,
        thinking: '',
        researchThinking: '',
        takeaways: [],
        answerMetrics: null,
        answerQuality: null,
        researchMetrics: null,
        researchQuality: null,
        researchPlan: [],
        researchSteps: [],
        researchReport: '',
        researchSources: { web: [], local: [] },
        answerStartTime: null,
        researchStartTime: null,
        researchEndTime: null,
        isLoading: false,
        isChatStreaming: false,
        isResearching: false,
        isThinking: false,
        sourcePreview: null,
        error: null,
      })
    } else if (mode === 'research') {
      const restoredPlan = item.researchPlan ?? []
      set({
        mode,
        modeManuallySet: true,
        modeJustSwitched: null,
        query: item.query,
        activeRetrievalQuery: item.query,
        answer: '',
        sources: [],
        localSources: [],
        searchResults: [],
        searchResultsQuery: '',
        relatedQuestions: [],
        relatedQuestionsLoading: false,
        thinking: '',
        researchThinking: '',
        takeaways: [],
        answerMetrics: null,
        answerQuality: null,
        researchMetrics: null,
        researchQuality: null,
        researchPlan: restoredPlan,
        researchSteps: restoredPlan.length
          ? [{ type: 'plan', data: { subQuestions: restoredPlan }, timestamp: Date.now() }]
          : [],
        researchReport: item.answer,
        researchSources: { web: item.sources, local },
        answerStartTime: null,
        researchStartTime: null,
        researchEndTime: null,
        isLoading: false,
        isChatStreaming: false,
        isResearching: false,
        isThinking: false,
        sourcePreview: null,
        error: null,
      })
    } else {
      set({
        mode: 'ai',
        modeManuallySet: true,
        modeJustSwitched: null,
        query: item.query,
        activeRetrievalQuery: item.query,
        answer: item.answer,
        sources: item.sources,
        localSources: local,
        searchResults: [],
        searchResultsQuery: '',
        relatedQuestions: [],
        relatedQuestionsLoading: false,
        thinking: '',
        researchThinking: '',
        takeaways: [],
        answerMetrics: null,
        answerQuality: null,
        researchMetrics: null,
        researchQuality: null,
        researchPlan: [],
        researchSteps: [],
        researchReport: '',
        researchSources: { web: [], local: [] },
        answerStartTime: null,
        researchStartTime: null,
        researchEndTime: null,
        isLoading: false,
        isChatStreaming: false,
        isResearching: false,
        isThinking: false,
        sourcePreview: null,
        error: null,
      })
    }
    useJourneyStore.getState().addNode({
      mode,
      action: 'collection_loaded',
      query: item.query,
      answer: item.answer,
      metadata: {
        hasResearchPlan: !!item.researchPlan?.length,
        webSourceCount: item.sources.length,
        localSourceCount: item.localSources?.length ?? 0,
      },
    })
  },

  resetResults: () => {
    get().abortActiveRequests(false)
    set({
      query: '',
      activeRetrievalQuery: '',
      answer: '',
      sources: [],
      localSources: [],
      searchResults: [],
      searchResultsQuery: '',
      searchMeta: null,
      relatedQuestions: [],
      relatedQuestionsLoading: false,
      isLoading: false,
      isChatStreaming: false,
      isResearching: false,
      isThinking: false,
      thinking: '',
      researchThinking: '',
      chatThinking: {},
      chatMetrics: {},
      takeaways: [],
      answerMetrics: null,
      answerQuality: null,
      answerProgress: [],
      researchMetrics: null,
      researchQuality: null,
      answerStartTime: null,
      researchStartTime: null,
      researchEndTime: null,
      researchPlan: [],
      researchSteps: [],
      researchReport: '',
      researchSources: { web: [], local: [] },
      sourcePreview: null,
      error: null,
    })
    useSessionStore.getState().clearLastSession()
  },

  researchPlan: [],
  researchSteps: [],
  researchReport: '',
  researchSources: { web: [], local: [] },
  researchStartTime: null,
  researchEndTime: null,
  takeaways: [],
  answerStartTime: null,
  pinnedResult: null,
  pinCurrentResult: () => {
    const { mode, query, answer, sources, localSources, researchReport, researchSources } = get()
    if (mode !== 'ai' && mode !== 'research') return
    const content = mode === 'ai' ? answer : researchReport
    if (!content?.trim()) return
    const webSources = mode === 'ai' ? sources : researchSources.web ?? []
    const local = mode === 'ai' ? localSources : researchSources.local ?? []
    set({
      pinnedResult: {
        query,
        answer: content,
        sources: webSources,
        localSources: local,
        mode,
        pinnedAt: Date.now(),
      },
    })
    useJourneyStore.getState().addNode({
      mode,
      action: 'answer_pinned',
      query,
      metadata: { pinnedQuery: query, pinnedMode: mode },
    })
  },
  clearPinnedResult: () => {
    const pinned = get().pinnedResult
    if (pinned) {
      useJourneyStore.getState().addNode({
        mode: pinned.mode,
        action: 'answer_unpinned',
        query: pinned.query,
      })
    }
    set({ pinnedResult: null })
  },
  sourcePreview: null,
  setSourcePreview: (preview) => set({ sourcePreview: preview }),
  clearSourcePreview: () => set({ sourcePreview: null }),

  fetchTakeaways: async (answer, contextMode, generation) => {
    const trimmedAnswer = answer.trim()
    if (!trimmedAnswer || trimmedAnswer.length < 120 || wordCount(trimmedAnswer) < 18) {
      if (contextMode && get().mode === contextMode) set({ takeaways: [] })
      return
    }
    if (!isContextGenerationCurrent(contextMode, generation)) return
    takeawaysAbort?.abort()
    takeawaysAbort = new AbortController()
    const signal = takeawaysAbort.signal
    const selectedModel = useSettingsStore.getState().selectedModel
    try {
      const res = await fetch('/api/takeaways', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: trimmedAnswer, model: selectedModel }),
        signal,
      })
      if (!res.ok) throw new Error('takeaways request failed')
      const data = (await res.json()) as { takeaways?: string[] }
      if (signal.aborted) return
      if (!isContextGenerationCurrent(contextMode, generation)) return
      if (contextMode && get().mode !== contextMode) return
      set({ takeaways: data.takeaways ?? [] })
    } catch (err) {
      if (isAbortError(err)) return
      if (!isContextGenerationCurrent(contextMode, generation)) return
      if (contextMode && get().mode !== contextMode) return
      set({ takeaways: [] })
    }
  },

  startResearch: async (query, options) => {
    researchAbort?.abort()
    takeawaysAbort?.abort()
    researchAbort = new AbortController()
    const signal = researchAbort.signal
    const generation = nextGeneration('research')
    const requestId = createId()

    const truncated = normalizeQuery(query)
    if (!truncated) return
    const handoffContext = normalizeContextHint(options?.handoffContext)
    const retrievalQuery = normalizeQuery(options?.retrievalQuery ?? '')
    const selectedModel = useSettingsStore.getState().selectedModel

    set({
      query: truncated,
      activeRetrievalQuery: retrievalQuery || truncated,
      isResearching: true,
      isThinking: false,
      researchThinking: '',
      error: null,
      researchPlan: [],
      researchSteps: [],
      researchReport: '',
      researchSources: { web: [], local: [] },
      takeaways: [],
      researchMetrics: null,
      researchQuality: null,
      researchStartTime: Date.now(),
      researchEndTime: null,
      modeManuallySet: false,
    })
    try {
      const focusMode = get().focusMode
      const searchTarget = get().searchTarget
      const semanticSearch = get().semanticSearch
      const journeyContext = buildJourneyContext(truncated, 'research')
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: truncated,
          retrievalQuery: retrievalQuery || undefined,
          focus: focusMode,
          target: searchTarget,
          semantic: semanticSearch,
          journeyContext,
          handoffContext: handoffContext || undefined,
          requestId,
          model: selectedModel,
        }),
        signal,
      })
      if (!res.ok || !res.body) throw new Error('Research request failed')
      let receivedDone = false
      let receivedTerminalError = false
      await readJsonSse<ResearchStreamEvent>(res.body, {
        signal,
        shouldContinue: () => isCurrentGeneration('research', generation),
        onEvent: (payload) => {
          if (payload.requestId && payload.requestId !== requestId) return
          if (!isCurrentGeneration('research', generation)) return false
          if (payload.type === 'error') {
            receivedTerminalError = true
            set({ researchReport: '', researchThinking: '', takeaways: [], isResearching: false, isThinking: false, ...setError(payload.data ?? 'Something went wrong.') })
            return false
          }
          const ts = Date.now()
          switch (payload.type) {
            case 'plan':
              set((s) => ({
                researchPlan: payload.data?.subQuestions ?? [],
                researchSteps: [...s.researchSteps, { type: 'plan', data: payload.data, timestamp: ts }],
              }))
              break
            case 'searching':
            case 'reading':
            case 'search_results':
            case 'analyzing':
            case 'analysis':
            case 'gap_fill':
            case 'synthesizing':
            case 'warning':
              set((s) => ({
                researchSteps: [...s.researchSteps, { type: payload.type, data: payload.data, timestamp: ts }],
              }))
              break
            case 'sources':
              set({ researchSources: { web: payload.data?.web ?? [], local: payload.data?.local ?? [] } })
              break
            case 'thinking_delta':
              set((s) => ({
                researchThinking: s.researchThinking + (payload.data ?? ''),
                isThinking: true,
              }))
              break
            case 'delta':
              set((s) => ({
                researchReport: s.researchReport + (payload.data ?? ''),
                isThinking: false,
              }))
              break
            case 'answer_replace':
              set({ researchReport: payload.data ?? '', isThinking: false })
              break
            case 'quality':
              set({ researchQuality: payload.data ?? null })
              break
            case 'metrics':
              set({ researchMetrics: payload.data ?? null })
              break
            case 'done':
              if (payload.data && typeof payload.data === 'object' && 'grounded' in payload.data && payload.data.grounded === false) {
                receivedTerminalError = true
                set({ researchReport: '', researchThinking: '', takeaways: [], isResearching: false, isThinking: false,
                  ...setError('KeepIndex withheld this report because its evidence could not be validated.') })
                return false
              }
              receivedDone = true
              set((s) => ({
                isResearching: false,
                isThinking: false,
                researchEndTime: Date.now(),
                researchSteps: [...s.researchSteps, { type: 'done', data: payload.data ?? {}, timestamp: ts }],
              }))
              void get().fetchTakeaways(get().researchReport, 'research', generation)
              useSessionStore.getState().setLastSession({
                query: truncated,
                mode: 'research',
                focusMode: get().focusMode,
                answer: get().researchReport,
                sources: get().researchSources.web,
                localSources: get().researchSources.local,
              })
              useSessionStore.getState().addToSearchHistory(truncated, false)
              useJourneyStore.getState().addNode({
                mode: 'research',
                action: 'research_completed',
                query: truncated,
                answer: get().researchReport,
                metadata: {
                  stepCount: get().researchSteps.length,
                  webSourceCount: get().researchSources.web.length,
                  localSourceCount: get().researchSources.local.length,
                },
              })
              break
          }
        },
      })
      if (receivedTerminalError) return
      if (isCurrentGeneration('research', generation)) {
        if (!receivedDone && !signal.aborted) {
          set({
            isResearching: false,
            isThinking: false,
            researchEndTime: Date.now(),
            ...setError('Research stream interrupted before completion. Please retry.'),
          })
        } else {
          set({ isResearching: false, isThinking: false, researchEndTime: Date.now() })
        }
      }
    } catch (err) {
      if (!isCurrentGeneration('research', generation)) return
      if (isAbortError(err)) {
        set({ isResearching: false, isThinking: false })
        return
      }
      const msg =
        err instanceof TypeError && err.message.includes('fetch')
          ? 'Could not connect to the server. Is bun run dev running?'
          : 'Engine unavailable. Check that your local inference server is running and configured.'
      set({ isResearching: false, isThinking: false, ...setError(msg) })
    }
  },
}))
