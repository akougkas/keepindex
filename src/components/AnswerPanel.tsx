import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import { useAppStore } from '@/stores/app-store'
import { useChatHistoryStore } from '@/stores/chat-history-store'
import { useCollectionsStore } from '@/stores/collections-store'
import { useJourneyStore } from '@/stores/journey-store'
import { useSessionStore } from '@/stores/session-store'
import { KeyTakeaways } from '@/components/KeyTakeaways'
import { AnswerRefinements } from '@/components/AnswerRefinements'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Activity, Bookmark, Copy, Check, CheckCircle2, Loader2, Pencil, MessageSquare, Pin, PinOff } from 'lucide-react'
import { ThinkingVisualizer } from '@/components/ThinkingVisualizer'
import { QueryVitals } from '@/components/QueryVitals'
import { useSettingsStore } from '@/stores/settings-store'
import { cn, createId } from '@/lib/utils'
import { markdownComponents, remarkCitations } from '@/lib/markdown-components'
// katex CSS imported in index.css

function AnswerMetadataBar() {
  const sources = useAppStore((s) => s.sources)
  const localSources = useAppStore((s) => s.localSources)
  const answer = useAppStore((s) => s.answer)
  const isLoading = useAppStore((s) => s.isLoading)
  const answerStartTime = useAppStore((s) => s.answerStartTime)
  const answerMetrics = useAppStore((s) => s.answerMetrics)
  const answerQuality = useAppStore((s) => s.answerQuality)

  const scrollToSources = () => {
    const panel = document.querySelector('[data-panel="sources"]')
    if (panel) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' })
      ;(panel as HTMLElement).scrollTo?.({ top: 0, behavior: 'smooth' })
    }
  }

  let status: 'thinking' | 'writing' | 'done' = 'done'
  if (isLoading) {
    status = sources.length > 0 || localSources.length > 0 ? 'writing' : 'thinking'
  }

  const totalSources = sources.length + localSources.length
  const wordCount = answer.trim().split(/\s+/).filter(Boolean).length
  const timeTaken = answerStartTime && !isLoading ? Math.round((Date.now() - answerStartTime) / 1000) : null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-green-500" />
        Powered by local LLM
      </span>
      <button
        type="button"
        onClick={scrollToSources}
        className="hover:text-foreground transition-colors"
      >
        {totalSources} source{totalSources !== 1 ? 's' : ''}
        {localSources.length > 0 && (
          <span className="ml-1 text-emerald-600 dark:text-emerald-400 font-mono">
            ({localSources.length} vault)
          </span>
        )}
      </button>
      <span className="flex items-center gap-1.5">
        {status === 'thinking' && (
          <>
            <Loader2 className="size-3 animate-spin" />
            Thinking...
          </>
        )}
        {status === 'writing' && (
          <>
            <Pencil className="size-3" />
            Writing...
          </>
        )}
        {status === 'done' && (
          <>
            <Check className="size-3" />
            Done
          </>
        )}
      </span>
      {!isLoading && answer && (
        <>
          <span>{wordCount} words</span>
          {timeTaken != null && <span>{timeTaken}s</span>}
        </>
      )}
      </div>
      <QueryVitals metrics={answerMetrics} quality={answerQuality} />
    </div>
  )
}

function AnswerHeaderActions() {
  const answer = useAppStore((s) => s.answer)
  const query = useAppStore((s) => s.query)
  const mode = useAppStore((s) => s.mode)
  const isLoading = useAppStore((s) => s.isLoading)
  const setMode = useAppStore((s) => s.setMode)
  const pinnedResult = useAppStore((s) => s.pinnedResult)
  const pinCurrentResult = useAppStore((s) => s.pinCurrentResult)
  const clearPinnedResult = useAppStore((s) => s.clearPinnedResult)
  const saveCurrentAnswer = useCollectionsStore((s) => s.saveCurrentAnswer)
  const isCurrentSaved = useCollectionsStore((s) => s.isCurrentSaved)
  const [copySuccess, setCopySuccess] = useState(false)
  const [saveNotification, setSaveNotification] = useState(false)

  const handleSave = () => {
    if (!saveCurrentAnswer()) return
    setSaveNotification(true)
    setTimeout(() => setSaveNotification(false), 2500)
  }

  const handleCopy = () => {
    if (!answer) return
    navigator.clipboard.writeText(answer)
    setCopySuccess(true)
    setTimeout(() => setCopySuccess(false), 2000)
  }

  const handleDiscussInChat = () => {
    if (!query || !answer) return
    const { newConversation, saveConversation } = useChatHistoryStore.getState()
    newConversation()
    const messages = [
      { id: createId(), role: 'user' as const, content: query },
      { id: createId(), role: 'assistant' as const, content: answer },
    ]
    useAppStore.setState({ chatMessages: messages })
    saveConversation(messages)
    useJourneyStore.getState().addNode({
      mode: 'chat',
      action: 'handoff_to_chat',
      query,
      answer,
      metadata: { fromMode: 'ai' },
    })
    useSessionStore.getState().setLastSession({
      query,
      mode: 'chat',
      focusMode: useAppStore.getState().focusMode,
    })
    setMode('chat')
  }

  const saved = isCurrentSaved()
  const canSave = !!query && !!answer
  const canCopy = !!answer
  const canDiscuss = !!answer && mode === 'ai'
  const canPin = mode === 'ai' && !!answer && !isLoading
  const isPinned = pinnedResult != null && pinnedResult.mode === 'ai' && pinnedResult.query === query && pinnedResult.answer === answer

  const handlePinToggle = () => {
    if (isPinned) clearPinnedResult()
    else pinCurrentResult()
  }

  return (
    <div className="flex items-center gap-1 relative">
      <AnimatePresence>
        {saveNotification && (
          <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute -top-10 left-1/2 -translate-x-1/2 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md shadow-lg z-10"
          >
            Saved to collection
          </motion.span>
        )}
      </AnimatePresence>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={handleSave}
        disabled={!canSave}
        title={saved ? 'Already saved' : 'Save to collection'}
        className={cn(saved && 'text-primary')}
      >
        <Bookmark
          className={cn('size-4', saved && 'fill-current')}
        />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={handleCopy}
        disabled={!canCopy}
        title="Copy answer"
      >
        {copySuccess ? (
          <Check className="size-4 text-primary" />
        ) : (
          <Copy className="size-4" />
        )}
      </Button>
      {canDiscuss && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleDiscussInChat}
          title="Discuss this answer in chat"
        >
          <MessageSquare className="size-4" />
        </Button>
      )}
      {canPin && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handlePinToggle}
          title={isPinned ? 'Unpin' : 'Pin this answer'}
          className={cn(isPinned && 'text-primary')}
        >
          {isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
        </Button>
      )}
    </div>
  )
}

function handleCitationClick(e: React.MouseEvent) {
  const target = (e.target as HTMLElement).closest('[data-citation]')
  if (!target) return
  const raw = target.getAttribute('data-citation')
  if (!raw) return

  const { sources, localSources, setSourcePreview } = useAppStore.getState()

  if (raw.startsWith('L')) {
    const n = parseInt(raw.slice(1), 10)
    if (n < 1 || n > 99) return
    const index = n - 1
    if (index >= localSources.length) return
    setSourcePreview({ type: 'local', index, source: localSources[index] })
  } else {
    const n = parseInt(raw, 10)
    if (n < 1 || n > 99) return
    const index = n - 1
    if (index >= sources.length) return
    setSourcePreview({ type: 'web', index, source: sources[index] })
  }
}

const PHASE_LABELS: Record<string, string> = {
  request_accepted: 'Request accepted',
  request_setup: 'Settings resolved',
  query_record_start: 'Evidence ledger opened',
  knowledge_load: 'Local index ready',
  query_planning: 'Retrieval plan ready',
  local_retrieval: 'Local knowledge searched',
  embedding_rerank: 'Local evidence embedding-reranked',
  history_retrieval: 'Private history searched',
  web_retrieval: 'Web search completed',
  ranking_and_fusion: 'Evidence ranked and fused',
  web_hydration: 'Primary sources hydrated',
  prompt_assembly: 'Grounded prompt assembled',
}

function RetrievalProgress() {
  const progress = useAppStore((state) => state.answerProgress)
  const visible = progress.filter((phase) => phase.status !== 'skipped').slice(-5)
  const latest = visible[visible.length - 1]

  return (
    <div className="overflow-hidden rounded-lg border border-primary/20 bg-card/55">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-primary">
        <Activity className="size-3.5" />
        {latest ? PHASE_LABELS[latest.phase] ?? latest.phase.replace(/_/g, ' ') : 'Starting retrieval'}
        <Loader2 className="ml-auto size-3 animate-spin" />
      </div>
      <div className="space-y-1 px-3 py-2.5" aria-live="polite">
        {visible.length === 0 ? (
          <p className="font-mono text-[11px] text-muted-foreground">Opening private execution trace…</p>
        ) : visible.map((phase, index) => (
          <motion.div
            key={`${phase.phase}-${phase.elapsedMs}-${index}`}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground"
          >
            <CheckCircle2 className="size-3 shrink-0 text-primary/70" />
            <span className="truncate">{PHASE_LABELS[phase.phase] ?? phase.phase.replace(/_/g, ' ')}</span>
            <span className="ml-auto shrink-0 tabular-nums text-foreground/55">
              {phase.durationMs >= 1000 ? `${(phase.durationMs / 1000).toFixed(1)}s` : `${phase.durationMs}ms`}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

export function AnswerPanel() {
  const answer = useAppStore((s) => s.answer)
  const thinking = useAppStore((s) => s.thinking)
  const isThinking = useAppStore((s) => s.isThinking)
  const isLoading = useAppStore((s) => s.isLoading)
  const error = useAppStore((s) => s.error)
  const mode = useAppStore((s) => s.mode)
  const showThinking = useSettingsStore((s) => s.showThinking)
  const answerProgress = useAppStore((s) => s.answerProgress)

  if (error && mode === 'ai') {
    return (
      <p className="text-sm text-destructive">
        {error}
      </p>
    )
  }

  if (isLoading && !answer && !thinking) {
    return (
      <div className="space-y-4">
        <RetrievalProgress />
        {answerProgress.length < 2 && (
          <div className="space-y-3 opacity-60">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        )}
      </div>
    )
  }

  if (!answer && !thinking) {
    return (
      <p className="text-muted-foreground text-sm">
        Ask a question to get a grounded AI answer with citations.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {showThinking && (thinking || isThinking) && (
        <ThinkingVisualizer thinking={thinking} isThinking={isThinking} />
      )}
      {answer && (
        <div
          className="prose prose-sm dark:prose-invert max-w-none"
          onClick={handleCitationClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              const target = (e.target as HTMLElement).closest('[data-citation]')
              if (target) {
                e.preventDefault()
                ;(target as HTMLElement).click()
              }
            }
          }}
          role="application"
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath, remarkCitations]}
            rehypePlugins={[rehypeKatex]}
            components={markdownComponents}
          >
            {answer}
          </ReactMarkdown>
          {isLoading && (
            <span
              className="inline-block ml-0.5 align-middle text-primary"
              style={{ animation: 'blink 1s step-end infinite' }}
              aria-hidden
            >
              ▊
            </span>
          )}
        </div>
      )}
      {answer && !isLoading && (
        <>
          <KeyTakeaways />
          {mode === 'ai' && <AnswerRefinements mode="ai" />}
        </>
      )}
    </div>
  )
}

export { AnswerMetadataBar, AnswerHeaderActions }
