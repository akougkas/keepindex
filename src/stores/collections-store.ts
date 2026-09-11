import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { KEEPINDEX_STORAGE_KEYS } from '@/lib/storage-contract'
import { useAppStore, type KnowledgeSource, type Source } from './app-store'
import { useJourneyStore } from './journey-store'
import { collectionMutationQueue } from '@/lib/mutation-queue'
import { createId } from '@/lib/utils'

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
      } catch (e) {
        if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)) {
          useAppStore.setState({ error: 'Storage full. Remove some saved items.' })
        }
      }
    },
    removeItem: (name: string) => {
      try {
        localStorage.removeItem(name)
      } catch {
        /* ignore */
      }
    },
  }
}

export interface CollectionItem {
  id: string
  query: string
  answer: string
  sources: Source[]
  localSources?: KnowledgeSource[]
  researchPlan?: string[]
  mode: 'ai' | 'search' | 'research'
  createdAt: number
}

function compactSnapshotText(value: string, max: number): string {
  const compacted = value.replace(/\s+/g, ' ').trim()
  return compacted.length > max ? `${compacted.slice(0, max)}…` : compacted
}

export function formatSearchCollectionSnapshot(
  query: string,
  results: CollectionItem['sources']
): string {
  const entries = results.slice(0, 50).map((source, index) => [
    `## ${index + 1}. ${compactSnapshotText(source.title || source.url, 240)}`,
    source.filePath ? `File: ${source.filePath}` : `URL: ${source.url}`,
    compactSnapshotText(source.snippet, 1_000),
  ].filter(Boolean).join('\n'))
  return [
    `# Search snapshot: ${compactSnapshotText(query, 500)}`,
    `Saved ${results.length} fused result${results.length === 1 ? '' : 's'} from web and private sources.`,
    ...entries,
  ].join('\n\n')
}

export function collectionMatchesSearch(item: CollectionItem, input: string): boolean {
  const needle = input.trim().toLocaleLowerCase()
  if (!needle) return true
  return [
    item.query,
    item.answer,
    ...item.sources.flatMap((source) => [source.title, source.snippet, source.url]),
    ...(item.localSources ?? []).flatMap((source) => [source.fileName, source.content, source.filePath]),
  ].some((value) => value.toLocaleLowerCase().includes(needle))
}

interface CollectionsState {
  items: CollectionItem[]
  saveCurrentAnswer: () => boolean
  removeItem: (id: string) => void
  clearAll: () => void
  isCurrentSaved: () => boolean
  hydrateFromServer: () => Promise<void>
}

export const useCollectionsStore = create<CollectionsState>()(
  persist(
    (set, get) => ({
      items: [],

      saveCurrentAnswer: () => {
        const {
          query,
          answer,
          sources,
          localSources,
          searchResults,
          mode,
          researchReport,
          researchPlan,
          researchSources,
        } = useAppStore.getState()
        if (mode === 'chat') return false
        if (!query) return false

        const content =
          mode === 'research'
            ? researchReport
            : mode === 'search'
              ? formatSearchCollectionSnapshot(query, searchResults)
              : answer
        if (mode === 'search' && searchResults.length === 0) return false
        if (mode !== 'search' && !content) return false

        const existing = get().items.find((i) =>
          mode === 'search'
            ? i.mode === 'search' && i.query === query
            : i.mode === mode && i.query === query && i.answer === content
        )
        if (existing) return false
        const item: CollectionItem = {
          id: createId(),
          query,
          answer: content,
          sources:
            mode === 'research'
              ? (researchSources?.web ?? [])
              : mode === 'search'
                ? [...searchResults]
                : [...sources],
          localSources:
            mode === 'research'
              ? (researchSources?.local ?? [])
              : mode === 'search'
                ? undefined
                : localSources?.length
                  ? [...localSources]
                  : undefined,
          researchPlan: mode === 'research' ? researchPlan : undefined,
          mode,
          createdAt: Date.now(),
        }
        set((s) => ({ items: [item, ...s.items] }))
        collectionMutationQueue.enqueue(() => fetch('/api/collections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item),
        }))
        useJourneyStore.getState().addNode({
          mode: mode as 'ai' | 'search' | 'chat' | 'research',
          action: 'collection_saved',
          query,
          answer: content,
          metadata: {
            collectionId: item.id,
            webSourceCount: item.sources.length,
            localSourceCount: item.localSources?.length ?? 0,
          },
        })
        return true
      },

      removeItem: (id) => {
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
        collectionMutationQueue.enqueue(() => fetch(`/api/collections/${encodeURIComponent(id)}`, { method: 'DELETE' }))
      },

      clearAll: () => {
        set({ items: [] })
        collectionMutationQueue.enqueue(() => fetch('/api/collections', { method: 'DELETE' }))
      },

      isCurrentSaved: () => {
        const { query, answer, mode, researchReport } = useAppStore.getState()
        if (!query) return false
        if (mode === 'search') {
          return get().items.some((i) => i.mode === 'search' && i.query === query)
        }
        const content = mode === 'research' ? researchReport : answer
        if (!content) return false
        return get().items.some((i) => i.mode === mode && i.query === query && i.answer === content)
      },

      hydrateFromServer: async () => {
        try {
          const response = await fetch('/api/collections')
          if (!response.ok) return
          const data = await response.json() as { items?: CollectionItem[] }
          const remoteItems = Array.isArray(data.items) ? data.items : []
          const localItems = get().items
          const remoteIds = new Set(remoteItems.map((item) => item.id))
          const localOnly = localItems.filter((item) => !remoteIds.has(item.id))
          set({
            items: [...remoteItems, ...localOnly]
              .sort((a, b) => b.createdAt - a.createdAt)
              .slice(0, 500),
          })
          for (const item of localOnly) {
            collectionMutationQueue.enqueue(() => fetch('/api/collections', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item),
            }))
          }
        } catch {
          // Keep the local cache when the local application is unavailable.
        }
      },
    }),
    { name: KEEPINDEX_STORAGE_KEYS.collections, storage: createJSONStorage(() => safeStorage()) }
  )
)
