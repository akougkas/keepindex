import { create } from 'zustand'
import { KEEPINDEX_STORAGE_KEYS } from '@/lib/storage-contract'

function getInitialDark(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const stored = localStorage.getItem(KEEPINDEX_STORAGE_KEYS.theme)
    if (stored === 'light') return false
    if (stored === 'dark') return true
  } catch {
    // Use the safe dark default when browser storage is unavailable.
  }
  return true
}

interface ThemeState {
  isDark: boolean
  toggleTheme: () => void
  init: () => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  // Match the class applied by the inline head script on the first React
  // render; init remains available for environments that hydrate later.
  isDark: getInitialDark(),

  init: () => set({ isDark: getInitialDark() }),

  toggleTheme: () => {
    set((s) => {
      const next = !s.isDark
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(KEEPINDEX_STORAGE_KEYS.theme, next ? 'dark' : 'light')
        } catch {
          // Theme changes still apply for this page when storage is unavailable.
        }
      }
      return { isDark: next }
    })
  },
}))
