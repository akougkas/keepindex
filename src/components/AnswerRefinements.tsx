import { useAppStore } from '@/stores/app-store'
import { REFINEMENT_DEFS, executeRefinement, type RefinementType } from '@/lib/answer-refinements'
import { cn } from '@/lib/utils'

interface AnswerRefinementsProps {
  mode: 'ai' | 'research'
}

export function AnswerRefinements({ mode }: AnswerRefinementsProps) {
  const answer = useAppStore((s) => (mode === 'ai' ? s.answer : s.researchReport))
  const isLoading = useAppStore((s) =>
    mode === 'ai' ? s.isLoading : s.isResearching
  )

  const visible =
    !isLoading && !!answer && answer.length > 100

  if (!visible) return null

  return (
    <div className="flex flex-wrap gap-2">
      {REFINEMENT_DEFS.map((def) => {
        const Icon = def.icon
        return (
          <button
            key={def.key}
            type="button"
            onClick={() => executeRefinement(def.key as RefinementType, mode)}
            title={def.promptSuffix}
            className={cn(
              'rounded-full border border-border/60 px-3 py-1.5 text-xs font-medium',
              'hover:bg-accent hover:border-accent-foreground/20 transition-colors',
              'flex items-center gap-1.5'
            )}
          >
            <Icon className="size-3.5 shrink-0" />
            {def.label}
          </button>
        )
      })}
    </div>
  )
}
