import type { LucideIcon } from 'lucide-react'
import {
  Minimize2,
  ArrowDownToLine,
  Baby,
  Scale,
  ListChecks,
} from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import { useJourneyStore } from '@/stores/journey-store'
import { useFocusStore } from '@/stores/focus-store'

export type RefinementType =
  | 'simplify'
  | 'deeper'
  | 'eli5'
  | 'counterarguments'
  | 'proscons'

export interface RefinementDef {
  key: RefinementType
  label: string
  icon: LucideIcon
  promptSuffix: string
  useResearchForDeeper?: boolean
}

export const REFINEMENT_DEFS: RefinementDef[] = [
  {
    key: 'simplify',
    label: 'Simplify',
    icon: Minimize2,
    promptSuffix: 'Simplify this explanation for a general audience',
  },
  {
    key: 'deeper',
    label: 'Go Deeper',
    icon: ArrowDownToLine,
    promptSuffix: 'Expand with more technical detail and nuance',
    useResearchForDeeper: true,
  },
  {
    key: 'eli5',
    label: 'ELI5',
    icon: Baby,
    promptSuffix: "Explain like I'm 5 years old, use analogies",
  },
  {
    key: 'counterarguments',
    label: 'Counterarguments',
    icon: Scale,
    promptSuffix: 'Present the strongest counterarguments and opposing views',
  },
  {
    key: 'proscons',
    label: 'Pros & Cons',
    icon: ListChecks,
    promptSuffix: 'List the key pros and cons in a structured comparison',
  },
]

function buildHandoffContext(query: string, answer: string): string {
  return `Original question: ${query}\n\nOriginal answer (reference for refinement):\n${answer.slice(0, 2000)}`
}

export function buildRefinementRequest(
  originalQuery: string,
  def: RefinementDef
): { displayQuery: string; retrievalQuery: string } {
  const displaySubject = originalQuery.trim()
  let retrievalQuery = displaySubject
  while (retrievalQuery) {
    const priorRefinement = REFINEMENT_DEFS.find(({ label }) =>
      retrievalQuery.toLowerCase().startsWith(`${label.toLowerCase()}:`)
    )
    if (!priorRefinement) break
    retrievalQuery = retrievalQuery.slice(priorRefinement.label.length + 1).trim()
  }
  return {
    displayQuery: `${def.label}: ${displaySubject}`,
    retrievalQuery,
  }
}

export function canExecuteRefinement(mode: 'ai' | 'research'): boolean {
  const state = useAppStore.getState()
  if (mode === 'ai') {
    return (
      state.mode === 'ai' &&
      !state.isLoading &&
      !!state.answer &&
      state.answer.length > 100
    )
  }
  return (
    state.mode === 'research' &&
    !state.isResearching &&
    !!state.researchReport &&
    state.researchReport.length > 100
  )
}

export function executeRefinement(
  type: RefinementType,
  mode: 'ai' | 'research'
): void {
  const state = useAppStore.getState()
  const query = state.query
  const answer =
    mode === 'research' ? state.researchReport : state.answer

  if (!query?.trim() || !answer || answer.length <= 100) return
  if (mode === 'ai' && state.isLoading) return
  if (mode === 'research' && state.isResearching) return

  const def = REFINEMENT_DEFS.find((d) => d.key === type)
  if (!def) return

  const handoffContext = buildHandoffContext(query, answer)
  const refinement = buildRefinementRequest(query, def)
  const refinedQuery = refinement.displayQuery

  useJourneyStore.getState().addNode({
    mode,
    action: 'answer_refined',
    query: refinedQuery,
    metadata: {
      refinementType: type,
      originalQuery: query,
    },
  })

  useFocusStore.getState().focusOmnibar()

  if (mode === 'research' && def.useResearchForDeeper) {
    void useAppStore.getState().startResearch(refinedQuery, {
      handoffContext,
      retrievalQuery: state.activeRetrievalQuery || refinement.retrievalQuery,
    })
  } else {
    if (mode === 'research') {
      useAppStore.getState().setMode('ai')
    }
    void useAppStore.getState().streamAnswer(refinedQuery, {
      handoffContext,
      retrievalQuery: state.activeRetrievalQuery || refinement.retrievalQuery,
    })
  }
}
