import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Brain, Search, BookOpenText, BarChart3, Pencil, Check, Loader2, TriangleAlert } from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import { cn } from '@/lib/utils'

export function ResearchTimeline() {
  const researchPlan = useAppStore((s) => s.researchPlan)
  const researchSteps = useAppStore((s) => s.researchSteps)
  const researchReport = useAppStore((s) => s.researchReport)
  const isResearching = useAppStore((s) => s.isResearching)
  const containerRef = useRef<HTMLDivElement>(null)

  const hasPlan = researchSteps.some((s) => s.type === 'plan')
  const isIdle = !isResearching && researchSteps.length === 0
  const hasSearching = researchSteps.some((s) => s.type === 'searching')
  const searchCount = researchSteps.filter((s) => s.type === 'searching').length
  const searchDoneCount = researchSteps.filter((s) => s.type === 'search_results').length
  const readingCount = researchSteps.filter((s) => s.type === 'reading').length
  const hasAnalyzing = researchSteps.some((s) => s.type === 'analyzing')
  const hasAnalysis = researchSteps.some((s) => s.type === 'analysis')
  const warnings = researchSteps.filter((s) => s.type === 'warning')
  const hasSynthesis = researchReport.length > 0 || researchSteps.some((s) => s.type === 'synthesizing')
  const isDone = !isResearching && researchSteps.length > 0

  useEffect(() => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' })
  }, [researchSteps])

  if (isIdle) {
    return (
      <p className="text-muted-foreground text-sm">
        Submit a query to start deep research.
      </p>
    )
  }

  return (
    <div ref={containerRef} className="overflow-y-auto space-y-4 pr-2">
      <TimelineStep
        icon={Brain}
        label="Planning research..."
        done={hasPlan}
        active={!hasPlan && isResearching}
      >
        {hasPlan && researchPlan.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {researchPlan.map((question, index) => (
              <span key={`${question}-${index}`} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 px-2 py-1 text-[11px] text-muted-foreground">
                <span className="font-mono text-primary">{index + 1}</span>
                <span className="truncate">{question}</span>
              </span>
            ))}
          </div>
        )}
      </TimelineStep>

      <TimelineStep
        icon={Search}
        label={`Searching (${searchDoneCount}/${searchCount || researchPlan.length || 1})...`}
        done={searchCount > 0 && searchDoneCount >= searchCount}
        active={hasPlan && hasSearching && searchDoneCount < searchCount}
      >
        {researchSteps
          .filter((s) => s.type === 'searching')
          .map((s, i) => (
            <div key={i} className="mt-1 flex items-center gap-2 text-sm">
              {researchSteps.filter((x) => x.type === 'search_results').length > i ? (
                <Check className="size-3 text-green-500 shrink-0" />
              ) : (
                <Loader2 className="size-3 animate-spin text-primary shrink-0" />
              )}
              <span className="text-muted-foreground truncate">
                {(s.data as { question?: string })?.question ?? '...'}
              </span>
            </div>
          ))}
      </TimelineStep>

      <TimelineStep
        icon={BookOpenText}
        label={`Reading sources (${readingCount}/${searchCount || researchPlan.length || 1})...`}
        done={readingCount > 0 && readingCount >= searchCount}
        active={hasSearching && readingCount < searchCount && isResearching}
      />

      <TimelineStep
        icon={BarChart3}
        label="Analyzing results..."
        done={hasAnalysis}
        active={hasAnalyzing && !hasAnalysis && isResearching}
      >
        {hasAnalysis && (
          <p className="mt-2 text-sm text-muted-foreground line-clamp-3">
            {(researchSteps.find((s) => s.type === 'analysis')?.data as { summary?: string })?.summary ?? 'Analysis complete.'}
          </p>
        )}
      </TimelineStep>

      <TimelineStep
        icon={Pencil}
        label="Writing report..."
        done={isDone}
        active={hasAnalysis && isResearching && !isDone}
      >
        {hasSynthesis && (
          <p className="mt-2 text-sm text-muted-foreground">
            {researchReport.length > 0 ? `${researchReport.split(/\s+/).length} words streamed` : 'Citation map ready; waiting for first token...'}
          </p>
        )}
      </TimelineStep>

      {warnings.length > 0 && (
        <div className="rounded-lg border border-[oklch(0.68_0.13_75/0.35)] bg-[oklch(0.68_0.13_75/0.08)] p-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-[oklch(0.68_0.13_75)]">
            <TriangleAlert className="size-3.5" />
            {warnings.length} degraded branch{warnings.length === 1 ? '' : 'es'} recovered
          </p>
        </div>
      )}
    </div>
  )
}

function TimelineStep({
  icon: Icon,
  label,
  done,
  active,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  done: boolean
  active: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'size-8 rounded-full flex items-center justify-center shrink-0',
            done && 'bg-green-500/20 text-green-600 dark:text-green-400',
            active && 'bg-primary/20 text-primary',
            !done && !active && 'bg-muted text-muted-foreground'
          )}
        >
          {done ? (
            <Check className="size-4" />
          ) : active ? (
            <motion.div
              animate={{ scale: [1, 1.2, 1], opacity: [1, 0.7, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              <Icon className="size-4" />
            </motion.div>
          ) : (
            <Icon className="size-4" />
          )}
        </div>
        {!done && <div className="w-px flex-1 min-h-4 bg-border mt-1" />}
      </div>
      <div className="flex-1 min-w-0 pb-4">
        <p className={cn(
          'text-sm font-medium',
          done && 'text-muted-foreground',
          active && 'text-foreground'
        )}>
          {label}
        </p>
        {children}
      </div>
    </div>
  )
}
