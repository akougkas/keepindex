import { beforeEach, describe, expect, it } from 'bun:test'
import { switchModeWithJourney } from './mode-switch'
import { useAppStore } from '@/stores/app-store'
import { useJourneyStore } from '@/stores/journey-store'

beforeEach(() => {
  useJourneyStore.setState({ nodes: [], edges: [] })
  useAppStore.setState({
    mode: 'ai',
    query: '',
    error: null,
  })
})

describe('switchModeWithJourney', () => {
  it('records handoff when mode changes with query context', () => {
    useAppStore.setState({ mode: 'ai', query: 'compare rust and go' })
    const calls: string[] = []

    switchModeWithJourney('research', 'keyboard', (mode) => {
      calls.push(mode)
    })

    expect(calls).toEqual(['research'])
    const nodes = useJourneyStore.getState().nodes
    expect(nodes.length).toBe(1)
    expect(nodes[0]?.action).toBe('handoff_to_research')
    expect(nodes[0]?.query).toBe('compare rust and go')
    expect(nodes[0]?.metadata?.fromMode).toBe('ai')
    expect(nodes[0]?.metadata?.via).toBe('keyboard')
  })

  it('does not record handoff without a query', () => {
    useAppStore.setState({ mode: 'ai', query: '' })

    switchModeWithJourney('search', 'command_palette', () => {
      /* noop */
    })

    expect(useJourneyStore.getState().nodes.length).toBe(0)
  })

  it('does not record handoff when mode is unchanged', () => {
    useAppStore.setState({ mode: 'chat', query: 'resume this thread' })
    const calls: string[] = []

    switchModeWithJourney('chat', 'mode_selector', (mode) => {
      calls.push(mode)
    })

    expect(calls).toEqual(['chat'])
    expect(useJourneyStore.getState().nodes.length).toBe(0)
  })
})
