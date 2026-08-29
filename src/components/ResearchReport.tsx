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
import { ThinkingVisualizer } from '@/components/ThinkingVisualizer'
import { QueryVitals } from '@/components/QueryVitals'
import { useSettingsStore } from '@/stores/settings-store'
import { Copy, Check, Loader2, Bookmark, MessageSquare, Pin, PinOff } from 'lucide-react'
import { cn, createId } from '@/lib/utils'
import { markdownComponents, remarkCitations } from '@/lib/markdown-components'
// katex CSS imported in index.css

export function ResearchReportMetadataBar() {
  const researchReport = useAppStore((s) => s.researchReport)
  const researchSources = useAppStore((s) => s.researchSources)
  const researchStartTime = useAppStore((s) => s.researchStartTime)
  const researchEndTime = useAppStore((s) => s.researchEndTime)
  const researchMetrics = useAppStore((s) => s.researchMetrics)
  const researchQuality = useAppStore((s) => s.researchQuality)
  const totalSources = (researchSources?.web?.length ?? 0) + (researchSources?.local?.length ?? 0)
  const wordCount = researchReport.trim().split(/\s+/).filter(Boolean).length
  const timeTaken =
    researchStartTime && researchEndTime
      ? Math.round((researchEndTime - researchStartTime) / 1000)
      : null

  if (!researchReport) return null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span>{wordCount} words</span>
        <span>{totalSources} sources</span>
        {timeTaken != null && <span>{timeTaken}s</span>}
      </div>
      <QueryVitals metrics={researchMetrics} quality={researchQuality} />
    </div>
  )
}

export function ResearchReportHeaderActions() {
  const researchReport = useAppStore((s) => s.researchReport)
  const query = useAppStore((s) => s.query)
  const isResearching = useAppStore((s) => s.isResearching)
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
    if (!researchReport) return
    navigator.clipboard.writeText(researchReport)
    setCopySuccess(true)
    setTimeout(() => setCopySuccess(false), 2000)
  }

  const handleDiscussInChat = () => {
    if (!query || !researchReport) return
    const { newConversation, saveConversation } = useChatHistoryStore.getState()
    newConversation()
    const messages = [
      { id: createId(), role: 'user' as const, content: query },
      {
        id: createId(),
        role: 'assistant' as const,
        content: `Here's the research report on your query:\n\n${researchReport}`,
      },
    ]
    useAppStore.setState({ chatMessages: messages })
    saveConversation(messages)
    useJourneyStore.getState().addNode({
      mode: 'chat',
      action: 'handoff_to_chat',
      query,
      answer: researchReport,
      metadata: { fromMode: 'research' },
    })
    useSessionStore.getState().setLastSession({
      query,
      mode: 'chat',
      focusMode: useAppStore.getState().focusMode,
    })
    setMode('chat')
  }

  const saved = isCurrentSaved()
  const canSave = !!query && !!researchReport
  const canCopy = !!researchReport
  const canPin = !!researchReport && !isResearching
  const isPinned =
    pinnedResult != null &&
    pinnedResult.mode === 'research' &&
    pinnedResult.query === query &&
    pinnedResult.answer === researchReport

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
        <Bookmark className={cn('size-4', saved && 'fill-current')} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={handleCopy}
        disabled={!canCopy}
        title="Copy report"
      >
        {copySuccess ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
      </Button>
      {researchReport && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleDiscussInChat}
          title="Discuss this report in chat"
        >
          <MessageSquare className="size-4" />
        </Button>
      )}
      {canPin && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handlePinToggle}
          title={isPinned ? 'Unpin' : 'Pin this report'}
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

  const { researchSources, setSourcePreview } = useAppStore.getState()
  const sources = researchSources?.web ?? []
  const localSources = researchSources?.local ?? []

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

export function ResearchReport() {
  const researchReport = useAppStore((s) => s.researchReport)
  const researchThinking = useAppStore((s) => s.researchThinking)
  const researchPlan = useAppStore((s) => s.researchPlan)
  const researchSteps = useAppStore((s) => s.researchSteps)
  const isThinking = useAppStore((s) => s.isThinking)
  const isResearching = useAppStore((s) => s.isResearching)
  const error = useAppStore((s) => s.error)
  const showThinking = useSettingsStore((s) => s.showThinking)

  const latestStage = [...researchSteps]
    .reverse()
    .find((step) => step.type !== 'warning' && step.type !== 'search_results')?.type
  const stageLabel: Record<string, string> = {
    plan: 'Research plan ready',
    searching: 'Searching the web and vault',
    reading: 'Reading source snippets',
    analyzing: 'Checking evidence and gaps',
    analysis: 'Evidence analysis complete',
    gap_fill: 'Filling evidence gaps',
    synthesizing: 'Writing the grounded report',
    done: 'Research complete',
  }
  const warnings = researchSteps.filter((step) => step.type === 'warning')
  if (!isResearching && !researchReport && !researchThinking && researchSteps.length === 0) {
    return <p className="text-sm text-muted-foreground">Your streamed research report will appear here.</p>
  }

  return (
    <div className="space-y-5" aria-live="polite">
      {researchPlan.length > 0 && (
        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Research map · {researchPlan.length} threads
          </p>
          <div className="flex flex-wrap gap-2">
            {researchPlan.map((question, index) => (
              <span
                key={`${question}-${index}`}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/20 bg-primary/[0.06] px-2.5 py-1 text-xs text-foreground"
                title={question}
              >
                <span className="font-mono text-[10px] text-primary">{String(index + 1).padStart(2, '0')}</span>
                <span className="max-w-[28rem] truncate">{question}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {isResearching && (
        <div className="flex items-center gap-2 border-y border-border/50 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin text-primary" />
          {stageLabel[latestStage ?? ''] ?? 'Starting research pipeline'}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="space-y-1.5">
          {warnings.slice(-3).map((warning, index) => {
            const data = warning.data as { stage?: string; message?: string }
            return (
              <p key={`${warning.timestamp}-${index}`} className="text-xs text-[oklch(0.68_0.13_75)]">
                <span className="font-mono uppercase">{data.stage ?? 'pipeline'}:</span>{' '}
                {data.message ?? 'A degraded branch was skipped.'}
              </p>
            )
          })}
        </div>
      )}

      {error && !researchReport && <p className="text-sm text-destructive">{error}</p>}

      {showThinking && (researchThinking || isThinking) && (
        <ThinkingVisualizer thinking={researchThinking} isThinking={isThinking} />
      )}

      {!researchReport && isResearching && !researchThinking && (
        <div className="space-y-3 py-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      )}

      {researchReport && (
        <article
          className="prose prose-sm max-w-none overflow-visible dark:prose-invert"
          onClick={handleCitationClick}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              const target = (event.target as HTMLElement).closest('[data-citation]')
              if (target) {
                event.preventDefault()
                ;(target as HTMLElement).click()
              }
            }
          }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath, remarkCitations]}
            rehypePlugins={[rehypeKatex]}
            components={markdownComponents}
          >
            {researchReport}
          </ReactMarkdown>
          {isResearching && (
            <span className="inline-block align-middle text-primary" style={{ animation: 'blink 1s step-end infinite' }} aria-hidden>
              ▊
            </span>
          )}
        </article>
      )}

      {researchReport && !isResearching && (
        <>
          <KeyTakeaways />
          <AnswerRefinements mode="research" />
        </>
      )}
    </div>
  )
}
