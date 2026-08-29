import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { KEEPINDEX_STORAGE_KEYS } from '@/lib/storage-contract'
import type { Source } from './app-store'
import type { KnowledgeSource } from './app-store'
import { sessionMutationQueue } from '@/lib/mutation-queue'
import type { FocusMode } from './app-store'

const MAX_SEARCH_HISTORY = 20

type SharedSessionSnapshot = Pick<
  SessionState,
  | 'lastQuery'
  | 'lastMode'
  | 'lastFocusMode'
  | 'lastAnswer'
  | 'lastSources'
  | 'lastLocalSources'
>

interface SharedSessionEnvelope {
  session?: Partial<SharedSessionSnapshot> | null
  revision?: number
  updatedAt?: number
}

function normalizeRevision(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

function revisionFromEtag(etag: string | null): number | null {
  if (!etag) return null
  const match = etag.match(/^(?:W\/)?["']?shared-session-(\d+)["']?$/i)
  return match ? normalizeRevision(Number(match[1])) : null
}

function revisionFromResponse(
  response: Response,
  envelope?: SharedSessionEnvelope | null
): number | null {
  return normalizeRevision(envelope?.revision) ?? revisionFromEtag(response.headers.get('ETag'))
}

function sessionEtag(revision: number): string {
  return `"shared-session-${revision}"`
}

async function readSessionEnvelope(response: Response): Promise<SharedSessionEnvelope> {
  try {
    return await response.json() as SharedSessionEnvelope
  } catch {
    return {}
  }
}

function safeStorage() {
  return {
    getItem: (name: string) => {
      try {
        return localStorage.getItem(name)
      } catch {
        return null
      }
    },
    setItem: (name: string, value: string) => {
      try {
        localStorage.setItem(name, value)
      } catch {
        /* ignore unavailable storage */
      }
    },
    removeItem: (name: string) => {
      try {
        localStorage.removeItem(name)
      } catch {
        /* ignore unavailable storage */
      }
    },
  }
}

export interface SessionState {
  lastQuery: string
  lastMode: 'search' | 'ai' | 'chat' | 'research'
  lastFocusMode: FocusMode
  lastAnswer: string
  lastSources: Source[]
  lastLocalSources: KnowledgeSource[]
  searchHistory: string[]
  serverRevision: number
  sessionConflict: string | null
  setLastSession: (data: {
    query: string
    mode: 'search' | 'ai' | 'chat' | 'research'
    focusMode: FocusMode
    answer?: string
    sources?: Source[]
    localSources?: KnowledgeSource[]
  }) => void
  addToSearchHistory: (query: string, persistRemotely?: boolean) => void
  clearSearchHistory: () => void
  clearLastSession: () => void
  clearSessionConflict: () => void
  hydrateFromServer: () => Promise<void>
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      lastQuery: '',
      lastMode: 'ai',
      lastFocusMode: 'all',
      lastAnswer: '',
      lastSources: [],
      lastLocalSources: [],
      searchHistory: [],
      serverRevision: 0,
      sessionConflict: null,

      clearSessionConflict: () => set({ sessionConflict: null }),

      setLastSession: (data) => {
        const session = {
          lastQuery: data.query,
          lastMode: data.mode,
          lastFocusMode: data.focusMode,
          lastAnswer: data.answer ?? '',
          lastSources: data.sources ?? [],
          lastLocalSources: data.localSources ?? [],
        }
        set(session)
        sessionMutationQueue.enqueue(async () => {
          const baseRevision = get().serverRevision
          const response = await fetch('/api/session', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'If-Match': sessionEtag(baseRevision),
            },
            body: JSON.stringify(session),
          })
          const envelope = await readSessionEnvelope(response)
          const remoteRevision = revisionFromResponse(response, envelope)
          if (response.status === 412) {
            set({
              sessionConflict: remoteRevision === null
                ? 'The shared session changed on another client. Reload it before saving again.'
                : `The shared session changed on another client (revision ${remoteRevision}). Reload it before saving again.`,
            })
            return
          }
          if (response.ok && remoteRevision !== null) {
            set({ serverRevision: remoteRevision, sessionConflict: null })
          }
        })
      },

      addToSearchHistory: (query, persistRemotely = true) => {
        const trimmed = query.trim()
        if (!trimmed) return
        set((s) => {
          const filtered = s.searchHistory.filter((q) => q !== trimmed)
          const next = [trimmed, ...filtered].slice(0, MAX_SEARCH_HISTORY)
          return { searchHistory: next }
        })
        if (persistRemotely) {
          const state = get()
          sessionMutationQueue.enqueue(() => fetch('/api/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: trimmed,
              mode: state.lastMode,
              focus: state.lastFocusMode,
            }),
          }))
        }
      },

      clearSearchHistory: () => {
        set({ searchHistory: [] })
        sessionMutationQueue.enqueue(() => fetch('/api/history', { method: 'DELETE' }))
      },

      clearLastSession: () => {
        set({
          lastQuery: '',
          lastMode: 'ai',
          lastFocusMode: 'all',
          lastAnswer: '',
          lastSources: [],
          lastLocalSources: [],
        })
        sessionMutationQueue.enqueue(async () => {
          const baseRevision = get().serverRevision
          const response = await fetch('/api/session', {
            method: 'DELETE',
            headers: { 'If-Match': sessionEtag(baseRevision) },
          })
          const envelope = await readSessionEnvelope(response)
          const remoteRevision = revisionFromResponse(response, envelope)
          if (response.status === 412) {
            set({
              sessionConflict: remoteRevision === null
                ? 'The shared session changed on another client. Reload it before clearing it.'
                : `The shared session changed on another client (revision ${remoteRevision}). Reload it before clearing it.`,
            })
            return
          }
          if (response.ok && remoteRevision !== null) {
            set({ serverRevision: remoteRevision, sessionConflict: null })
          }
        })
      },

      hydrateFromServer: async () => {
        try {
          const localSnapshot = get()
          const [historyResponse, sessionResponse] = await Promise.all([
            fetch('/api/history?limit=50'),
            fetch('/api/session'),
          ])
          const historyData = historyResponse.ok
            ? await historyResponse.json() as { history?: Array<{ query?: string }> }
            : { history: [] }
          const sessionData = sessionResponse.ok
            ? await readSessionEnvelope(sessionResponse)
            : { session: null }
          const remoteRevision = sessionResponse.ok
            ? revisionFromResponse(sessionResponse, sessionData)
            : null

          const remoteHistory = (historyData.history ?? [])
            .map((entry) => entry.query?.trim() ?? '')
            .filter(Boolean)
          const mergedHistory = Array.from(new Set([...remoteHistory, ...get().searchHistory]))
            .slice(0, MAX_SEARCH_HISTORY)
          const remote = sessionData.session
          if (remote?.lastMode) {
            set({
              lastQuery: typeof remote.lastQuery === 'string' ? remote.lastQuery : '',
              lastMode: remote.lastMode,
              lastFocusMode: remote.lastFocusMode ?? 'all',
              lastAnswer: typeof remote.lastAnswer === 'string' ? remote.lastAnswer : '',
              lastSources: Array.isArray(remote.lastSources) ? remote.lastSources : [],
              lastLocalSources: Array.isArray(remote.lastLocalSources) ? remote.lastLocalSources : [],
              searchHistory: mergedHistory,
              ...(remoteRevision === null ? {} : { serverRevision: remoteRevision }),
              sessionConflict: null,
            })
          } else {
            set({
              searchHistory: mergedHistory,
              ...(remoteRevision === null ? {} : { serverRevision: remoteRevision }),
              sessionConflict: null,
            })
            if (localSnapshot.lastQuery) {
              const localSession: SharedSessionSnapshot = {
                lastQuery: localSnapshot.lastQuery,
                lastMode: localSnapshot.lastMode,
                lastFocusMode: localSnapshot.lastFocusMode,
                lastAnswer: localSnapshot.lastAnswer,
                lastSources: localSnapshot.lastSources,
                lastLocalSources: localSnapshot.lastLocalSources,
              }
              sessionMutationQueue.enqueue(async () => {
                const baseRevision = get().serverRevision
                const response = await fetch('/api/session', {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'application/json',
                    'If-Match': sessionEtag(baseRevision),
                  },
                  body: JSON.stringify(localSession),
                })
                const envelope = await readSessionEnvelope(response)
                const savedRevision = revisionFromResponse(response, envelope)
                if (response.status === 412) {
                  set({ sessionConflict: 'The shared session changed while this device was reconnecting. Reload it before saving again.' })
                } else if (response.ok && savedRevision !== null) {
                  set({ serverRevision: savedRevision, sessionConflict: null })
                }
              })
            }
          }

          const remoteQueries = new Set(remoteHistory)
          for (const localQuery of localSnapshot.searchHistory.filter((item) => !remoteQueries.has(item))) {
            sessionMutationQueue.enqueue(() => fetch('/api/history', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                query: localQuery,
                mode: localSnapshot.lastMode,
                focus: localSnapshot.lastFocusMode,
              }),
            }))
          }
        } catch {
          // localStorage remains an offline cache when the shared node is unavailable.
        }
      },
    }),
    { name: KEEPINDEX_STORAGE_KEYS.session, storage: createJSONStorage(() => safeStorage()) }
  )
)
