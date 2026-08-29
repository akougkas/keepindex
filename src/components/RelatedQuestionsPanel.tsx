import { Skeleton } from '@/components/ui/skeleton'
import { useAppStore } from '@/stores/app-store'
import { useFocusStore } from '@/stores/focus-store'
import { useJourneyStore } from '@/stores/journey-store'
import { cn } from '@/lib/utils'
import { extendRetrievalContext } from '@/lib/retrieval-context'

export function RelatedQuestionsPanel() {
  const relatedQuestions = useAppStore((s) => s.relatedQuestions)
  const relatedQuestionsLoading = useAppStore((s) => s.relatedQuestionsLoading)
  const streamAnswer = useAppStore((s) => s.streamAnswer)
  const setMode = useAppStore((s) => s.setMode)
  const query = useAppStore((s) => s.query)
  const activeRetrievalQuery = useAppStore((s) => s.activeRetrievalQuery)
  const answer = useAppStore((s) => s.answer)
  const focusOmnibar = useFocusStore((s) => s.focusOmnibar)

  function handleClick(question: string) {
    const handoffContext = answer.trim()
      ? `Follow-up from prior answer.\nOriginal question: ${query}\nPrevious answer: ${answer.slice(0, 1500)}`
      : query.trim()
        ? `Follow-up from prior question: ${query}`
        : ''
    useJourneyStore.getState().addNode({
      mode: 'ai',
      action: 'followup_clicked',
      query: question,
      metadata: { parentQuery: query, hadParentAnswer: !!answer.trim() },
    })
    setMode('ai')
    void streamAnswer(question, {
      handoffContext,
      retrievalQuery: extendRetrievalContext(activeRetrievalQuery || query, question),
    })
    focusOmnibar()
  }

  if (relatedQuestionsLoading) {
    return (
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-8 w-32 rounded-full" />
        ))}
      </div>
    )
  }

  if (relatedQuestions.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      {relatedQuestions.map((q, i) => (
        <button
          key={i}
          type="button"
          onClick={() => handleClick(q)}
          className={cn(
            'rounded-full border border-border/60 px-3 py-1.5 text-xs font-medium',
            'hover:bg-accent hover:border-accent-foreground/20 transition-colors',
            'text-left line-clamp-2 max-w-full'
          )}
        >
          {q}
        </button>
      ))}
    </div>
  )
}
