import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import type { RecoverableState } from './workspace-recovery'
import {
  WORKSPACE_RECOVERY_STORAGE_KEY,
  clearCurrentWorkspaceRecovery,
  loadWorkspaceRecovery,
  persistWorkspaceRecovery,
  subscribeToWorkspaceRecovery,
} from './workspace-recovery'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
let storage: MemoryStorage

function metric(model = 'test-model') {
  return {
    model,
    promptTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    durationMs: 500,
    endToEndMs: 700,
    timeToFirstTokenMs: 50,
    tokensPerSecond: 40,
    tokenCountsEstimated: false,
  }
}

function quality() {
  return {
    status: 'strong' as const,
    score: 100,
    citationCoveragePct: 100,
    citedSourceCount: 1,
    sourceCount: 1,
    invalidCitations: [],
    note: 'All claims cited.',
  }
}

function recoverableState(overrides: Partial<RecoverableState> = {}): RecoverableState {
  const assistantId = 'assistant-1'
  return {
    mode: 'research',
    query: 'test query',
    activeRetrievalQuery: 'root test topic continued question',
    focusMode: 'all',
    answer: 'partial answer',
    thinking: 'answer trace',
    sources: [{ title: 'Web', url: 'https://example.com', snippet: 'Evidence' }],
    localSources: [{ filePath: '/vault/note.md', fileName: 'note.md', content: 'Local evidence' }],
    searchResults: [],
    searchResultsQuery: '',
    chatMessages: [{ id: assistantId, role: 'assistant', content: 'partial chat' }],
    chatThinking: { [assistantId]: 'chat trace', orphan: 'drop me' },
    chatMetrics: { [assistantId]: metric(), orphan: metric('orphan') },
    researchPlan: ['Question one'],
    researchSteps: [
      {
        type: 'search_results',
        data: {
          question: 'Question one',
          results: [{ title: 'large payload' }],
          localResults: [{ content: 'large local payload' }],
        },
        timestamp: Date.now(),
      },
    ],
    researchReport: 'partial report',
    researchThinking: 'research trace',
    researchSources: {
      web: [{ title: 'Research', url: 'https://example.com/research', snippet: 'Evidence' }],
      local: [],
    },
    answerMetrics: metric(),
    researchMetrics: metric('research-model'),
    answerQuality: quality(),
    researchQuality: quality(),
    isLoading: false,
    isChatStreaming: false,
    isResearching: true,
    ...overrides,
  }
}

beforeEach(() => {
  storage = new MemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
})

afterAll(() => {
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('workspace recovery schema', () => {
  it('round-trips schema-v2 traces, metrics, quality, and compact research steps', () => {
    persistWorkspaceRecovery(recoverableState())

    const raw = JSON.parse(storage.getItem(WORKSPACE_RECOVERY_STORAGE_KEY) ?? 'null')
    expect(raw.schemaVersion).toBe(2)
    expect(raw.researchSteps[0].data.results).toBeUndefined()
    expect(raw.researchSteps[0].data.localResults).toBeUndefined()
    expect(raw.researchSteps[0].data.webResultCount).toBe(1)
    expect(raw.researchSteps[0].data.localResultCount).toBe(1)

    const restored = loadWorkspaceRecovery()
    expect(restored?.thinking).toBe('answer trace')
    expect(restored?.activeRetrievalQuery).toBe('root test topic continued question')
    expect(restored?.researchThinking).toBe('research trace')
    expect(restored?.chatThinking).toEqual({ 'assistant-1': 'chat trace' })
    expect(restored?.chatMetrics['assistant-1']?.model).toBe('test-model')
    expect(restored?.chatMetrics.orphan).toBeUndefined()
    expect(restored?.answerMetrics?.totalTokens).toBe(30)
    expect(restored?.researchMetrics?.model).toBe('research-model')
    expect(restored?.answerQuality?.status).toBe('strong')
    expect(restored?.researchQuality?.score).toBe(100)
    expect(restored?.researchSteps[0]?.type).toBe('search_results')
  })

  it('safely normalizes a partial schema-v1 checkpoint into schema v2', () => {
    storage.setItem(WORKSPACE_RECOVERY_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      sessionId: 'v1-session',
      capturedAt: Date.now(),
      mode: 'ai',
      query: 'v1 query',
      focusMode: 'not-a-focus',
      answer: 'v1 answer',
    }))

    const restored = loadWorkspaceRecovery()
    expect(restored).not.toBeNull()
    expect(restored?.schemaVersion).toBe(2)
    expect(restored?.focusMode).toBe('all')
    expect(restored?.sources).toEqual([])
    expect(restored?.chatMessages).toEqual([])
    expect(restored?.researchSteps).toEqual([])
    expect(restored?.thinking).toBe('')
    expect(restored?.activeRetrievalQuery).toBe('v1 query')
    expect(restored?.answerMetrics).toBeNull()
    expect(restored?.answerQuality).toBeNull()
  })

  it('does not clear a checkpoint owned by another browser session', () => {
    storage.setItem(WORKSPACE_RECOVERY_STORAGE_KEY, JSON.stringify({ sessionId: 'another-session' }))
    clearCurrentWorkspaceRecovery()
    expect(storage.getItem(WORKSPACE_RECOVERY_STORAGE_KEY)).not.toBeNull()
  })
})

describe('workspace recovery checkpoint scheduler', () => {
  it('writes on the leading edge, trails rapid updates, and clears on completion', async () => {
    let state = recoverableState({ isResearching: false })
    const listeners = new Set<(next: RecoverableState, previous: RecoverableState) => void>()
    const store = {
      getState: () => state,
      subscribe: (listener: (next: RecoverableState, previous: RecoverableState) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      setState: (patch: Partial<RecoverableState>) => {
        const previous = state
        state = { ...state, ...patch }
        listeners.forEach((listener) => listener(state, previous))
      },
    }
    const checkpoints = subscribeToWorkspaceRecovery(store, 20)

    store.setState({ isResearching: true, researchReport: 'first token' })
    expect(JSON.parse(storage.getItem(WORKSPACE_RECOVERY_STORAGE_KEY) ?? 'null').researchReport).toBe('first token')

    store.setState({ researchReport: 'second token' })
    store.setState({ researchReport: 'latest token' })
    await new Promise((resolve) => setTimeout(resolve, 35))
    expect(JSON.parse(storage.getItem(WORKSPACE_RECOVERY_STORAGE_KEY) ?? 'null').researchReport).toBe('latest token')

    store.setState({ isResearching: false })
    expect(storage.getItem(WORKSPACE_RECOVERY_STORAGE_KEY)).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(storage.getItem(WORKSPACE_RECOVERY_STORAGE_KEY)).toBeNull()
    checkpoints.stop()
  })
})
