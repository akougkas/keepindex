import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { KEEPINDEX_STORAGE_KEYS } from '@/lib/storage-contract'
import type { Mode } from './app-store'
import { useAppStore } from './app-store'
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
          useAppStore.setState({ error: 'Storage full. Clear some journey history or collections.' })
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

const MAX_NODES = 1000
const MAX_EDGES = 2000
const DEDUPE_WINDOW_MS = 4000
const ACTION_WEIGHTS: Record<JourneyAction, number> = {
  search_completed: 0.5,
  answer_completed: 0.8,
  chat_turn_completed: 0.6,
  research_completed: 1.0,
  followup_clicked: 0.4,
  collection_saved: 0.25,
  collection_loaded: 0.3,
  handoff_to_chat: 0.35,
  handoff_to_ai: 0.35,
  handoff_to_search: 0.3,
  handoff_to_research: 0.4,
  answer_refined: 0.45,
  answer_pinned: 0.2,
  answer_unpinned: 0.2,
}

export type JourneyAction =
  | 'search_completed'
  | 'answer_completed'
  | 'chat_turn_completed'
  | 'research_completed'
  | 'followup_clicked'
  | 'collection_saved'
  | 'collection_loaded'
  | 'handoff_to_chat'
  | 'handoff_to_ai'
  | 'handoff_to_search'
  | 'handoff_to_research'
  | 'answer_refined'
  | 'answer_pinned'
  | 'answer_unpinned'

export interface JourneyNode {
  id: string
  mode: Mode
  action: JourneyAction
  query: string
  timestamp: number
  answer?: string
  metadata?: Record<string, unknown>
}

export interface JourneyEdge {
  id: string
  from: string
  to: string
  type: JourneyAction
  timestamp: number
}

interface AddNodeInput {
  mode: Mode
  action: JourneyAction
  query: string
  answer?: string
  metadata?: Record<string, unknown>
}

interface JourneyState {
  nodes: JourneyNode[]
  edges: JourneyEdge[]
  addNode: (node: AddNodeInput) => string | null
  buildContextBlock: (query: string, mode: Mode, maxItems?: number) => string
  clear: () => void
  exportMarkdown: () => string
  exportJson: () => string
}

function truncate(text: string, max = 200): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}...` : t
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2)
}

export const useJourneyStore = create<JourneyState>()(
  persist(
    (set, get) => ({
      nodes: [],
      edges: [],

      addNode: (node) => {
        const query = node.query.trim()
        if (!query) return null

        const now = Date.now()
        const duplicate = [...get().nodes]
          .reverse()
          .find(
            (existing) =>
              existing.mode === node.mode &&
              existing.action === node.action &&
              existing.query.toLowerCase() === query.toLowerCase() &&
              now - existing.timestamp < DEDUPE_WINDOW_MS
          )
        if (duplicate) {
          return duplicate.id
        }

        const id = createId()
        set((s) => {
          const nextNode: JourneyNode = {
            id,
            mode: node.mode,
            action: node.action,
            query,
            timestamp: now,
            answer: node.answer ? truncate(node.answer, 200) : undefined,
            metadata: node.metadata,
          }
          const nodes = [...s.nodes, nextNode].slice(-MAX_NODES)
          const edges =
            s.nodes.length > 0
              ? [
                  ...s.edges,
                  {
                    id: createId(),
                    from: s.nodes[s.nodes.length - 1].id,
                    to: id,
                    type: node.action,
                    timestamp: now,
                  },
                ].slice(-MAX_EDGES)
              : s.edges
          return { nodes, edges }
        })
        return id
      },

      buildContextBlock: (query, mode, maxItems = 6) => {
        const targetTokens = new Set(tokenize(query))
        const now = Date.now()
        const scored = get().nodes
          .map((node) => {
            const nodeTokens = tokenize(node.query)
            const overlap = nodeTokens.filter((token) => targetTokens.has(token)).length
            const ageHours = Math.max(1, (now - node.timestamp) / 3_600_000)
            const recency = Math.exp(-ageHours / 48)
            const modeBoost = node.mode === mode ? 0.5 : 0
            const actionBoost = ACTION_WEIGHTS[node.action] ?? 0
            const score = overlap * 2.5 + recency + modeBoost + actionBoost
            return { node, score, overlap }
          })
          .filter(({ overlap, node }) => {
            if (targetTokens.size === 0) return true
            if (overlap > 0) return true
            return node.action.startsWith('handoff_')
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, maxItems)
          .map(({ node }) => node)

        if (scored.length === 0) return ''

        const uniqueScored = scored.filter((node, index, arr) => {
          const key = `${node.action}:${node.query.toLowerCase()}`
          return index === arr.findIndex((candidate) => `${candidate.action}:${candidate.query.toLowerCase()}` === key)
        })

        const lines = ['Prior journey context (private local memory):']
        for (const node of uniqueScored) {
          const ts = new Date(node.timestamp).toISOString()
          lines.push(
            `- [${ts}] ${node.mode}/${node.action}: q="${truncate(node.query, 120)}"${
              node.answer ? ` | a="${truncate(node.answer, 120)}"` : ''
            }`
          )
        }
        return lines.join('\n')
      },

      clear: () => set({ nodes: [], edges: [] }),

      exportMarkdown: () => {
        const { nodes, edges } = get()
        const lines: string[] = [
          '# KeepIndex Journey Graph',
          '',
          `Generated: ${new Date().toISOString()}`,
          `Nodes: ${nodes.length}`,
          `Edges: ${edges.length}`,
          '',
          '## Timeline',
          '',
        ]

        for (const node of nodes) {
          lines.push(`### ${new Date(node.timestamp).toISOString()} - ${node.action}`)
          lines.push(`- Mode: ${node.mode}`)
          lines.push(`- Query: ${truncate(node.query, 300)}`)
          if (node.answer) lines.push(`- Answer: ${truncate(node.answer, 350)}`)
          const webCount = (node.metadata?.webSourceCount as number) ?? 0
          const localCount = (node.metadata?.localSourceCount as number) ?? 0
          if (webCount) lines.push(`- Web Sources: ${webCount}`)
          if (localCount) lines.push(`- Local Sources: ${localCount}`)
          const otherMeta = node.metadata
            ? Object.fromEntries(
                Object.entries(node.metadata).filter(
                  ([k]) => k !== 'webSourceCount' && k !== 'localSourceCount'
                )
              )
            : {}
          if (Object.keys(otherMeta).length) {
            lines.push(`- Metadata: ${JSON.stringify(otherMeta)}`)
          }
          lines.push('')
        }

        lines.push('## Edges')
        lines.push('')
        for (const edge of edges) {
          lines.push(`- ${edge.from} -> ${edge.to} (${edge.type})`)
        }
        lines.push('')
        return lines.join('\n')
      },

      exportJson: () =>
        JSON.stringify(
          {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            nodes: get().nodes,
            edges: get().edges,
          },
          null,
          2
        ),
    }),
    { name: KEEPINDEX_STORAGE_KEYS.journey, storage: createJSONStorage(() => safeStorage()) }
  )
)
