import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  FolderSearch,
  Library,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import { Omnibar } from '@/components/Omnibar'
import { BentoLayout } from '@/components/BentoLayout'
import { KeepIndexLogo } from '@/components/KeepIndexLogo'
import { ThemeToggle } from '@/components/ThemeToggle'
import { ModelSelectorDropdown } from '@/components/ModelSelectorDropdown'
import { useAppStore } from '@/stores/app-store'
import { useChatHistoryStore } from '@/stores/chat-history-store'
import { useCollectionsStore } from '@/stores/collections-store'
import { useSessionStore } from '@/stores/session-store'
import { useSystemStore } from '@/stores/system-store'
import { useFocusStore } from '@/stores/focus-store'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { cn } from '@/lib/utils'
import {
  clearAllWorkspaceRecovery,
  loadWorkspaceRecovery,
  subscribeToWorkspaceRecovery,
} from '@/lib/workspace-recovery'

const CommandPalette = lazy(() =>
  import('@/components/CommandPalette').then((module) => ({ default: module.CommandPalette }))
)
const CollectionsPanel = lazy(() =>
  import('@/components/CollectionsPanel').then((module) => ({ default: module.CollectionsPanel }))
)
const KnowledgeSettings = lazy(() =>
  import('@/components/KnowledgeSettings').then((module) => ({ default: module.KnowledgeSettings }))
)
const SettingsPanel = lazy(() =>
  import('@/components/SettingsPanel').then((module) => ({ default: module.SettingsPanel }))
)
const SourcePreviewDrawer = lazy(() =>
  import('@/components/SourcePreviewDrawer').then((module) => ({ default: module.SourcePreviewDrawer }))
)

function App() {
  const omnibarRef = useRef<HTMLInputElement | null>(null)
  const sessionRestoredRef = useRef(false)
  const recoveryRef = useRef(loadWorkspaceRecovery())
  const setOmnibarRef = useFocusStore((state) => state.setOmnibarRef)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [knowledgeOpen, setKnowledgeOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [recoveryNotice, setRecoveryNotice] = useState(false)
  const health = useSystemStore((state) => state.health)
  const healthError = useSystemStore((state) => state.healthError)
  const isBrowserOnline = useSystemStore((state) => state.isBrowserOnline)
  const checkHealth = useSystemStore((state) => state.checkHealth)
  const setBrowserOnline = useSystemStore((state) => state.setBrowserOnline)

  const collectionsOpen = useAppStore((state) => state.collectionsOpen)
  const setCollectionsOpen = useAppStore((state) => state.setCollectionsOpen)
  const setMode = useAppStore((state) => state.setMode)
  const hasWorkspace = useAppStore((state) => Boolean(
    state.query ||
      state.answer ||
      state.searchResults.length ||
      state.chatMessages.length ||
      state.researchReport ||
      state.researchSteps.length ||
      state.isLoading ||
      state.isChatStreaming ||
      state.isResearching
  ))

  useKeyboardShortcuts(omnibarRef, () => setCommandPaletteOpen(true))

  useEffect(() => {
    setOmnibarRef(omnibarRef)
    return () => setOmnibarRef(null)
  }, [setOmnibarRef])

  useEffect(() => {
    const refresh = () => void checkHealth()
    const handleOnline = () => { setBrowserOnline(true); refresh() }
    const handleOffline = () => setBrowserOnline(false)
    const handleVisibility = () => { if (document.visibilityState === 'visible') refresh() }
    refresh()
    const interval = window.setInterval(refresh, 45_000)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [checkHealth, setBrowserOnline])

  useEffect(() => {
    const checkpoints = subscribeToWorkspaceRecovery(useAppStore)
    const flush = () => checkpoints.flush()
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', handleVisibility)
      checkpoints.stop()
    }
  }, [])

  useEffect(() => {
    const restoreSession = () => {
      const interrupted = recoveryRef.current
      useAppStore.getState().abortActiveRequests(false)
      if (interrupted) {
        useAppStore.setState({
          mode: interrupted.mode,
          modeManuallySet: false,
          modeJustSwitched: null,
          query: interrupted.query,
          activeRetrievalQuery: interrupted.activeRetrievalQuery,
          focusMode: interrupted.focusMode,
          answer: interrupted.answer,
          thinking: interrupted.thinking,
          sources: interrupted.sources,
          localSources: interrupted.localSources,
          searchResults: interrupted.searchResults,
          searchResultsQuery: interrupted.searchResultsQuery,
          chatMessages: interrupted.chatMessages,
          chatThinking: interrupted.chatThinking,
          chatMetrics: interrupted.chatMetrics,
          researchPlan: interrupted.researchPlan,
          researchSteps: interrupted.researchSteps,
          researchReport: interrupted.researchReport,
          researchThinking: interrupted.researchThinking,
          researchSources: interrupted.researchSources,
          answerMetrics: interrupted.answerMetrics,
          researchMetrics: interrupted.researchMetrics,
          answerQuality: interrupted.answerQuality,
          researchQuality: interrupted.researchQuality,
          answerStartTime: null,
          researchStartTime: null,
          researchEndTime: null,
          isLoading: false,
          isChatStreaming: false,
          isResearching: false,
          isThinking: false,
          error: null,
        })
        recoveryRef.current = null
        clearAllWorkspaceRecovery()
        setRecoveryNotice(true)
        return
      }
      const session = useSessionStore.getState()
      if (session.lastMode) setMode(session.lastMode)
      useAppStore.setState({
        focusMode: session.lastFocusMode,
        activeRetrievalQuery: session.lastQuery,
        error: null,
        modeManuallySet: false,
        modeJustSwitched: null,
      })
      if (session.lastAnswer && (session.lastMode === 'ai' || session.lastMode === 'research')) {
        if (session.lastMode === 'ai') {
          useAppStore.setState({
            query: session.lastQuery,
            answer: session.lastAnswer,
            sources: session.lastSources,
            localSources: session.lastLocalSources,
          })
        } else {
          useAppStore.setState({
            query: session.lastQuery,
            researchReport: session.lastAnswer,
            researchSources: { web: session.lastSources, local: session.lastLocalSources },
          })
        }
      } else if (session.lastMode === 'chat') {
        const { activeConversationId, loadConversation } = useChatHistoryStore.getState()
        if (activeConversationId) loadConversation(activeConversationId)
        else useAppStore.setState({ chatMessages: [], query: session.lastQuery })
      } else if (session.lastQuery && session.lastMode === 'search') {
        useAppStore.setState({
          query: session.lastQuery,
          searchResults: session.lastSources ?? [],
          searchResultsQuery: session.lastQuery,
        })
      }
    }

    const maybeRestore = () => {
      if (sessionRestoredRef.current || !useSessionStore.persist.hasHydrated()) return
      const pendingSession = useSessionStore.getState()
      if (pendingSession.lastMode === 'chat' && !useChatHistoryStore.persist.hasHydrated()) return
      sessionRestoredRef.current = true
      void Promise.allSettled([
        useSessionStore.getState().hydrateFromServer(),
        useCollectionsStore.getState().hydrateFromServer(),
      ]).then(restoreSession)
    }

    const unsubscribers: Array<() => void> = []
    if (!useSessionStore.persist.hasHydrated()) {
      unsubscribers.push(useSessionStore.persist.onFinishHydration(maybeRestore))
    }
    if (!useChatHistoryStore.persist.hasHydrated()) {
      unsubscribers.push(useChatHistoryStore.persist.onFinishHydration(maybeRestore))
    }
    maybeRestore()
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [setMode])

  return (
    <div className="keepindex-shell min-h-screen bg-background text-foreground">
      <header className={cn('app-header', hasWorkspace && 'app-header-workspace')}>
        <nav className="mx-auto flex h-16 w-full max-w-[1500px] items-center gap-3 px-4 sm:px-6 lg:px-8" aria-label="Primary navigation">
          <KeepIndexLogo />
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="hidden items-center gap-2 border-l border-border/70 pl-3 md:flex"
            title={health ? `System health ${health.healthScore}%` : healthError ?? 'Checking local node'}
          >
            <span className={cn('signal-dot', (!isBrowserOnline || healthError) && 'signal-dot-offline', health?.status === 'degraded' && !healthError && 'signal-dot-degraded')} aria-hidden />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {!isBrowserOnline ? 'browser offline' : healthError ? 'node offline' : health?.status === 'degraded' ? `${health.healthScore}% node` : 'local node'}
            </span>
          </button>
          <div className="flex-1" />
          <div className="hidden lg:block">
            <ModelSelectorDropdown />
          </div>
          <HeaderAction label="Knowledge vault" onClick={() => setKnowledgeOpen(true)}>
            <FolderSearch className="size-4" />
          </HeaderAction>
          <HeaderAction label="Collections" onClick={() => setCollectionsOpen(true)}>
            <Library className="size-4" />
          </HeaderAction>
          <HeaderAction label="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings className="size-4" />
          </HeaderAction>
          <ThemeToggle />
        </nav>

        {hasWorkspace && (
          <div className="workspace-search-rail border-t border-border/50 px-4 py-3 sm:px-6">
            <div className="mx-auto w-full max-w-5xl">
              <Omnibar ref={omnibarRef} compact />
            </div>
          </div>
        )}
      </header>

      {recoveryNotice && (
        <div className="mx-auto mt-3 flex w-[calc(100%-2rem)] max-w-5xl items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/[0.06] px-3 py-2 text-xs" role="status">
          <span>Recovered the last interrupted workspace. Partial output is preserved but was not marked complete.</span>
          <button type="button" onClick={() => setRecoveryNotice(false)} className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground">Dismiss</button>
        </div>
      )}

      <main className={cn('relative', hasWorkspace ? 'pb-12' : 'min-h-[calc(100vh-4rem)]')}>
        {hasWorkspace ? (
          <BentoLayout />
        ) : (
          <Hero omnibarRef={omnibarRef} />
        )}
      </main>

      <Suspense fallback={null}>
        <CollectionsPanel isOpen={collectionsOpen} onClose={() => setCollectionsOpen(false)} />
        <KnowledgeSettings isOpen={knowledgeOpen} onClose={() => setKnowledgeOpen(false)} />
        <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <CommandPalette
          isOpen={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          omnibarRef={omnibarRef}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenKnowledge={() => setKnowledgeOpen(true)}
        />
        <SourcePreviewDrawer />
      </Suspense>
    </div>
  )
}

function Hero({ omnibarRef }: { omnibarRef: React.RefObject<HTMLInputElement | null> }) {
  return (
    <section className="hero-stage mx-auto flex w-full max-w-[1500px] flex-col px-4 pb-12 pt-[clamp(4rem,12vh,9rem)] sm:px-6 lg:px-8">
      <div className="hero-orbit hero-orbit-one" aria-hidden />
      <div className="hero-orbit hero-orbit-two" aria-hidden />

      <div className="relative z-10 mx-auto w-full max-w-5xl text-center">
        <div className="hero-kicker mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/65 px-3 py-1.5 backdrop-blur-xl">
          <ShieldCheck className="size-3.5 text-primary" />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            your computer · your sources · local AI
          </span>
        </div>
        <h2 className="hero-title mx-auto max-w-4xl text-balance text-[clamp(3.1rem,8vw,7.2rem)] font-semibold leading-[0.88] tracking-[-0.065em]">
          Search your world.
          <span className="block text-primary">Keep it yours.</span>
        </h2>
        <p className="hero-descriptor mx-auto mt-6 max-w-xl text-balance text-sm text-muted-foreground sm:text-base">
          Private search on your computer. Your choice of AI.
          <span className="mx-2 text-border" aria-hidden>·</span>
          <span className="font-mono text-[0.78em] tracking-[0.1em] text-foreground">keepindex<span className="text-primary">.ing</span></span>
        </p>
        <div className="mx-auto mt-10 w-full max-w-4xl text-left">
          <Omnibar ref={omnibarRef} />
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.13em] text-muted-foreground/80">
            <span><kbd>/</kbd> focus</span>
            <span><kbd>↵</kbd> ask</span>
            <span><kbd>⇧ ↵</kbd> research</span>
            <span><kbd>⌘ K</kbd> commands</span>
          </div>
        </div>
      </div>

    </section>
  )
}

function HeaderAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="header-action"
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  )
}

export default App
