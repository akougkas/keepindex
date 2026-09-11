import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ComputeProfile } from '@/lib/query-impact'
import { collectionMutationQueue, sessionMutationQueue } from '@/lib/mutation-queue'
import { clearKeepIndexClientStorage, KEEPINDEX_STORAGE_KEYS } from '@/lib/storage-contract'

export const DEFAULT_MODEL = ''
export const FALLBACK_MODEL = ''
let modelFetchGeneration = 0

export interface ModelInfo {
  id: string
  aliases: string[]
  tags: string[]
  isReasoning?: boolean
}

export interface AiConnectionSummary { id: string; name: string; url: string; scope: 'local' | 'remote' }

interface SettingsState {
  aiConnection: AiConnectionSummary | null
  llmEndpoint: string
  searxngEndpoint: string
  selectedModel: string
  availableModels: ModelInfo[]
  configuredDefault: string
  configuredFallback: string
  searchResultsCount: number
  showThinking: boolean
  showQueryMetrics: boolean
  computeProfile: ComputeProfile
  customPowerWatts: number
  electricityRateUsdPerKwh: number
  gridCarbonGramsPerKwh: number
  isLoadingModels: boolean
  modelsError: string | null

  setLlmEndpoint: (endpoint: string) => void
  setSearxngEndpoint: (endpoint: string) => void
  setSelectedModel: (model: string) => Promise<void>
  setSearchResultsCount: (count: number) => void
  setShowThinking: (show: boolean) => void
  setShowQueryMetrics: (show: boolean) => void
  setComputeProfile: (profile: ComputeProfile) => void
  setCustomPowerWatts: (watts: number) => void
  setElectricityRate: (rate: number) => void
  setGridCarbonIntensity: (grams: number) => void
  fetchModels: () => Promise<void>
  resetAll: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      // Provider endpoints are server-managed through environment variables;
      // the browser never needs machine-specific host or port defaults.
      aiConnection: null,
      llmEndpoint: '',
      searxngEndpoint: '',
      selectedModel: DEFAULT_MODEL,
      availableModels: [],
      configuredDefault: DEFAULT_MODEL,
      configuredFallback: FALLBACK_MODEL,
      searchResultsCount: 10,
      showThinking: true,
      showQueryMetrics: true,
      computeProfile: 'desktop',
      customPowerWatts: 350,
      electricityRateUsdPerKwh: 0.16,
      gridCarbonGramsPerKwh: 400,
      isLoadingModels: false,
      modelsError: null,

      setLlmEndpoint: (llmEndpoint) => set({ llmEndpoint }),
      setSearxngEndpoint: (searxngEndpoint) => set({ searxngEndpoint }),

      setSelectedModel: async (requestedModel) => {
        const model = requestedModel.trim()
        if (!model || !get().availableModels.some((candidate) => candidate.id === model)) return
        const previousModel = get().selectedModel
        set({ selectedModel: model, modelsError: null })
        try {
          const response = await fetch('/api/models/select', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, connectionId: get().aiConnection?.id }),
          })
          if (!response.ok) {
            const data = await response.json().catch(() => ({})) as { error?: string }
            set({ selectedModel: previousModel, modelsError: data.error ?? 'Could not select this model.' })
          }
        } catch {
          set({ selectedModel: previousModel, modelsError: 'Model selection will retry when the selected AI endpoint reconnects.' })
        }
      },

      setSearchResultsCount: (searchResultsCount) =>
        set({ searchResultsCount: Math.max(5, Math.min(25, searchResultsCount)) }),

      setShowThinking: (showThinking) => set({ showThinking }),
      setShowQueryMetrics: (showQueryMetrics) => set({ showQueryMetrics }),
      setComputeProfile: (computeProfile) => set({ computeProfile }),
      setCustomPowerWatts: (customPowerWatts) => set({ customPowerWatts: Math.max(10, Math.min(2000, customPowerWatts || 10)) }),
      setElectricityRate: (electricityRateUsdPerKwh) => set({ electricityRateUsdPerKwh: Math.max(0, Math.min(5, electricityRateUsdPerKwh || 0)) }),
      setGridCarbonIntensity: (gridCarbonGramsPerKwh) => set({ gridCarbonGramsPerKwh: Math.max(0, Math.min(2000, gridCarbonGramsPerKwh || 0)) }),

      fetchModels: async () => {
        const generation = ++modelFetchGeneration
        set({ isLoadingModels: true, modelsError: null })
        try {
          const res = await fetch('/api/models')
          if (!res.ok) throw new Error('Failed to fetch models')
          const data = (await res.json()) as {
            connection?: AiConnectionSummary
            models?: ModelInfo[]
            activeModel?: string
            configuredDefault?: string
            configuredFallback?: string
            error?: string
          }
          if (generation !== modelFetchGeneration) return
          if (Array.isArray(data.models) && data.models.length > 0) {
            const currentSelected = data.connection?.id === get().aiConnection?.id ? get().selectedModel : ''
            const selectedModel = data.models.some((model) => model.id === currentSelected)
              ? currentSelected
              : data.models.some((model) => model.id === data.activeModel)
                ? data.activeModel!
                : data.models[0].id
            set({
              aiConnection: data.connection ?? get().aiConnection,
              availableModels: data.models,
              selectedModel,
              configuredDefault: data.configuredDefault ?? get().configuredDefault,
              configuredFallback: data.configuredFallback ?? get().configuredFallback,
              isLoadingModels: false,
              modelsError: data.error ?? null,
            })
          } else {
            set({ aiConnection: data.connection ?? get().aiConnection, availableModels: [], selectedModel: '', isLoadingModels: false, modelsError: data.error ?? null })
          }
        } catch (err) {
          if (generation !== modelFetchGeneration) return
          set({
            isLoadingModels: false,
            modelsError: err instanceof Error ? err.message : 'Could not fetch models',
          })
        }
      },

      resetAll: async () => {
        if (typeof window !== 'undefined') {
          // Drain queued saves before deleting their backing rows, then verify
          // every reset response. A failed server delete must not be disguised
          // by clearing the browser and reloading anyway.
          await Promise.all([
            collectionMutationQueue.runAfterPending(async () => undefined),
            sessionMutationQueue.runAfterPending(async () => undefined),
          ])
          const resetRequests: Array<[string, RequestInit]> = [
            ['/api/collections', { method: 'DELETE' }],
            ['/api/history', { method: 'DELETE' }],
            ['/api/session', { method: 'DELETE', headers: { 'If-Match': '*' } }],
            ['/api/knowledge/clear', { method: 'POST' }],
            ['/api/browser-history', { method: 'DELETE' }],
            ['/api/telemetry', { method: 'DELETE' }],
            ['/api/queries', { method: 'DELETE' }],
          ]
          const responses = await Promise.all(
            resetRequests.map(([url, init]) => fetch(url, init).then((response) => ({ url, response })))
          )
          const failed = responses.find(({ response }) => !response.ok)
          if (failed) {
            throw new Error(`Factory reset stopped because ${failed.url} returned HTTP ${failed.response.status}. No browser data was cleared.`)
          }
          clearKeepIndexClientStorage(localStorage)
          window.location.reload()
        }
      },
    }),
    {
      name: KEEPINDEX_STORAGE_KEYS.settings,
      version: 5,
      migrate: (persistedState) => {
        const state = (persistedState ?? {}) as Partial<SettingsState>
        return {
          llmEndpoint: state.llmEndpoint ?? '',
          searxngEndpoint: state.searxngEndpoint ?? '',
          selectedModel: state.selectedModel?.trim() || DEFAULT_MODEL,
          searchResultsCount: state.searchResultsCount ?? 10,
          showThinking: state.showThinking ?? true,
          showQueryMetrics: state.showQueryMetrics ?? true,
          computeProfile: state.computeProfile ?? 'desktop',
          customPowerWatts: state.customPowerWatts ?? 350,
          electricityRateUsdPerKwh: state.electricityRateUsdPerKwh ?? 0.16,
          gridCarbonGramsPerKwh: state.gridCarbonGramsPerKwh ?? 400,
        }
      },
      partialize: (state) => ({
        llmEndpoint: state.llmEndpoint,
        searxngEndpoint: state.searxngEndpoint,
        selectedModel: state.selectedModel,
        searchResultsCount: state.searchResultsCount,
        showThinking: state.showThinking,
        showQueryMetrics: state.showQueryMetrics,
        computeProfile: state.computeProfile,
        customPowerWatts: state.customPowerWatts,
        electricityRateUsdPerKwh: state.electricityRateUsdPerKwh,
        gridCarbonGramsPerKwh: state.gridCarbonGramsPerKwh,
      }),
    }
  )
)
