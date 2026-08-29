import { useCallback, useLayoutEffect } from 'react'
import { useAppStore } from '@/stores/app-store'
import { useCollectionsStore } from '@/stores/collections-store'
import { executeRefinement, canExecuteRefinement } from '@/lib/answer-refinements'

function isInputFocused(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  const role = el.getAttribute('role')
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    el.isContentEditable ||
    role === 'searchbox' ||
    role === 'combobox' ||
    role === 'textbox'
  )
}

export function useKeyboardShortcuts(
  omnibarRef: React.RefObject<HTMLInputElement | null>,
  onOpenCommandPalette: () => void
) {
  const setCollectionsOpen = useAppStore((s) => s.setCollectionsOpen)
  const collectionsOpen = useAppStore((s) => s.collectionsOpen)
  const saveCurrentAnswer = useCollectionsStore((s) => s.saveCurrentAnswer)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isInputFocused()) {
        if (e.key === 'Escape') {
          ;(document.activeElement as HTMLElement)?.blur()
          return
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault()
          saveCurrentAnswer()
          return
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
          e.preventDefault()
          onOpenCommandPalette()
          return
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
          e.preventDefault()
          setCollectionsOpen(!collectionsOpen)
          return
        }
        return
      }

      switch (e.key) {
        case '/':
          e.preventDefault()
          omnibarRef.current?.focus()
          break
        case 'Escape':
          omnibarRef.current?.blur()
          setCollectionsOpen(false)
          break
        case 's':
          if (!e.altKey) break
          if (
            (useAppStore.getState().mode === 'ai' && canExecuteRefinement('ai')) ||
            (useAppStore.getState().mode === 'research' && canExecuteRefinement('research'))
          ) {
            e.preventDefault()
            executeRefinement(
              'simplify',
              useAppStore.getState().mode === 'research' ? 'research' : 'ai'
            )
          }
          break
        case 'd':
          if (!e.altKey) break
          if (
            (useAppStore.getState().mode === 'ai' && canExecuteRefinement('ai')) ||
            (useAppStore.getState().mode === 'research' && canExecuteRefinement('research'))
          ) {
            e.preventDefault()
            executeRefinement(
              'deeper',
              useAppStore.getState().mode === 'research' ? 'research' : 'ai'
            )
          }
          break
        case 'p': {
          if (!e.altKey) break
          const { mode, answer, researchReport, pinnedResult, pinCurrentResult, clearPinnedResult } =
            useAppStore.getState()
          const hasContent =
            (mode === 'ai' && answer?.trim()) || (mode === 'research' && researchReport?.trim())
          if (pinnedResult) {
            e.preventDefault()
            clearPinnedResult()
          } else if (hasContent && (mode === 'ai' || mode === 'research')) {
            e.preventDefault()
            pinCurrentResult()
          }
          break
        }
        default:
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault()
            saveCurrentAnswer()
          } else if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault()
            onOpenCommandPalette()
          } else if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
            e.preventDefault()
            setCollectionsOpen(!collectionsOpen)
          }
      }
    },
    [
      omnibarRef,
      onOpenCommandPalette,
      setCollectionsOpen,
      collectionsOpen,
      saveCurrentAnswer,
    ]
  )

  // Shortcuts become active in the same commit that makes the workspace
  // visible, avoiding a brief first-paint window where the browser can consume
  // Ctrl/Command shortcuts before KeepIndex has installed its handler.
  useLayoutEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
