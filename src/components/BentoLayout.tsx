import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Calculator,
  Compass,
  Database,
  Globe2,
  MessageCircle,
  Search,
  Sparkles,
} from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import { AnswerPanel, AnswerHeaderActions, AnswerMetadataBar } from '@/components/AnswerPanel'
import {
  ResearchReport,
  ResearchReportHeaderActions,
  ResearchReportMetadataBar,
} from '@/components/ResearchReport'
import { ResearchTimeline } from '@/components/ResearchTimeline'
import { SourcesPanel } from '@/components/SourcesPanel'
import { SearchResultsPanel } from '@/components/SearchResultsPanel'
import { ChatPanel } from '@/components/ChatPanel'
import { ChatContextPanel } from '@/components/ChatContextPanel'
import { RelatedQuestionsPanel } from '@/components/RelatedQuestionsPanel'
import { FocusSelector } from '@/components/FocusSelector'
import { ErrorBanner } from '@/components/ErrorBanner'
import { PinnedPanel } from '@/components/PinnedPanel'
import { tryEvaluateMathExpression } from '@/lib/classify-intent'
import { extendRetrievalContext } from '@/lib/retrieval-context'
import { cn } from '@/lib/utils'

export function BentoLayout() {
  const mode = useAppStore((state) => state.mode)
  const query = useAppStore((state) => state.query)
  const sources = useAppStore((state) => state.sources)
  const localSources = useAppStore((state) => state.localSources)
  const researchSources = useAppStore((state) => state.researchSources)
  const searchResults = useAppStore((state) => state.searchResults)
  const pinnedResult = useAppStore((state) => state.pinnedResult)
  const clearPinnedResult = useAppStore((state) => state.clearPinnedResult)
  const isLoading = useAppStore((state) => state.isLoading)
  const isResearching = useAppStore((state) => state.isResearching)
  const isChatStreaming = useAppStore((state) => state.isChatStreaming)

  const sourceCount = mode === 'research'
    ? researchSources.web.length + researchSources.local.length
    : mode === 'search'
      ? searchResults.length
      : sources.length + localSources.length
  const mathResult = tryEvaluateMathExpression(query)
  const modeMeta = {
    ai: { label: 'Grounded answer', icon: Sparkles, detail: `${sourceCount} cited sources` },
    research: { label: 'Deep research', icon: Compass, detail: `${sourceCount} sources mapped` },
    search: { label: 'Direct results', icon: Search, detail: `${sourceCount} results fused` },
    chat: { label: 'Follow-up thread', icon: MessageCircle, detail: 'Local conversation' },
  }[mode]
  const ModeIcon = modeMeta.icon
  const isBusy = isLoading || isResearching || isChatStreaming

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-6 lg:px-8 lg:py-12"
    >
      <ErrorBanner />

      <header className="result-mast mb-8 border-b border-border/70 pb-7">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
            <ModeIcon className={cn('size-3.5', isBusy && 'animate-pulse')} />
            {modeMeta.label}
          </span>
          <span className="h-3 w-px bg-border" aria-hidden />
          <span className="font-mono text-[10px] uppercase tracking-[0.13em] text-muted-foreground">{modeMeta.detail}</span>
          {isBusy && <span className="stream-status ml-auto"><span /> live</span>}
        </div>
        <h2 className="result-query max-w-5xl text-balance text-3xl font-semibold leading-tight tracking-[-0.035em] sm:text-4xl lg:text-5xl">
          {query}
        </h2>
      </header>

      {mathResult && (
        <section className="instant-answer mb-8 flex items-center gap-4 rounded-2xl border border-primary/25 bg-primary/[0.055] p-4 sm:p-5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Calculator className="size-4" /></span>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Instant result</p>
            <p className="mt-0.5 font-mono text-2xl font-semibold">{mathResult.result}</p>
          </div>
        </section>
      )}

      {mode === 'ai' && <AnswerStream />}
      {mode === 'research' && <ResearchStream />}
      {mode === 'search' && <SearchStream />}
      {mode === 'chat' && <ChatStream />}

      {pinnedResult && pinnedResult.query !== query && (
        <section className="mt-10 border-t border-border/70 pt-8">
          <p className="section-kicker mb-3">Pinned context</p>
          <div className="max-h-80 overflow-auto rounded-2xl border border-border/65">
            <PinnedPanel pinned={pinnedResult} onUnpin={clearPinnedResult} className="border-0" />
          </div>
        </section>
      )}

      <FollowUpDock />
    </motion.div>
  )
}

function AnswerStream() {
  const relatedQuestions = useAppStore((state) => state.relatedQuestions)
  const relatedQuestionsLoading = useAppStore((state) => state.relatedQuestionsLoading)
  const hasRelated = relatedQuestions.length > 0 || relatedQuestionsLoading

  return (
    <div className="workspace-grid">
      <main className="min-w-0">
        <SectionHeading label="Synthesized answer" actions={<AnswerHeaderActions />} />
        <div className="mb-6"><AnswerMetadataBar /></div>
        <AnswerPanel />
        {hasRelated && (
          <section className="mt-10 border-t border-border/60 pt-6">
            <p className="section-kicker mb-3">Continue exploring</p>
            <RelatedQuestionsPanel />
          </section>
        )}
      </main>
      <SourceRail />
    </div>
  )
}

function ResearchStream() {
  const initialAnswer = useAppStore((state) => state.answer)

  return (
    <div className="workspace-grid workspace-grid-research">
      <main className="min-w-0">
        <SectionHeading label="Research report" actions={<ResearchReportHeaderActions />} />
        <div className="mb-6"><ResearchReportMetadataBar /></div>
        {initialAnswer && (
          <details className="mb-6 rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
            <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Initial answer retained as research context
            </summary>
            <p className="mt-3 line-clamp-5 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{initialAnswer}</p>
          </details>
        )}
        <ResearchReport />
      </main>
      <aside className="source-rail space-y-8">
        <section>
          <p className="section-kicker mb-4">Live pipeline</p>
          <ResearchTimeline />
        </section>
        <section className="border-t border-border/60 pt-7" data-panel="sources">
          <div className="mb-4 flex items-center justify-between">
            <p className="section-kicker">Evidence</p>
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">web + private</span>
          </div>
          <SourcesPanel />
        </section>
      </aside>
    </div>
  )
}

function SearchStream() {
  const query = useAppStore((state) => state.query)
  const searchTarget = useAppStore((state) => state.searchTarget)
  const setMode = useAppStore((state) => state.setMode)
  const streamAnswer = useAppStore((state) => state.streamAnswer)

  return (
    <div className="workspace-grid">
      <main className="min-w-0">
        <SectionHeading label="Federated source index" />
        <SearchResultsPanel />
      </main>
      <aside className="source-rail space-y-7">
        {(searchTarget === 'all' || searchTarget === 'web') ? (
          <section>
            <p className="section-kicker mb-3">Narrow the web lens</p>
            <FocusSelector />
          </section>
        ) : (
          <section className="rounded-xl border border-border/60 bg-card/45 p-3.5">
            <p className="section-kicker mb-2">Private scope</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Results are limited to {searchTarget === 'vault' ? 'indexed Obsidian notes' : searchTarget === 'documents' ? 'parsed documents and PDFs' : searchTarget === 'history' ? 'the private browser-history index' : 'indexed files and folders'} on this machine.
            </p>
          </section>
        )}
        <section className="border-t border-border/60 pt-6">
          <p className="mb-3 text-sm leading-relaxed text-muted-foreground">Turn these fused results into one grounded answer with inline citations.</p>
          <button
            type="button"
            onClick={() => { setMode('ai'); void streamAnswer(query) }}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"
          >
            Synthesize results <ArrowRight className="size-3.5" />
          </button>
        </section>
      </aside>
    </div>
  )
}

function ChatStream() {
  return (
    <div className="workspace-grid">
      <main className="min-h-[28rem] min-w-0">
        <SectionHeading label="Conversation" />
        <ChatPanel />
      </main>
      <aside className="source-rail">
        <p className="section-kicker mb-4">Threads</p>
        <ChatContextPanel />
      </aside>
    </div>
  )
}

function SourceRail() {
  const sources = useAppStore((state) => state.sources)
  const localSources = useAppStore((state) => state.localSources)

  return (
    <aside className="source-rail" data-panel="sources">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="section-kicker">Source index</p>
        <div className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Globe2 className="size-3" />{sources.length}</span>
          <span className="inline-flex items-center gap-1"><Database className="size-3" />{localSources.length}</span>
        </div>
      </div>
      <SourcesPanel />
    </aside>
  )
}

function SectionHeading({ label, actions }: { label: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-center justify-between gap-4 border-b border-border/60 pb-3">
      <p className="section-kicker">{label}</p>
      {actions}
    </div>
  )
}

function FollowUpDock() {
  const [value, setValue] = useState('')
  const mode = useAppStore((state) => state.mode)
  const query = useAppStore((state) => state.query)
  const activeRetrievalQuery = useAppStore((state) => state.activeRetrievalQuery)
  const answer = useAppStore((state) => state.answer)
  const researchReport = useAppStore((state) => state.researchReport)
  const searchResults = useAppStore((state) => state.searchResults)
  const isChatStreaming = useAppStore((state) => state.isChatStreaming)
  const isResearching = useAppStore((state) => state.isResearching)
  const setMode = useAppStore((state) => state.setMode)
  const sendChatMessage = useAppStore((state) => state.sendChatMessage)
  const streamAnswer = useAppStore((state) => state.streamAnswer)
  const startResearch = useAppStore((state) => state.startResearch)

  const submitFollowUp = () => {
    const followUp = value.trim()
    if (!followUp) return
    setValue('')

    if (mode === 'chat') {
      void sendChatMessage(followUp)
      return
    }
    if (mode === 'search') {
      const context = searchResults.slice(0, 8).map((source) => `${source.title}: ${source.snippet}`).join('\n')
      setMode('ai')
      void streamAnswer(followUp, {
        handoffContext: `Follow-up to web search: ${query}\n${context}`,
        retrievalQuery: extendRetrievalContext(activeRetrievalQuery || query, followUp),
      })
      return
    }

    const contextAnswer = mode === 'research' ? researchReport : answer
    const priorKind = mode === 'research' ? 'research report' : 'answer'
    setMode('ai')
    void streamAnswer(followUp, {
      handoffContext: contextAnswer.trim()
        ? `Follow-up from prior ${priorKind}.\nOriginal question: ${query}\nPrevious ${priorKind}: ${contextAnswer.slice(0, 2800)}`
        : `Follow-up from prior question: ${query}`,
      retrievalQuery: extendRetrievalContext(activeRetrievalQuery || query, followUp),
    })
  }

  const deepen = () => {
    if (!query || isResearching) return
    const context = mode === 'research' ? researchReport : answer
    setMode('research')
    void startResearch(query, {
      handoffContext: context ? `Deepen this prior answer without repeating it:\n${context.slice(0, 2800)}` : undefined,
      retrievalQuery: activeRetrievalQuery || query,
    })
  }

  return (
    <div className="follow-up-dock sticky bottom-4 z-20 mx-auto mt-12 max-w-4xl rounded-2xl border border-border/75 bg-card/90 p-2 shadow-[0_18px_70px_-28px_oklch(0.1_0.03_250/0.65)] backdrop-blur-2xl">
      <div className="flex items-center gap-2">
        <MessageCircle className="ml-2 size-4 shrink-0 text-primary" />
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submitFollowUp()
            }
          }}
          placeholder={mode === 'chat' ? 'Continue the thread...' : 'Ask a follow-up...'}
          className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          disabled={isChatStreaming}
        />
        {(mode === 'ai' || mode === 'search') && (
          <button type="button" onClick={deepen} disabled={isResearching} className="hidden items-center gap-1.5 rounded-full border border-border/70 px-3 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50 sm:inline-flex">
            <Compass className="size-3.5" /> Deepen research
          </button>
        )}
        <button
          type="button"
          onClick={submitFollowUp}
          disabled={!value.trim() || isChatStreaming}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-35"
          aria-label="Send follow-up"
        >
          <ArrowRight className="size-4" />
        </button>
      </div>
    </div>
  )
}
