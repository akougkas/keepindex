import { createId } from '@/lib/utils'
import { KEEPINDEX_STORAGE_KEYS } from '@/lib/storage-contract'
import type {
  ChatMessage,
  FocusMode,
  GroundingAssessment,
  KnowledgeSource,
  Mode,
  QueryMetrics,
  ResearchStep,
  Source,
} from '@/stores/app-store'

export const WORKSPACE_RECOVERY_STORAGE_KEY = KEEPINDEX_STORAGE_KEYS.workspaceRecovery
const MAX_RECOVERY_AGE_MS = 7 * 24 * 60 * 60_000
const CHECKPOINT_INTERVAL_MS = 1_000
const RESEARCH_STEP_TYPES = new Set<ResearchStep['type']>([
  'plan',
  'searching',
  'reading',
  'search_results',
  'analyzing',
  'analysis',
  'gap_fill',
  'synthesizing',
  'warning',
  'done',
])
const FOCUS_MODES = new Set<FocusMode>(['all', 'news', 'academic', 'videos', 'images', 'code', 'social', 'reddit', 'x'])
const MODES = new Set<Mode>(['search', 'ai', 'chat', 'research'])
const QUALITY_STATUSES = new Set<GroundingAssessment['status']>(['strong', 'mixed', 'weak', 'ungrounded'])

export const workspaceRecoverySessionId = createId()

export type WorkspaceRecovery = {
  schemaVersion: 2
  sessionId: string
  capturedAt: number
  mode: Mode
  query: string
  activeRetrievalQuery: string
  focusMode: FocusMode
  answer: string
  thinking: string
  sources: Source[]
  localSources: KnowledgeSource[]
  searchResults: Source[]
  searchResultsQuery: string
  chatMessages: ChatMessage[]
  chatThinking: Record<string, string>
  chatMetrics: Record<string, QueryMetrics>
  researchPlan: string[]
  researchSteps: ResearchStep[]
  researchReport: string
  researchThinking: string
  researchSources: { web: Source[]; local: KnowledgeSource[] }
  answerMetrics: QueryMetrics | null
  researchMetrics: QueryMetrics | null
  answerQuality: GroundingAssessment | null
  researchQuality: GroundingAssessment | null
}

export type RecoverableState = Omit<WorkspaceRecovery, 'schemaVersion' | 'sessionId' | 'capturedAt'> & {
  isLoading: boolean
  isChatStreaming: boolean
  isResearching: boolean
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function boundedString(value: unknown, max: number, fallback = ''): string {
  return typeof value === 'string' ? value.slice(0, max) : fallback
}

function normalizeStringList(value: unknown, limit: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .slice(0, limit)
    .map((item) => item.slice(0, maxLength))
}

function normalizeSource(value: unknown): Source | null {
  const source = asRecord(value)
  if (!source || typeof source.url !== 'string') return null
  return {
    title: boundedString(source.title, 500),
    url: source.url.slice(0, 3_000),
    snippet: boundedString(source.snippet, 3_000),
  }
}

function normalizeKnowledgeSource(value: unknown): KnowledgeSource | null {
  const source = asRecord(value)
  if (!source || typeof source.filePath !== 'string') return null
  const normalized: KnowledgeSource = {
    filePath: source.filePath.slice(0, 3_000),
    fileName: boundedString(source.fileName, 500),
    content: boundedString(source.content, 6_000),
  }
  const startLine = finiteNumber(source.startLine)
  const endLine = finiteNumber(source.endLine)
  const score = finiteNumber(source.score)
  const indexedAt = finiteNumber(source.indexedAt)
  if (startLine != null) normalized.startLine = startLine
  if (endLine != null) normalized.endLine = endLine
  if (score != null) normalized.score = score
  if (indexedAt != null) normalized.indexedAt = indexedAt
  if (typeof source.resourceId === 'string') normalized.resourceId = source.resourceId.slice(0, 500)
  if (typeof source.resourceLabel === 'string') normalized.resourceLabel = source.resourceLabel.slice(0, 500)
  return normalized
}

function normalizeSources<T>(
  value: unknown,
  limit: number,
  normalize: (item: unknown) => T | null
): T[] {
  if (!Array.isArray(value)) return []
  const result: T[] = []
  for (const item of value.slice(0, limit)) {
    const normalized = normalize(item)
    if (normalized) result.push(normalized)
  }
  return result
}

function normalizeChatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return []
  const messages: ChatMessage[] = []
  for (const item of value.slice(-30)) {
    const message = asRecord(item)
    if (
      !message ||
      typeof message.id !== 'string' ||
      (message.role !== 'user' && message.role !== 'assistant') ||
      typeof message.content !== 'string'
    ) continue
    messages.push({
      id: message.id.slice(0, 500),
      role: message.role,
      content: message.content.slice(0, 20_000),
    })
  }
  return messages
}

function normalizeMetrics(value: unknown): QueryMetrics | null {
  const metrics = asRecord(value)
  if (!metrics) return null
  const promptTokens = finiteNumber(metrics.promptTokens)
  const outputTokens = finiteNumber(metrics.outputTokens)
  const totalTokens = finiteNumber(metrics.totalTokens)
  const durationMs = finiteNumber(metrics.durationMs)
  const endToEndMs = finiteNumber(metrics.endToEndMs)
  const tokensPerSecond = finiteNumber(metrics.tokensPerSecond)
  const timeToFirstTokenMs = metrics.timeToFirstTokenMs == null ? null : finiteNumber(metrics.timeToFirstTokenMs)
  if (
    promptTokens == null ||
    outputTokens == null ||
    totalTokens == null ||
    durationMs == null ||
    endToEndMs == null ||
    tokensPerSecond == null ||
    (metrics.timeToFirstTokenMs != null && timeToFirstTokenMs == null) ||
    typeof metrics.tokenCountsEstimated !== 'boolean'
  ) return null
  return {
    model: typeof metrics.model === 'string' ? metrics.model.slice(0, 500) : null,
    promptTokens,
    outputTokens,
    totalTokens,
    durationMs,
    endToEndMs,
    timeToFirstTokenMs,
    tokensPerSecond,
    tokenCountsEstimated: metrics.tokenCountsEstimated,
  }
}

function normalizeQuality(value: unknown): GroundingAssessment | null {
  const quality = asRecord(value)
  if (!quality || !QUALITY_STATUSES.has(quality.status as GroundingAssessment['status'])) return null
  const score = finiteNumber(quality.score)
  const citationCoveragePct = finiteNumber(quality.citationCoveragePct)
  const citedSourceCount = finiteNumber(quality.citedSourceCount)
  const sourceCount = finiteNumber(quality.sourceCount)
  if (score == null || citationCoveragePct == null || citedSourceCount == null || sourceCount == null) return null
  return {
    ...(quality.answerMode === 'extractive' ? { answerMode: 'extractive' as const } : {}),
    status: quality.status as GroundingAssessment['status'],
    score,
    citationCoveragePct,
    citedSourceCount,
    sourceCount,
    invalidCitations: normalizeStringList(quality.invalidCitations, 100, 100),
    note: boundedString(quality.note, 2_000),
  }
}

function compactUnknown(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return value.slice(0, 4_000)
  if (depth >= 4) return null
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => compactUnknown(item, depth + 1))
  const record = asRecord(value)
  if (!record) return null
  const compacted: UnknownRecord = {}
  Object.entries(record).slice(0, 40).forEach(([key, item]) => {
    compacted[key.slice(0, 200)] = compactUnknown(item, depth + 1)
  })
  return compacted
}

function compactResearchStep(step: ResearchStep): ResearchStep {
  const source = asRecord(step.data)
  if (step.type !== 'search_results' || !source) {
    return { ...step, data: compactUnknown(step.data) }
  }
  const withoutPayloads: UnknownRecord = {}
  Object.entries(source).forEach(([key, value]) => {
    if (key !== 'results' && key !== 'localResults') withoutPayloads[key] = compactUnknown(value)
  })
  withoutPayloads.webResultCount = Array.isArray(source.results)
    ? source.results.length
    : finiteNumber(source.webResultCount) ?? 0
  withoutPayloads.localResultCount = Array.isArray(source.localResults)
    ? source.localResults.length
    : finiteNumber(source.localResultCount) ?? 0
  return { ...step, data: withoutPayloads }
}

function normalizeResearchSteps(value: unknown): ResearchStep[] {
  if (!Array.isArray(value)) return []
  const steps: ResearchStep[] = []
  for (const item of value.slice(-80)) {
    const step = asRecord(item)
    if (!step || !RESEARCH_STEP_TYPES.has(step.type as ResearchStep['type'])) continue
    const timestamp = finiteNumber(step.timestamp)
    if (timestamp == null) continue
    steps.push(compactResearchStep({
      type: step.type as ResearchStep['type'],
      data: step.data,
      timestamp,
    }))
  }
  return steps
}

function normalizeTextMap(value: unknown, allowedIds: Set<string>): Record<string, string> {
  const record = asRecord(value)
  if (!record) return {}
  const normalized: Record<string, string> = {}
  for (const [id, text] of Object.entries(record)) {
    if (allowedIds.has(id) && typeof text === 'string') normalized[id] = text.slice(0, 20_000)
  }
  return normalized
}

function normalizeMetricMap(value: unknown, allowedIds: Set<string>): Record<string, QueryMetrics> {
  const record = asRecord(value)
  if (!record) return {}
  const normalized: Record<string, QueryMetrics> = {}
  for (const [id, metric] of Object.entries(record)) {
    if (!allowedIds.has(id)) continue
    const parsed = normalizeMetrics(metric)
    if (parsed) normalized[id] = parsed
  }
  return normalized
}

function isRunning(state: Pick<RecoverableState, 'isLoading' | 'isChatStreaming' | 'isResearching'>): boolean {
  return state.isLoading || state.isChatStreaming || state.isResearching
}

function normalizeRecovery(value: unknown): WorkspaceRecovery | null {
  const parsed = asRecord(value)
  if (!parsed || (parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2)) return null
  const capturedAt = finiteNumber(parsed.capturedAt)
  if (
    capturedAt == null ||
    typeof parsed.sessionId !== 'string' ||
    typeof parsed.query !== 'string' ||
    !MODES.has(parsed.mode as Mode)
  ) return null

  const chatMessages = normalizeChatMessages(parsed.chatMessages)
  const chatMessageIds = new Set(chatMessages.map((message) => message.id))
  const researchSources = asRecord(parsed.researchSources)

  return {
    schemaVersion: 2,
    sessionId: parsed.sessionId.slice(0, 500),
    capturedAt,
    mode: parsed.mode as Mode,
    query: parsed.query.slice(0, 1_000),
    activeRetrievalQuery: boundedString(parsed.activeRetrievalQuery, 1_000, parsed.query.slice(0, 1_000)),
    focusMode: FOCUS_MODES.has(parsed.focusMode as FocusMode) ? parsed.focusMode as FocusMode : 'all',
    answer: boundedString(parsed.answer, 250_000),
    thinking: boundedString(parsed.thinking, 250_000),
    sources: normalizeSources(parsed.sources, 50, normalizeSource),
    localSources: normalizeSources(parsed.localSources, 50, normalizeKnowledgeSource),
    searchResults: normalizeSources(parsed.searchResults, 50, normalizeSource),
    searchResultsQuery: boundedString(parsed.searchResultsQuery, 1_000),
    chatMessages,
    chatThinking: normalizeTextMap(parsed.chatThinking, chatMessageIds),
    chatMetrics: normalizeMetricMap(parsed.chatMetrics, chatMessageIds),
    researchPlan: normalizeStringList(parsed.researchPlan, 12, 500),
    researchSteps: normalizeResearchSteps(parsed.researchSteps),
    researchReport: boundedString(parsed.researchReport, 500_000),
    researchThinking: boundedString(parsed.researchThinking, 250_000),
    researchSources: {
      web: normalizeSources(researchSources?.web, 60, normalizeSource),
      local: normalizeSources(researchSources?.local, 60, normalizeKnowledgeSource),
    },
    answerMetrics: normalizeMetrics(parsed.answerMetrics),
    researchMetrics: normalizeMetrics(parsed.researchMetrics),
    answerQuality: normalizeQuality(parsed.answerQuality),
    researchQuality: normalizeQuality(parsed.researchQuality),
  }
}

export function persistWorkspaceRecovery(state: RecoverableState): void {
  if (!isRunning(state)) {
    clearCurrentWorkspaceRecovery()
    return
  }

  const chatMessages = normalizeChatMessages(state.chatMessages)
  const chatMessageIds = new Set(chatMessages.map((message) => message.id))
  const snapshot: WorkspaceRecovery = {
    schemaVersion: 2,
    sessionId: workspaceRecoverySessionId,
    capturedAt: Date.now(),
    mode: state.mode,
    query: state.query.slice(0, 1_000),
    activeRetrievalQuery: state.activeRetrievalQuery.slice(0, 1_000),
    focusMode: state.focusMode,
    answer: state.answer.slice(0, 250_000),
    thinking: state.thinking.slice(0, 250_000),
    sources: normalizeSources(state.sources, 50, normalizeSource),
    localSources: normalizeSources(state.localSources, 50, normalizeKnowledgeSource),
    searchResults: normalizeSources(state.searchResults, 50, normalizeSource),
    searchResultsQuery: state.searchResultsQuery.slice(0, 1_000),
    chatMessages,
    chatThinking: normalizeTextMap(state.chatThinking, chatMessageIds),
    chatMetrics: normalizeMetricMap(state.chatMetrics, chatMessageIds),
    researchPlan: state.researchPlan.slice(0, 12).map((question) => question.slice(0, 500)),
    researchSteps: state.researchSteps.slice(-80).map(compactResearchStep),
    researchReport: state.researchReport.slice(0, 500_000),
    researchThinking: state.researchThinking.slice(0, 250_000),
    researchSources: {
      web: normalizeSources(state.researchSources.web, 60, normalizeSource),
      local: normalizeSources(state.researchSources.local, 60, normalizeKnowledgeSource),
    },
    answerMetrics: normalizeMetrics(state.answerMetrics),
    researchMetrics: normalizeMetrics(state.researchMetrics),
    answerQuality: normalizeQuality(state.answerQuality),
    researchQuality: normalizeQuality(state.researchQuality),
  }
  try {
    localStorage.setItem(WORKSPACE_RECOVERY_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // Completed-session persistence remains available if recovery storage is full.
  }
}

export function loadWorkspaceRecovery(): WorkspaceRecovery | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(WORKSPACE_RECOVERY_STORAGE_KEY) ?? 'null') as unknown
    const normalized = normalizeRecovery(parsed)
    if (!normalized) return null
    if (Date.now() - normalized.capturedAt > MAX_RECOVERY_AGE_MS) {
      localStorage.removeItem(WORKSPACE_RECOVERY_STORAGE_KEY)
      return null
    }
    return normalized
  } catch {
    return null
  }
}

export function clearCurrentWorkspaceRecovery(): void {
  try {
    const parsed = JSON.parse(localStorage.getItem(WORKSPACE_RECOVERY_STORAGE_KEY) ?? 'null') as { sessionId?: string } | null
    if (parsed?.sessionId === workspaceRecoverySessionId) localStorage.removeItem(WORKSPACE_RECOVERY_STORAGE_KEY)
  } catch {
    // Ignore unavailable storage.
  }
}

export function clearAllWorkspaceRecovery(): void {
  try { localStorage.removeItem(WORKSPACE_RECOVERY_STORAGE_KEY) } catch { /* ignore unavailable storage */ }
}

type RecoveryStore<State extends RecoverableState> = {
  getState: () => State
  subscribe: (listener: (state: State, previousState: State) => void) => () => void
}

export type WorkspaceRecoveryCheckpointController = {
  flush: () => void
  stop: () => void
}

/**
 * Starts a leading/trailing checkpoint throttle. The first running state is
 * durable immediately, streaming updates are coalesced, and completion clears
 * any pending running snapshot synchronously.
 */
export function subscribeToWorkspaceRecovery<State extends RecoverableState>(
  store: RecoveryStore<State>,
  intervalMs = CHECKPOINT_INTERVAL_MS
): WorkspaceRecoveryCheckpointController {
  const interval = Math.max(1, intervalMs)
  let latestState = store.getState()
  let wasRunning = false
  let lastPersistedAt = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const cancelTimer = () => {
    if (timer == null) return
    clearTimeout(timer)
    timer = null
  }

  const writeRunningCheckpoint = () => {
    timer = null
    if (stopped || !isRunning(latestState)) return
    persistWorkspaceRecovery(latestState)
    lastPersistedAt = Date.now()
  }

  const handleState = (state: State) => {
    if (stopped) return
    latestState = state
    const running = isRunning(state)
    if (!running) {
      cancelTimer()
      if (wasRunning) persistWorkspaceRecovery(state)
      wasRunning = false
      lastPersistedAt = 0
      return
    }

    const now = Date.now()
    if (!wasRunning || lastPersistedAt === 0 || now - lastPersistedAt >= interval) {
      cancelTimer()
      persistWorkspaceRecovery(state)
      lastPersistedAt = now
    } else if (timer == null) {
      timer = setTimeout(writeRunningCheckpoint, interval - (now - lastPersistedAt))
    }
    wasRunning = true
  }

  const unsubscribe = store.subscribe(handleState)
  handleState(latestState)

  return {
    flush: () => {
      if (stopped) return
      latestState = store.getState()
      if (!isRunning(latestState)) return
      cancelTimer()
      persistWorkspaceRecovery(latestState)
      lastPersistedAt = Date.now()
      wasRunning = true
    },
    stop: () => {
      if (stopped) return
      latestState = store.getState()
      if (isRunning(latestState)) persistWorkspaceRecovery(latestState)
      stopped = true
      cancelTimer()
      unsubscribe()
    },
  }
}
