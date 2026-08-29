import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  MessageSquare,
  Bookmark,
  Library,
  Sun,
  Trash2,
  Focus,
  Download,
  Settings,
  Workflow,
  HardDriveUpload,
  Minimize2,
  ArrowDownToLine,
  Pin,
  PinOff,
} from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import { useCollectionsStore } from '@/stores/collections-store'
import { useJourneyStore } from '@/stores/journey-store'
import { useKnowledgeStore } from '@/stores/knowledge-store'
import { useThemeStore } from '@/stores/theme-store'
import { buildChatMarkdown, slugifyTopic } from '@/lib/chat-export'
import { executeRefinement, canExecuteRefinement } from '@/lib/answer-refinements'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type CommandAction =
  | { type: 'newChat' }
  | { type: 'saveToCollection' }
  | { type: 'openCollections' }
  | { type: 'openSettings' }
  | { type: 'toggleTheme' }
  | { type: 'clearResults' }
  | { type: 'focusSearch' }
  | { type: 'exportMarkdown' }
  | { type: 'exportChat' }
  | { type: 'exportJourney' }
  | { type: 'saveJourneyToVault' }
  | { type: 'refineAnswer'; refinement: 'simplify' | 'deeper' }
  | { type: 'togglePin' }

interface Command {
  id: string
  label: string
  icon: React.ReactNode
  shortcut?: string
  action: CommandAction
}

const COMMANDS: Command[] = [
  {
    id: 'new-chat',
    label: 'New chat',
    icon: <MessageSquare className="size-4" />,
    action: { type: 'newChat' },
  },
  {
    id: 'save',
    label: 'Save to collection',
    icon: <Bookmark className="size-4" />,
    shortcut: '⌘S',
    action: { type: 'saveToCollection' },
  },
  {
    id: 'collections',
    label: 'Open collections',
    icon: <Library className="size-4" />,
    shortcut: '⌘B',
    action: { type: 'openCollections' },
  },
  {
    id: 'settings',
    label: 'Open settings',
    icon: <Settings className="size-4" />,
    action: { type: 'openSettings' },
  },
  {
    id: 'theme',
    label: 'Toggle dark mode',
    icon: <Sun className="size-4" />,
    action: { type: 'toggleTheme' },
  },
  {
    id: 'clear',
    label: 'Clear current results',
    icon: <Trash2 className="size-4" />,
    action: { type: 'clearResults' },
  },
  {
    id: 'focus',
    label: 'Focus search',
    icon: <Focus className="size-4" />,
    shortcut: '/',
    action: { type: 'focusSearch' },
  },
  {
    id: 'export',
    label: 'Export answer as Markdown',
    icon: <Download className="size-4" />,
    action: { type: 'exportMarkdown' },
  },
  {
    id: 'export-chat',
    label: 'Export chat as Markdown',
    icon: <Download className="size-4" />,
    action: { type: 'exportChat' },
  },
  {
    id: 'export-journey',
    label: 'Export journey graph as Markdown',
    icon: <Workflow className="size-4" />,
    action: { type: 'exportJourney' },
  },
  {
    id: 'save-journey-vault',
    label: 'Save journey snapshot to indexed vault',
    icon: <HardDriveUpload className="size-4" />,
    action: { type: 'saveJourneyToVault' },
  },
  {
    id: 'refine-simplify',
    label: 'Simplify current answer',
    icon: <Minimize2 className="size-4" />,
    shortcut: '⌥S',
    action: { type: 'refineAnswer', refinement: 'simplify' },
  },
  {
    id: 'refine-deeper',
    label: 'Go deeper on current answer',
    icon: <ArrowDownToLine className="size-4" />,
    shortcut: '⌥D',
    action: { type: 'refineAnswer', refinement: 'deeper' },
  },
  {
    id: 'toggle-pin',
    label: 'Pin current answer',
    icon: <Pin className="size-4" />,
    shortcut: '⌥P',
    action: { type: 'togglePin' },
  },
]

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  omnibarRef: React.RefObject<HTMLInputElement | null>
  onOpenSettings?: () => void
}

export function CommandPalette({
  isOpen,
  onClose,
  omnibarRef,
  onOpenSettings,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)

  const setMode = useAppStore((s) => s.setMode)
  const setCollectionsOpen = useAppStore((s) => s.setCollectionsOpen)
  const clearChat = useAppStore((s) => s.clearChat)
  const pinnedResult = useAppStore((s) => s.pinnedResult)
  const resetResults = useAppStore((s) => s.resetResults)
  const saveCurrentAnswer = useCollectionsStore((s) => s.saveCurrentAnswer)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)

  const previousFocusRef = useRef<HTMLElement | null>(null)

  const runAction = useCallback(
    async (action: CommandAction) => {
      switch (action.type) {
        case 'newChat':
          clearChat()
          setMode('chat')
          break
        case 'saveToCollection':
          saveCurrentAnswer()
          break
        case 'openCollections':
          setCollectionsOpen(true)
          break
        case 'openSettings':
          onOpenSettings?.()
          break
        case 'toggleTheme':
          toggleTheme()
          break
        case 'clearResults':
          resetResults()
          break
        case 'focusSearch':
          omnibarRef.current?.focus()
          break
        case 'exportMarkdown': {
          const state = useAppStore.getState()
          const appQuery = state.query || 'untitled'
          const mode = state.mode
          const answerText =
            mode === 'research'
              ? state.researchReport
              : mode === 'search'
                ? `Search snapshot with ${state.searchResults.length} results.`
                : state.answer
          const webSources = mode === 'research' ? state.researchSources.web : mode === 'search' ? state.searchResults : state.sources
          const local = mode === 'research' ? state.researchSources.local : state.localSources
          if (!answerText && webSources.length === 0 && local.length === 0) break
          const webSection = webSources.length
            ? `\n\n## Web Sources\n${webSources.map((s, i) => `${i + 1}. [${s.title || s.url}](${s.url})`).join('\n')}`
            : ''
          const localSection = local.length
            ? `\n\n## Local Sources\n${local.map((s, i) => `${i + 1}. ${s.fileName} (${s.filePath})`).join('\n')}`
            : ''
          const markdown = `# ${appQuery}\n\n${answerText}${webSection}${localSection}`
          const blob = new Blob([markdown], { type: 'text/markdown' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `keepindex-${appQuery.slice(0, 30).replace(/\s+/g, '-')}.md`
          a.click()
          URL.revokeObjectURL(url)
          break
        }
        case 'exportChat': {
          const { chatMessages } = useAppStore.getState()
          if (!chatMessages.length) break
          const { markdown, topic } = buildChatMarkdown(chatMessages)
          const blob = new Blob([markdown], { type: 'text/markdown' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `keepindex-chat-${slugifyTopic(topic) || 'conversation'}.md`
          a.click()
          URL.revokeObjectURL(url)
          break
        }
        case 'exportJourney': {
          const markdown = useJourneyStore.getState().exportMarkdown()
          const blob = new Blob([markdown], { type: 'text/markdown' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `keepindex-journey-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.md`
          a.click()
          URL.revokeObjectURL(url)
          break
        }
        case 'refineAnswer': {
          const mode = useAppStore.getState().mode
          const canRefine =
            (mode === 'ai' && canExecuteRefinement('ai')) ||
            (mode === 'research' && canExecuteRefinement('research'))
          if (canRefine) {
            executeRefinement(
              action.refinement,
              mode === 'research' ? 'research' : 'ai'
            )
          }
          break
        }
        case 'togglePin': {
          const { mode, answer, researchReport, pinCurrentResult, clearPinnedResult } =
            useAppStore.getState()
          const hasContent =
            (mode === 'ai' && answer?.trim()) || (mode === 'research' && researchReport?.trim())
          if (pinnedResult) {
            clearPinnedResult()
          } else if (hasContent && (mode === 'ai' || mode === 'research')) {
            pinCurrentResult()
          }
          break
        }
        case 'saveJourneyToVault': {
          let vaultPath = useKnowledgeStore.getState().knowledgeStatus?.path
          if (!vaultPath) {
            await useKnowledgeStore.getState().fetchKnowledgeStatus()
            vaultPath =
              useKnowledgeStore.getState().knowledgeStatus?.path ??
              useKnowledgeStore.getState().knowledgePath
          }
          if (!vaultPath) {
            useAppStore.setState({
              error: 'Invalid vault path. Index your vault in Knowledge Base first, then retry snapshot.',
            })
            break
          }
          const markdown = useJourneyStore.getState().exportMarkdown()
          const json = useJourneyStore.getState().exportJson()
          try {
            const res = await fetch('/api/journey/snapshot', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: vaultPath, markdown, json }),
            })
            if (!res.ok) {
              const data = (await res.json()) as { error?: string }
              useAppStore.setState({
                error: data.error ?? 'Snapshot write failed. Could not write journey snapshot to vault.',
              })
              break
            }
            useAppStore.setState({
              error: null,
            })
          } catch {
            useAppStore.setState({
              error: 'Snapshot write failed. Check the server and vault path, then retry.',
            })
          }
          break
        }
      }
      onClose()
    },
    [
      setMode,
      clearChat,
      saveCurrentAnswer,
      setCollectionsOpen,
      onOpenSettings,
      toggleTheme,
      resetResults,
      omnibarRef,
      onClose,
      pinnedResult,
    ]
  )

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement | null
      setQuery('')
      setSelected(0)
    } else {
      previousFocusRef.current?.focus()
    }
  }, [isOpen])

  useEffect(() => {
    setSelected(0)
  }, [query])

  const themeLabel = useThemeStore((s) =>
    s.isDark ? 'Switch to light mode' : 'Switch to dark mode'
  )
  const commandsWithTheme = useMemo(
    () =>
      COMMANDS.map((c) => {
        if (c.id === 'theme') return { ...c, label: themeLabel }
        if (c.id === 'toggle-pin')
          return {
            ...c,
            label: pinnedResult ? 'Unpin pinned result' : 'Pin current answer',
            icon: pinnedResult ? <PinOff className="size-4" /> : <Pin className="size-4" />,
          }
        return c
      }),
    [themeLabel, pinnedResult]
  )

  const filteredWithTheme = useMemo(
    () =>
      commandsWithTheme.filter((c) =>
        c.label.toLowerCase().includes(query.toLowerCase())
      ),
    [commandsWithTheme, query]
  )

  useLayoutEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelected((s) => Math.min(s + 1, filteredWithTheme.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelected((s) => Math.max(s - 1, 0))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const cmd = filteredWithTheme[selected]
        if (cmd) runAction(cmd.action)
        return
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, filteredWithTheme, selected, runAction])

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60]"
            aria-hidden
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="fixed left-1/2 top-[20%] -translate-x-1/2 w-[calc(100%-2rem)] max-w-lg bg-card rounded-xl shadow-2xl border border-border/50 z-[61] overflow-hidden mx-4"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
          >
            <div className="flex items-center gap-2 p-3 border-b border-border/50">
              <Search className="size-4 text-muted-foreground shrink-0" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a command..."
                className="border-0 shadow-none focus-visible:ring-0 h-9"
                autoFocus
              />
            </div>
            <div className="max-h-72 overflow-auto py-2">
              {filteredWithTheme.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground text-center">
                  No matching commands
                </p>
              ) : (
                filteredWithTheme.map((cmd, i) => (
                  <button
                    key={cmd.id}
                    type="button"
                    onClick={() => runAction(cmd.action)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors',
                      i === selected
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-accent/50'
                    )}
                  >
                    {cmd.icon}
                    <span className="flex-1">{cmd.label}</span>
                    {cmd.shortcut && (
                      <span className="text-xs text-muted-foreground">
                        {cmd.shortcut}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
