import { create } from 'zustand'

export type KnowledgeResource = {
  id: string
  path: string
  label: string
  kind?: 'obsidian' | 'folder'
  indexedAt: number
  latestModifiedAt: number
  fileCount: number
  chunkCount: number
  indexedBytes: number
  noteCount?: number
  documentCount?: number
  codeFileCount?: number
  metadataFileCount?: number
  formatCounts?: Record<string, number>
  capped: boolean
  skippedLargeFiles: number
  skippedSensitiveFiles: number
  skippedUnreadableFiles: number
  mounted: boolean
  refreshDue: boolean
  coveragePct: number
  healthScore: number
}

export type KnowledgeStatus = {
  indexed: boolean
  chunkCount: number
  fileCount: number
  path: string | null
  resources: KnowledgeResource[]
  resourceCount: number
  healthScore: number
  refreshDueCount: number
  unavailableCount: number
  persistent: boolean
  databasePath?: string
}

export type BrowserHistorySource = {
  id: string
  path: string
  browser: string
  profile: string
  platform: 'linux' | 'windows'
}

export type BrowserHistoryStatus = {
  indexed: boolean
  entryCount: number
  latestVisitedAt: number | null
  lastImportedAt: number | null
  sources: Array<{ browser: string; profile: string; entryCount: number; lastImportedAt: number }>
  discovered: BrowserHistorySource[]
  private: boolean
  storage: string
}

type IndexResult = {
  indexed: number
  files: number
  capped: boolean
  skippedLargeFiles: number
  skippedSensitiveFiles: number
  skippedUnreadableFiles: number
  resource?: KnowledgeResource
}

interface KnowledgeState {
  knowledgePath: string | null
  knowledgeStatus: KnowledgeStatus | null
  isIndexing: boolean
  activeResourceId: string | null
  indexError: string | null
  statusError: string | null
  browserHistoryStatus: BrowserHistoryStatus | null
  isImportingHistory: boolean
  browserHistoryError: string | null
  indexKnowledge: (path: string, label?: string) => Promise<IndexResult | null>
  refreshResource: (resource: KnowledgeResource) => Promise<IndexResult | null>
  refreshAll: () => Promise<void>
  removeResource: (id: string) => Promise<boolean>
  fetchKnowledgeStatus: () => Promise<void>
  fetchBrowserHistoryStatus: () => Promise<void>
  importBrowserHistory: (paths?: string[]) => Promise<number | null>
  clearBrowserHistory: () => Promise<boolean>
  clearIndex: () => Promise<boolean>
}

const EMPTY_STATUS: KnowledgeStatus = {
  indexed: false,
  chunkCount: 0,
  fileCount: 0,
  path: null,
  resources: [],
  resourceCount: 0,
  healthScore: 0,
  refreshDueCount: 0,
  unavailableCount: 0,
  persistent: true,
}

export const useKnowledgeStore = create<KnowledgeState>()((set, get) => ({
  knowledgePath: null,
  knowledgeStatus: null,
  isIndexing: false,
  activeResourceId: null,
  indexError: null,
  statusError: null,
  browserHistoryStatus: null,
  isImportingHistory: false,
  browserHistoryError: null,

  indexKnowledge: async (path, label) => {
    set({ isIndexing: true, indexError: null })
    try {
      const response = await fetch('/api/knowledge/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, label: label?.trim() || undefined }),
      })
      const data = (await response.json()) as Partial<IndexResult> & { path?: string; error?: string }
      if (!response.ok) {
        set({
          isIndexing: false,
          indexError: data.error ?? 'Could not index this path. Check that the disk or mount is available.',
        })
        return null
      }
      await get().fetchKnowledgeStatus()
      set({ isIndexing: false, knowledgePath: data.path ?? path, indexError: null })
      return {
        indexed: data.indexed ?? 0,
        files: data.files ?? 0,
        capped: !!data.capped,
        skippedLargeFiles: data.skippedLargeFiles ?? 0,
        skippedSensitiveFiles: data.skippedSensitiveFiles ?? 0,
        skippedUnreadableFiles: data.skippedUnreadableFiles ?? 0,
        resource: data.resource,
      }
    } catch {
      set({ isIndexing: false, indexError: 'Could not connect to the KeepIndex API.' })
      return null
    }
  },

  refreshResource: async (resource) => {
    set({ activeResourceId: resource.id })
    try {
      return await get().indexKnowledge(resource.path, resource.label)
    } finally {
      set({ activeResourceId: null })
    }
  },

  refreshAll: async () => {
    const resources = [...(get().knowledgeStatus?.resources ?? [])]
    for (const resource of resources) {
      if (!(await get().refreshResource(resource))) break
    }
  },

  removeResource: async (id) => {
    set({ indexError: null, activeResourceId: id })
    try {
      const response = await fetch(`/api/knowledge/resources/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      const data = (await response.json()) as { error?: string }
      if (!response.ok) {
        set({ indexError: data.error ?? 'Could not remove this knowledge source.' })
        return false
      }
      await get().fetchKnowledgeStatus()
      return true
    } catch {
      set({ indexError: 'Could not connect to the KeepIndex API.' })
      return false
    } finally {
      set({ activeResourceId: null })
    }
  },

  fetchKnowledgeStatus: async () => {
    try {
      const response = await fetch('/api/knowledge/status')
      if (!response.ok) throw new Error('status request failed')
      const data = (await response.json()) as KnowledgeStatus
      const normalized = { ...EMPTY_STATUS, ...data, resources: Array.isArray(data.resources) ? data.resources : [] }
      set({
        knowledgeStatus: normalized,
        knowledgePath: normalized.path ?? null,
        statusError: null,
      })
    } catch {
      set({ statusError: 'Knowledge status is temporarily unavailable.' })
    }
  },

  fetchBrowserHistoryStatus: async () => {
    try {
      const response = await fetch('/api/browser-history/status')
      if (!response.ok) throw new Error('history status failed')
      set({ browserHistoryStatus: await response.json() as BrowserHistoryStatus, browserHistoryError: null })
    } catch {
      set({ browserHistoryError: 'Browser history status is temporarily unavailable.' })
    }
  },

  importBrowserHistory: async (paths) => {
    set({ isImportingHistory: true, browserHistoryError: null })
    try {
      const response = await fetch('/api/browser-history/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paths?.length ? { paths } : {}),
      })
      const data = await response.json() as { imported?: number; error?: string }
      if (!response.ok) {
        set({ browserHistoryError: data.error ?? 'Could not import browser history.' })
        return null
      }
      await get().fetchBrowserHistoryStatus()
      return data.imported ?? 0
    } catch {
      set({ browserHistoryError: 'Could not connect to the KeepIndex API.' })
      return null
    } finally {
      set({ isImportingHistory: false })
    }
  },

  clearBrowserHistory: async () => {
    set({ isImportingHistory: true, browserHistoryError: null })
    try {
      const response = await fetch('/api/browser-history', { method: 'DELETE' })
      if (!response.ok) throw new Error('clear history failed')
      await get().fetchBrowserHistoryStatus()
      return true
    } catch {
      set({ browserHistoryError: 'Could not clear the private browser history index.' })
      return false
    } finally {
      set({ isImportingHistory: false })
    }
  },

  clearIndex: async () => {
    set({ isIndexing: true, indexError: null })
    try {
      const response = await fetch('/api/knowledge/clear', { method: 'POST' })
      if (!response.ok) throw new Error('clear failed')
      set({ knowledgePath: null, knowledgeStatus: EMPTY_STATUS, isIndexing: false })
      return true
    } catch {
      set({ isIndexing: false, indexError: 'Could not clear the shared knowledge index.' })
      return false
    }
  },
}))
