import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Cpu, ChevronDown, Check, Sparkles, RefreshCw, Search } from 'lucide-react'
import { useSettingsStore, type ModelInfo } from '@/stores/settings-store'
import { cn } from '@/lib/utils'

function formatModelName(id: string, aliases?: string[]): string {
  if (aliases && aliases.length > 0 && aliases[0]) {
    return aliases[0]
  }
  return id
    .replace(/-dense|-moe/gi, '')
    .replace(/^([a-z])/, (c) => c.toUpperCase())
}

export function ModelSelectorDropdown() {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const selectedModel = useSettingsStore((s) => s.selectedModel)
  const availableModels = useSettingsStore((s) => s.availableModels)
  const isLoadingModels = useSettingsStore((s) => s.isLoadingModels)
  const modelsError = useSettingsStore((s) => s.modelsError)
  const configuredDefault = useSettingsStore((s) => s.configuredDefault)
  const configuredFallback = useSettingsStore((s) => s.configuredFallback)
  const fetchModels = useSettingsStore((s) => s.fetchModels)
  const setSelectedModel = useSettingsStore((s) => s.setSelectedModel)

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  const currentModelInfo = availableModels.find((m) => m.id === selectedModel)
  const currentDisplayName = currentModelInfo
    ? formatModelName(currentModelInfo.id, currentModelInfo.aliases)
    : formatModelName(selectedModel)

  const filteredModels = availableModels.filter(
    (m) =>
      m.id.toLowerCase().includes(search.toLowerCase()) ||
      (m.aliases && m.aliases.some((a) => a.toLowerCase().includes(search.toLowerCase())))
  )

  const handleSelect = (model: ModelInfo) => {
    setSelectedModel(model.id)
    setIsOpen(false)
    setSearch('')
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'h-9 px-3 rounded-full flex items-center gap-2 text-xs font-medium border border-border/60 bg-muted/40',
          'hover:bg-muted/80 hover:border-border transition-all duration-150 text-foreground shadow-sm'
        )}
        title="Select any model advertised by your local inference server"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className={cn('size-2 rounded-full', isLoadingModels ? 'animate-pulse bg-[oklch(0.7_0.14_80)]' : modelsError ? 'bg-destructive' : 'bg-emerald-500')} />
        <Cpu className="size-3.5 text-muted-foreground" />
        <span className="max-w-[140px] truncate">{currentDisplayName}</span>
        {currentModelInfo?.isReasoning && (
          <span className="px-1.5 py-0.2 text-[10px] rounded bg-primary/15 text-primary font-mono shrink-0">
            Think
          </span>
        )}
        <ChevronDown className="size-3 text-muted-foreground shrink-0" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 top-full mt-2 w-72 sm:w-80 rounded-xl border border-border bg-card shadow-2xl z-50 overflow-hidden flex flex-col max-h-[380px]"
          >
            <div className="p-2 border-b border-border/50 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter local models..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-muted/50 rounded-lg border-0 focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
                  autoFocus
                />
              </div>
              <button
                type="button"
                onClick={() => fetchModels()}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Refresh models from the local inference server"
                aria-label="Refresh models from the local inference server"
              >
                <RefreshCw className={cn('size-3.5', isLoadingModels && 'animate-spin')} />
              </button>
            </div>

            {modelsError && <p className="border-b border-border/50 px-3 py-2 text-[10px] text-[oklch(0.68_0.13_75)]">{modelsError}</p>}
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1" role="listbox" aria-label="Available local models">
              {filteredModels.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  No matching models found
                </div>
              ) : (
                filteredModels.map((m) => {
                  const isSelected = m.id === selectedModel
                  const displayName = formatModelName(m.id, m.aliases)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleSelect(m)}
                      role="option"
                      aria-selected={isSelected}
                      className={cn(
                        'w-full flex items-start gap-2.5 p-2 rounded-lg text-left text-xs transition-colors cursor-pointer',
                        isSelected
                          ? 'bg-primary/10 text-primary border border-primary/30 font-medium'
                          : 'hover:bg-muted text-foreground'
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{displayName}</span>
                          {m.id === configuredDefault && <span className="rounded bg-muted px-1 py-0.5 font-mono text-[9px] text-muted-foreground">Default</span>}
                          {m.id === configuredFallback && m.id !== configuredDefault && <span className="rounded bg-muted px-1 py-0.5 font-mono text-[9px] text-muted-foreground">Fallback</span>}
                          {m.isReasoning && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] px-1 py-0.2 rounded bg-primary/20 text-primary font-mono">
                              <Sparkles className="size-2.5" />
                              Reasoning
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate font-mono mt-0.5">
                          {m.id}
                        </p>
                      </div>
                      {isSelected && <Check className="size-4 text-primary shrink-0 mt-0.5" />}
                    </button>
                  )
                })
              )}
            </div>

            <div className="p-2 border-t border-border/50 bg-muted/20 text-[11px] text-muted-foreground flex items-center justify-between">
              <span>{availableModels.length} server model{availableModels.length === 1 ? '' : 's'}</span>
              <span className="font-mono text-[10px]">local inference</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
