import { useAppStore, type Mode } from '@/stores/app-store'
import { useJourneyStore } from '@/stores/journey-store'

type ModeSwitchSource = 'mode_selector' | 'keyboard' | 'command_palette'

function handoffActionForMode(mode: Mode): 'handoff_to_search' | 'handoff_to_ai' | 'handoff_to_chat' | 'handoff_to_research' {
  if (mode === 'search') return 'handoff_to_search'
  if (mode === 'chat') return 'handoff_to_chat'
  if (mode === 'research') return 'handoff_to_research'
  return 'handoff_to_ai'
}

export function switchModeWithJourney(
  nextMode: Mode,
  via: ModeSwitchSource,
  setMode: (mode: Mode) => void
): void {
  const { query, mode } = useAppStore.getState()
  if (nextMode !== mode && query.trim()) {
    useJourneyStore.getState().addNode({
      mode: nextMode,
      action: handoffActionForMode(nextMode),
      query,
      metadata: { fromMode: mode, via },
    })
  }
  setMode(nextMode)
}
