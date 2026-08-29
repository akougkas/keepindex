import { afterEach, describe, expect, it } from 'bun:test'
import { useAppStore, type QueryContextOptions } from '@/stores/app-store'
import { useJourneyStore } from '@/stores/journey-store'
import {
  REFINEMENT_DEFS,
  buildRefinementRequest,
  executeRefinement,
} from './answer-refinements'

const originalStreamAnswer = useAppStore.getState().streamAnswer
const originalStartResearch = useAppStore.getState().startResearch

afterEach(() => {
  useAppStore.setState({
    streamAnswer: originalStreamAnswer,
    startResearch: originalStartResearch,
    isLoading: false,
    isResearching: false,
    activeRetrievalQuery: '',
  })
  useJourneyStore.setState({ nodes: [], edges: [] })
})

describe('answer refinement retrieval context', () => {
  it('keeps refinement verbs in the display query but out of every retrieval query', () => {
    for (const definition of REFINEMENT_DEFS) {
      const request = buildRefinementRequest(
        '  Rust versus Go memory safety  ',
        definition
      )

      expect(request.displayQuery).toBe(
        `${definition.label}: Rust versus Go memory safety`
      )
      expect(request.retrievalQuery).toBe('Rust versus Go memory safety')
      expect(request.retrievalQuery).not.toContain(`${definition.label}:`)
    }
  })

  it('removes stacked refinement labels from continued retrieval', () => {
    const definition = REFINEMENT_DEFS.find(({ key }) => key === 'proscons')!
    const request = buildRefinementRequest(
      'Counterarguments: ELI5: Rust versus Go memory safety',
      definition
    )

    expect(request.displayQuery).toBe(
      'Pros & Cons: Counterarguments: ELI5: Rust versus Go memory safety'
    )
    expect(request.retrievalQuery).toBe('Rust versus Go memory safety')
  })

  it('passes the original question as retrievalQuery for an answer refinement', () => {
    const calls: Array<{ query: string; options?: QueryContextOptions }> = []
    useAppStore.setState({
      mode: 'ai',
      query: 'Rust versus Go memory safety',
      activeRetrievalQuery: 'Rust versus Go memory safety',
      answer: 'A'.repeat(140),
      isLoading: false,
      streamAnswer: async (query, options) => {
        calls.push({ query, options })
      },
    })

    executeRefinement('counterarguments', 'ai')

    expect(calls).toHaveLength(1)
    expect(calls[0]?.query).toBe(
      'Counterarguments: Rust versus Go memory safety'
    )
    expect(calls[0]?.options?.retrievalQuery).toBe(
      'Rust versus Go memory safety'
    )
  })

  it('passes the original question as retrievalQuery for deeper research', () => {
    const calls: Array<{ query: string; options?: QueryContextOptions }> = []
    useAppStore.setState({
      mode: 'research',
      query: 'SQLite WAL checkpoint strategy',
      activeRetrievalQuery: 'SQLite WAL checkpoint strategy',
      researchReport: 'R'.repeat(140),
      isResearching: false,
      startResearch: async (query, options) => {
        calls.push({ query, options })
      },
    })

    executeRefinement('deeper', 'research')

    expect(calls).toHaveLength(1)
    expect(calls[0]?.query).toBe(
      'Go Deeper: SQLite WAL checkpoint strategy'
    )
    expect(calls[0]?.options?.retrievalQuery).toBe(
      'SQLite WAL checkpoint strategy'
    )
  })
})
