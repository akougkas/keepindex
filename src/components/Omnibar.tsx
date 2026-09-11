import { useSettingsStore } from '@/stores/settings-store'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowUp,
  Bot,
  BrainCircuit,
  Calculator,
  Check,
  Clock3,
  Compass,
  Database,
  Files,
  Globe2,
  Search,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import { useAppStore, type FocusMode, type SearchTarget } from '@/stores/app-store'
import { useKnowledgeStore } from '@/stores/knowledge-store'
import { useSessionStore } from '@/stores/session-store'
import { parseSlashCommand, tryEvaluateMathExpression } from '@/lib/classify-intent'
import { rankHistorySuggestions } from '@/lib/history-suggestions'
import { cn } from '@/lib/utils'

const QUERY_MAX_LENGTH = 1000

const SLASH_COMMANDS = [
  { command: '/ask', alias: '/ai', label: 'Grounded answer', desc: 'Reason across web and vault evidence', icon: Sparkles, mode: 'ai' as const },
  { command: '/search', label: 'Direct source results', desc: 'Skip synthesis and inspect fused sources directly', icon: Search, mode: 'search' as const },
  { command: '/chat', label: 'Conversation', desc: 'Continue a context-aware local conversation', icon: Bot, mode: 'chat' as const },
  { command: '/research', label: 'Deep research', desc: 'Fan out, analyze gaps, and write a cited report', icon: Compass, mode: 'research' as const },
]

const SEARCH_TARGETS: Array<{ value: SearchTarget; label: string; short: string }> = [
  { value: 'all', label: 'All sources', short: 'All' },
  { value: 'web', label: 'Live web', short: 'Web' },
  { value: 'files', label: 'Files & folders', short: 'Files' },
  { value: 'vault', label: 'Obsidian vaults', short: 'Vaults' },
  { value: 'documents', label: 'Documents', short: 'Docs' },
  { value: 'history', label: 'Browser history', short: 'History' },
]

const FOCUS_OPTIONS: Array<{ value: FocusMode; label: string }> = [
  { value: 'all', label: 'All web' },
  { value: 'news', label: 'News' },
  { value: 'academic', label: 'Academic' },
  { value: 'videos', label: 'Video' },
  { value: 'images', label: 'Images' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'x', label: 'X / Twitter' },
  { value: 'social', label: 'Social' },
  { value: 'code', label: 'Code' },
]

interface OmnibarProps {
  compact?: boolean
}

export const Omnibar = forwardRef<HTMLInputElement, OmnibarProps>(function Omnibar(
  { compact = false },
  ref
) {
  const inputRef = useRef<HTMLInputElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement)

  const query = useAppStore((state) => state.query)
  const mode = useAppStore((state) => state.mode)
  const focusMode = useAppStore((state) => state.focusMode)
  const searchTarget = useAppStore((state) => state.searchTarget)
  const aiConnection = useSettingsStore((state) => state.aiConnection)
  const semanticSearch = useAppStore((state) => state.semanticSearch)
  const isLoading = useAppStore((state) => state.isLoading)
  const isChatStreaming = useAppStore((state) => state.isChatStreaming)
  const isResearching = useAppStore((state) => state.isResearching)
  const setMode = useAppStore((state) => state.setMode)
  const setFocusMode = useAppStore((state) => state.setFocusMode)
  const setSearchTarget = useAppStore((state) => state.setSearchTarget)
  const setSemanticSearch = useAppStore((state) => state.setSemanticSearch)
  const abortActiveRequests = useAppStore((state) => state.abortActiveRequests)
  const streamAnswer = useAppStore((state) => state.streamAnswer)
  const fetchSearchResults = useAppStore((state) => state.fetchSearchResults)
  const sendChatMessage = useAppStore((state) => state.sendChatMessage)
  const startResearch = useAppStore((state) => state.startResearch)
  const resetResults = useAppStore((state) => state.resetResults)

  const searchHistory = useSessionStore((state) => state.searchHistory)
  const clearSearchHistory = useSessionStore((state) => state.clearSearchHistory)
  const knowledgeStatus = useKnowledgeStore((state) => state.knowledgeStatus)
  const fetchKnowledgeStatus = useKnowledgeStore((state) => state.fetchKnowledgeStatus)

  const [value, setValue] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [deepResearch, setDeepResearch] = useState(false)
  const [copiedMath, setCopiedMath] = useState(false)
  const [queryTruncated, setQueryTruncated] = useState(false)

  const isBusy = isLoading || isChatStreaming || isResearching
  const mathResult = useMemo(() => tryEvaluateMathExpression(value), [value])
  const domainFilter = useMemo(() => value.match(/(?:^|\s)site:([^\s]+)/i)?.[1] ?? null, [value])
  const showSlashMenu = value.startsWith('/') && !value.includes(' ')
  const historySuggestions = useMemo(
    () => rankHistorySuggestions(searchHistory, value),
    [searchHistory, value]
  )
  const matchingSlashCommands = useMemo(() => {
    const normalized = value.toLowerCase()
    return SLASH_COMMANDS.filter((command) =>
      command.command.startsWith(normalized) || command.alias?.startsWith(normalized)
    )
  }, [value])

  useEffect(() => setValue(query), [query])

  useEffect(() => {
    if (!knowledgeStatus) void fetchKnowledgeStatus()
  }, [fetchKnowledgeStatus, knowledgeStatus])

  useEffect(() => {
    const closePopovers = (event: MouseEvent) => {
      if (shellRef.current && !shellRef.current.contains(event.target as Node)) setShowHistory(false)
    }
    document.addEventListener('mousedown', closePopovers)
    return () => document.removeEventListener('mousedown', closePopovers)
  }, [])

  const runQuery = (rawValue: string, forceResearch = false) => {
    const raw = rawValue.trim()
    if (!raw) return
    if (isBusy) abortActiveRequests()

    const slash = parseSlashCommand(raw)
    const slashCommand = SLASH_COMMANDS.find((command) =>
      raw.toLowerCase() === command.command || raw.toLowerCase().startsWith(`${command.command} `)
    )
    const explicitMode = slash.mode ?? slashCommand?.mode ?? null
    const cleanQuery = slashCommand?.command === '/ask'
      ? raw.replace(/^\/ask\s*/i, '').trim()
      : slash.cleanQuery
    if (!cleanQuery) return

    const normalized = cleanQuery.length > QUERY_MAX_LENGTH
      ? cleanQuery.slice(0, QUERY_MAX_LENGTH)
      : cleanQuery
    setQueryTruncated(cleanQuery.length > QUERY_MAX_LENGTH)

    const targetMode = forceResearch || deepResearch ? 'research' : explicitMode ?? 'ai'
    if (targetMode !== mode) setMode(targetMode)

    if (targetMode === 'research') void startResearch(normalized)
    else if (targetMode === 'search') void fetchSearchResults(normalized)
    else if (targetMode === 'chat') void sendChatMessage(normalized)
    else void streamAnswer(normalized)

    setDeepResearch(false)
    setShowHistory(false)
  }

  const handleSubmit = (forceResearch = false) => {
    runQuery(value, forceResearch)
    inputRef.current?.focus()
  }

  const handleClear = () => {
    setValue('')
    setDeepResearch(false)
    setQueryTruncated(false)
    resetResults()
    setShowHistory(false)
    inputRef.current?.focus()
  }

  const selectHistory = (historyQuery: string) => {
    setValue(historyQuery)
    runQuery(historyQuery)
  }

  return (
    <div ref={shellRef} className={cn('omnibar-wrap relative w-full', compact ? 'max-w-none' : 'max-w-4xl')}>
      <div
        className={cn(
          'omnibar-shell relative overflow-visible border bg-card/90 shadow-[0_22px_70px_-34px_oklch(0.12_0.03_250/0.6)] backdrop-blur-2xl transition-all duration-300',
          compact ? 'rounded-2xl border-border/70' : 'rounded-[1.35rem] border-border/80',
          'focus-within:border-primary/55 focus-within:shadow-[0_26px_80px_-34px_oklch(0.68_0.17_145/0.5)]'
        )}
      >
        <div className={cn('flex items-center', compact ? 'min-h-12 px-3' : 'min-h-[4.6rem] px-4 sm:px-5')}>
          <div className="mr-3 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/[0.09] text-primary">
            {mathResult ? <Calculator className="size-4" /> : isBusy ? <Sparkles className="size-4 animate-pulse" /> : <Search className="size-4" />}
          </div>
          {compact && (
            <label className="mr-2 hidden shrink-0 items-center gap-1.5 rounded-full border border-border/65 bg-background/55 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground sm:inline-flex">
              <Files className="size-3 text-primary" />
              <select
                value={searchTarget}
                onChange={(event) => setSearchTarget(event.target.value as SearchTarget)}
                className="max-w-16 appearance-none bg-transparent outline-none"
                aria-label="Search target"
              >
                {SEARCH_TARGETS.map((option) => <option key={option.value} value={option.value}>{option.short}</option>)}
              </select>
            </label>
          )}
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => {
              const nextValue = event.target.value
              setValue(nextValue)
              setShowHistory(rankHistorySuggestions(searchHistory, nextValue, 1).length > 0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setShowHistory(false)
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                handleSubmit(event.shiftKey)
              }
            }}
            onFocus={() => historySuggestions.length > 0 && setShowHistory(true)}
            placeholder="Ask anything... search web + vault"
            className={cn(
              'min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/70',
              compact ? 'text-sm sm:text-[15px]' : 'text-base sm:text-lg'
            )}
            autoComplete="off"
            spellCheck
            autoFocus={!compact}
            aria-label="KeepIndex omnibar"
          />
          {value && !isBusy && (
            <button type="button" onClick={handleClear} className="mr-1 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Clear query">
              <X className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (isBusy) abortActiveRequests()
              else handleSubmit(false)
            }}
            className={cn(
              'ml-1 flex shrink-0 items-center justify-center rounded-full transition-all',
              compact ? 'size-8' : 'size-10',
              isBusy
                ? 'bg-foreground text-background hover:scale-95'
                : 'bg-primary text-primary-foreground hover:-translate-y-0.5 hover:shadow-lg'
            )}
            aria-label={isBusy ? 'Stop request' : 'Submit query'}
          >
            {isBusy ? <Square className="size-3 fill-current" /> : <ArrowUp className="size-4" />}
          </button>
        </div>

        {!compact && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border/45 px-4 py-2.5 sm:px-5">
            <label className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/[0.06] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.11em] text-primary">
              <Files className="size-3" />
              <select
                value={searchTarget}
                onChange={(event) => setSearchTarget(event.target.value as SearchTarget)}
                className="appearance-none bg-transparent pr-1 outline-none"
                aria-label="Search target"
              >
                {SEARCH_TARGETS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            {(searchTarget === 'all' || searchTarget === 'web') && (
              <label className="inline-flex items-center gap-1.5 rounded-full border border-border/65 bg-background/55 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground">
                <Globe2 className="size-3" />
                <select
                  value={focusMode}
                  onChange={(event) => setFocusMode(event.target.value as FocusMode)}
                  className="appearance-none bg-transparent pr-1 outline-none"
                  aria-label="Web focus"
                >
                  {FOCUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            )}
            {(searchTarget === 'all' || searchTarget === 'files' || searchTarget === 'vault' || searchTarget === 'documents') && (
              <button
                type="button"
                onClick={() => setSemanticSearch(!semanticSearch)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.11em] transition-colors',
                  semanticSearch
                    ? 'border-primary/35 bg-primary/[0.08] text-primary'
                    : 'border-border/65 text-muted-foreground hover:text-foreground'
                )}
                title="Use the selected local model to expand file queries by meaning. Falls back to keyword search."
                aria-pressed={semanticSearch}
              >
                <BrainCircuit className="size-3" /> Concept search
              </button>
            )}
            <span className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.11em]',
              knowledgeStatus?.unavailableCount
                ? 'border-destructive/35 text-destructive'
                : knowledgeStatus?.indexed
                  ? 'border-[oklch(0.68_0.17_145/0.35)] text-primary'
                  : 'border-border/65 text-muted-foreground'
            )} title={knowledgeStatus?.indexed ? `Knowledge health ${knowledgeStatus.healthScore}%` : 'No local resources indexed'}>
              <Database className="size-3" />
              {knowledgeStatus?.unavailableCount
                ? `${knowledgeStatus.unavailableCount} mount offline`
                : knowledgeStatus?.refreshDueCount
                  ? `${knowledgeStatus.refreshDueCount} refresh due`
                  : knowledgeStatus?.indexed
                    ? `${knowledgeStatus.resourceCount} ${knowledgeStatus.resourceCount === 1 ? 'root' : 'roots'} · ${knowledgeStatus.fileCount} files`
                    : 'vault empty'}
            </span>
            <button
              type="button"
              onClick={() => setDeepResearch((enabled) => !enabled)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.11em] transition-colors',
                deepResearch
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border/65 text-muted-foreground hover:border-primary/40 hover:text-foreground'
              )}
              aria-pressed={deepResearch}
            >
              <Compass className="size-3" />
              Deep research
            </button>
            {domainFilter && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[oklch(0.65_0.13_230/0.35)] bg-[oklch(0.65_0.13_230/0.08)] px-2.5 py-1 font-mono text-[10px] text-[oklch(0.65_0.13_230)]">
                <Check className="size-3" /> site:{domainFilter}
              </span>
            )}
            <span className="ml-auto hidden font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/65 sm:block">
              Shift ↵ to deepen
            </span>
          </div>
        )}
      </div>

      {aiConnection && <p className="mt-2 px-2 text-[11px] leading-relaxed text-muted-foreground" aria-live="polite">
        AI: <span className="font-medium text-foreground">{aiConnection.name}</span>
        {aiConnection.scope === 'remote' ? ' · Remote: prompts and retrieved excerpts go to this endpoint.' : ' · This computer'}
      </p>}
      <AnimatePresence>
        {mathResult && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute left-2 right-2 top-full z-50 mt-2 flex items-center gap-4 rounded-2xl border border-primary/30 bg-card/95 p-3.5 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground font-mono text-sm">=</div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[10px] text-muted-foreground">{mathResult.expr}</p>
              <p className="font-mono text-xl font-semibold tracking-tight">{mathResult.result}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(mathResult.result)
                setCopiedMath(true)
                setTimeout(() => setCopiedMath(false), 1500)
              }}
              className="rounded-full border border-border px-3 py-1.5 text-xs transition-colors hover:bg-muted"
            >
              {copiedMath ? 'Copied' : 'Copy'}
            </button>
            <button type="button" onClick={() => handleSubmit()} className="rounded-full bg-foreground px-3 py-1.5 text-xs text-background">
              Explain
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {showSlashMenu && matchingSlashCommands.length > 0 && !mathResult && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-border/70 bg-card/95 p-1.5 shadow-2xl backdrop-blur-xl">
          <p className="px-3 py-2 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Power routes</p>
          {matchingSlashCommands.map((command) => {
            const Icon = command.icon
            return (
              <button
                key={command.command}
                type="button"
                onClick={() => {
                  setValue(`${command.command} `)
                  inputRef.current?.focus()
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted/70"
              >
                <span className="flex size-8 items-center justify-center rounded-lg border border-border/70 bg-background"><Icon className="size-3.5 text-primary" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium"><code className="text-primary">{command.command}</code>{command.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{command.desc}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {showHistory && !showSlashMenu && historySuggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-border/70 bg-card/95 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between px-3 py-2">
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
              {value.trim() ? 'History matches' : 'Shared search history'}
            </p>
            <button type="button" onClick={() => { clearSearchHistory(); setShowHistory(false) }} className="text-[10px] text-muted-foreground hover:text-foreground">Clear</button>
          </div>
          <div className="max-h-64 overflow-auto pb-1.5">
            {historySuggestions.map((historyQuery, index) => (
              <button key={`${historyQuery}-${index}`} type="button" onClick={() => selectHistory(historyQuery)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-muted/65">
                <Clock3 className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{historyQuery}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {queryTruncated && <p className="absolute -bottom-5 left-2 text-[10px] text-muted-foreground">Query capped at {QUERY_MAX_LENGTH} characters.</p>}
    </div>
  )
})
