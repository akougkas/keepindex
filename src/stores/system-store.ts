import { create } from 'zustand'

export type SystemHealth = {
  status: 'ok' | 'degraded'
  healthScore: number
  llm: boolean
  searxng: boolean
  /**
   * Per-engine state observed from the last real search. SearXNG can be
   * reachable while most of its engines refuse it, which silently collapses
   * answers onto a fraction of the intended evidence.
   */
  searxngEngines?: {
    live: string[]
    down: Array<{ engine: string; reason: string }>
    total: number
    coveragePct: number
    observedAt: number | null
    observedQueryCount: number
  }
  database: boolean
  activeModel?: string
  modelCount: number
  knowledge: { resources: number; unavailable: number; score: number }
  latencyMs: { llm: number; searxng: number }
  slots: { total: number; idle: number } | null
  databasePath?: string
  persistence?: string
  uptimeSeconds?: number
  timestamp: string
}

interface SystemState {
  health: SystemHealth | null
  isChecking: boolean
  isBrowserOnline: boolean
  healthError: string | null
  checkedAt: number | null
  checkHealth: () => Promise<void>
  setBrowserOnline: (online: boolean) => void
}

let inFlight: Promise<void> | null = null

export const useSystemStore = create<SystemState>()((set) => ({
  health: null,
  isChecking: false,
  isBrowserOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
  healthError: null,
  checkedAt: null,

  checkHealth: async () => {
    if (inFlight) return inFlight
    set({ isChecking: true })
    inFlight = (async () => {
      try {
        const response = await fetch('/api/health', { cache: 'no-store' })
        if (!response.ok) throw new Error(`health request returned ${response.status}`)
        const health = (await response.json()) as SystemHealth
        set({ health, healthError: null, checkedAt: Date.now() })
      } catch {
        set({ healthError: 'KeepIndex API is unreachable.', checkedAt: Date.now() })
      } finally {
        set({ isChecking: false })
        inFlight = null
      }
    })()
    return inFlight
  },

  setBrowserOnline: (isBrowserOnline) => set({ isBrowserOnline }),
}))
