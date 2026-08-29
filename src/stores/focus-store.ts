import { create } from 'zustand'

interface FocusState {
  omnibarRef: React.RefObject<HTMLInputElement | null> | null
  setOmnibarRef: (ref: React.RefObject<HTMLInputElement | null> | null) => void
  focusOmnibar: () => void
}

export const useFocusStore = create<FocusState>((set, get) => ({
  omnibarRef: null,
  setOmnibarRef: (omnibarRef) => set({ omnibarRef }),
  focusOmnibar: () => get().omnibarRef?.current?.focus(),
}))
