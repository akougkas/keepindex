import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertTriangle,
  BookOpenText,
  Check,
  Database,
  FileStack,
  HardDrive,
  History,
  LockKeyhole,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useKnowledgeStore, type KnowledgeResource } from '@/stores/knowledge-store'
import { cn } from '@/lib/utils'

interface KnowledgeSettingsProps {
  isOpen: boolean
  onClose: () => void
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function formatAge(timestamp: number): string {
  if (!timestamp) return 'unknown'
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function ResourceCard({
  resource,
  active,
  confirmRemove,
  onRefresh,
  onRemove,
}: {
  resource: KnowledgeResource
  active: boolean
  confirmRemove: boolean
  onRefresh: () => void
  onRemove: () => void
}) {
  const statusTone = !resource.mounted
    ? 'text-destructive'
    : resource.refreshDue || resource.capped
      ? 'text-[oklch(0.68_0.13_75)]'
      : 'text-primary'
  return (
    <article className="rounded-xl border border-border/60 bg-muted/20 p-3.5">
      <div className="flex items-start gap-3">
        <div className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background', statusTone)}>
          {resource.kind === 'obsidian' ? <BookOpenText className="size-4" /> : resource.path.startsWith('/mnt/') ? <Server className="size-4" /> : <HardDrive className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold" title={resource.label}>{resource.label}</p>
              <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={resource.path}>{resource.path}</p>
            </div>
            <span className={cn('shrink-0 font-mono text-[10px] font-semibold', statusTone)}>{resource.healthScore}%</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
            <span>{resource.fileCount} files</span>
            <span>{resource.chunkCount} chunks</span>
            <span>{formatBytes(resource.indexedBytes)}</span>
          </div>
          {((resource.noteCount ?? 0) + (resource.documentCount ?? 0) + (resource.codeFileCount ?? 0) > 0) && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 font-mono text-[9px] text-muted-foreground">
              {!!resource.noteCount && <span>{resource.noteCount} notes</span>}
              {!!resource.documentCount && <span>{resource.documentCount} documents</span>}
              {!!resource.codeFileCount && <span>{resource.codeFileCount} code files</span>}
              {!!resource.metadataFileCount && <span>{resource.metadataFileCount} metadata-only</span>}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            {!resource.mounted && <span className="text-destructive">mount unavailable</span>}
            {resource.refreshDue && resource.mounted && <span className="text-[oklch(0.68_0.13_75)]">refresh due</span>}
            {resource.capped && <span className="text-[oklch(0.68_0.13_75)]">safety cap reached</span>}
            <span>{resource.coveragePct}% eligible-file coverage</span>
            <span>indexed {formatAge(resource.indexedAt)}</span>
          </div>
          {(resource.skippedLargeFiles > 0 || resource.skippedSensitiveFiles > 0 || resource.skippedUnreadableFiles > 0) && (
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              Excluded: {resource.skippedSensitiveFiles} sensitive · {resource.skippedLargeFiles} oversized · {resource.skippedUnreadableFiles} unreadable
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-1 border-t border-border/45 pt-2.5">
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={active} className="h-7 gap-1.5 text-[11px]">
          <RefreshCw className={cn('size-3', active && 'animate-spin')} /> Refresh
        </Button>
        <Button
          variant={confirmRemove ? 'destructive' : 'ghost'}
          size="sm"
          onClick={onRemove}
          disabled={active}
          className="h-7 gap-1.5 text-[11px]"
        >
          <Trash2 className="size-3" /> {confirmRemove ? 'Confirm remove' : 'Remove'}
        </Button>
      </div>
    </article>
  )
}

export function KnowledgeSettings({ isOpen, onClose }: KnowledgeSettingsProps) {
  const pathRef = useRef<HTMLInputElement>(null)
  const [pathInput, setPathInput] = useState('')
  const [labelInput, setLabelInput] = useState('')
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmHistoryClear, setConfirmHistoryClear] = useState(false)
  const [lastHistoryImport, setLastHistoryImport] = useState<number | null>(null)
  const [lastResult, setLastResult] = useState<{
    indexed: number
    files: number
    capped: boolean
    skippedLargeFiles: number
    skippedSensitiveFiles: number
    skippedUnreadableFiles: number
  } | null>(null)
  const {
    knowledgeStatus,
    isIndexing,
    activeResourceId,
    indexError,
    statusError,
    browserHistoryStatus,
    isImportingHistory,
    browserHistoryError,
    indexKnowledge,
    refreshResource,
    refreshAll,
    removeResource,
    fetchKnowledgeStatus,
    fetchBrowserHistoryStatus,
    importBrowserHistory,
    clearBrowserHistory,
    clearIndex,
  } = useKnowledgeStore()

  useEffect(() => {
    if (!isOpen) return
    void Promise.all([fetchKnowledgeStatus(), fetchBrowserHistoryStatus()])
    const timer = window.setTimeout(() => pathRef.current?.focus(), 180)
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, fetchKnowledgeStatus, fetchBrowserHistoryStatus, onClose])

  const handleIndex = async () => {
    const trimmed = pathInput.trim()
    if (!trimmed) return
    const result = await indexKnowledge(trimmed, labelInput)
    setLastResult(result)
    if (result) {
      setPathInput('')
      setLabelInput('')
    }
  }

  const handleRemove = async (resource: KnowledgeResource) => {
    if (confirmRemoveId !== resource.id) {
      setConfirmRemoveId(resource.id)
      window.setTimeout(() => setConfirmRemoveId((current) => current === resource.id ? null : current), 3500)
      return
    }
    if (await removeResource(resource.id)) setConfirmRemoveId(null)
  }

  const handleClear = async () => {
    if (!confirmClear) {
      setConfirmClear(true)
      window.setTimeout(() => setConfirmClear(false), 3500)
      return
    }
    if (await clearIndex()) {
      setConfirmClear(false)
      setLastResult(null)
    }
  }

  const handleHistoryImport = async () => {
    const imported = await importBrowserHistory()
    if (imported != null) setLastHistoryImport(imported)
  }

  const handleHistoryClear = async () => {
    if (!confirmHistoryClear) {
      setConfirmHistoryClear(true)
      window.setTimeout(() => setConfirmHistoryClear(false), 3500)
      return
    }
    if (await clearBrowserHistory()) {
      setConfirmHistoryClear(false)
      setLastHistoryImport(null)
    }
  }

  const resources = knowledgeStatus?.resources ?? []

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 bg-black/45 backdrop-blur-sm" onClick={onClose} aria-hidden />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 27, stiffness: 220 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[470px] flex-col border-l border-border bg-card shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="knowledge-dialog-title"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border/60 p-4">
              <div>
                <div className="flex items-center gap-2">
                  <Database className="size-4 text-primary" />
                  <h2 id="knowledge-dialog-title" className="font-semibold">Knowledge resources</h2>
                </div>
                <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                  {resources.length} roots · {knowledgeStatus?.fileCount ?? 0} files · {knowledgeStatus?.healthScore ?? 0}% health
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close knowledge resources"><X className="size-4" /></Button>
            </div>

            <div className="flex-1 space-y-5 overflow-auto p-4">
              <section className="rounded-xl border border-border/60 bg-background/50 p-3.5">
                <div className="mb-3 flex items-center gap-2">
                  <Plus className="size-3.5 text-primary" />
                  <p className="section-kicker">Add disk or mount</p>
                </div>
                <div className="space-y-2">
                  <Input ref={pathRef} value={pathInput} onChange={(event) => setPathInput(event.target.value)} placeholder="/home/user/notes or /mnt/nas/share" className="font-mono text-xs" aria-label="Knowledge directory path" />
                  <Input value={labelInput} onChange={(event) => setLabelInput(event.target.value)} placeholder="Optional label, e.g. NAS documents" className="text-xs" aria-label="Knowledge source label" />
                  <Button onClick={handleIndex} disabled={isIndexing || !pathInput.trim()} className="w-full gap-2">
                    {isIndexing && !activeResourceId ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                    Index resource
                  </Button>
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                  WSL paths and Windows drive paths are accepted. Mount SMB/NFS shares in WSL first, then add their <span className="font-mono">/mnt/…</span> path. Secrets, keys, and hidden folders are excluded. Text is capped at 4 MB; extractable documents at 32 MB.
                </p>
              </section>

              {(indexError || statusError) && (
                <p className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {indexError ?? statusError}
                </p>
              )}

              {lastResult && (
                <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  <span>
                    Indexed {lastResult.indexed} chunks from {lastResult.files} files.
                    {(lastResult.skippedSensitiveFiles + lastResult.skippedLargeFiles + lastResult.skippedUnreadableFiles) > 0 &&
                      ` Safely excluded ${lastResult.skippedSensitiveFiles + lastResult.skippedLargeFiles + lastResult.skippedUnreadableFiles} files.`}
                  </span>
                </div>
              )}

              <section className="overflow-hidden rounded-xl border border-amber-500/20 bg-[linear-gradient(135deg,oklch(0.73_0.14_75/0.08),transparent_56%)]">
                <div className="flex items-start gap-3 p-3.5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/25 bg-amber-500/10 text-amber-600">
                    <History className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold">Private browser memory</p>
                        <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                          {browserHistoryStatus?.entryCount.toLocaleString() ?? 0} pages · {browserHistoryStatus?.sources.length ?? 0} profiles
                        </p>
                      </div>
                      <LockKeyhole className="size-3.5 text-amber-600" />
                    </div>
                    <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                      Import page titles, URLs, visit counts, and timestamps from discovered Chrome, Edge, Brave, Chromium, and Firefox profiles. Databases are copied before reading and never modified. The index stays in KeepIndex's local SQLite database.
                    </p>
                  </div>
                </div>
                {browserHistoryStatus && browserHistoryStatus.discovered.length > 0 && (
                  <div className="border-y border-border/45 bg-background/35 px-3.5 py-2">
                    <p className="mb-1.5 font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground">Discovered on this machine</p>
                    <div className="flex flex-wrap gap-1.5">
                      {browserHistoryStatus.discovered.slice(0, 8).map((source) => (
                        <span key={source.id} title={source.path} className="rounded-md border border-border/60 bg-card/60 px-1.5 py-1 font-mono text-[9px] text-muted-foreground">
                          {source.browser} · {source.profile} · {source.platform}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 p-3">
                  <Button size="sm" onClick={() => void handleHistoryImport()} disabled={isImportingHistory || browserHistoryStatus?.discovered.length === 0} className="h-7 gap-1.5 text-[11px]">
                    {isImportingHistory ? <Loader2 className="size-3 animate-spin" /> : <FileStack className="size-3" />}
                    {browserHistoryStatus?.indexed ? 'Refresh history' : 'Import discovered history'}
                  </Button>
                  {!!browserHistoryStatus?.entryCount && (
                    <Button variant={confirmHistoryClear ? 'destructive' : 'ghost'} size="sm" onClick={() => void handleHistoryClear()} disabled={isImportingHistory} className="h-7 gap-1.5 text-[11px]">
                      <Trash2 className="size-3" /> {confirmHistoryClear ? 'Confirm private-history clear' : 'Clear'}
                    </Button>
                  )}
                  {lastHistoryImport != null && <span className="text-[10px] text-muted-foreground">{lastHistoryImport.toLocaleString()} entries imported</span>}
                </div>
                {browserHistoryError && <p className="border-t border-destructive/20 px-3.5 py-2 text-[10px] text-destructive">{browserHistoryError}</p>}
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="section-kicker">Active roots</p>
                  {resources.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => void refreshAll()} disabled={isIndexing} className="h-7 gap-1.5 text-[11px]">
                      <RefreshCw className={cn('size-3', isIndexing && 'animate-spin')} /> Refresh all
                    </Button>
                  )}
                </div>
                {resources.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center">
                    <HardDrive className="mx-auto size-7 text-muted-foreground/50" />
                    <p className="mt-2 text-sm font-medium">No indexed resources</p>
                    <p className="mt-1 text-xs text-muted-foreground">Add local notes, project disks, or a mounted network share.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {resources.map((resource) => (
                      <ResourceCard
                        key={resource.id}
                        resource={resource}
                        active={activeResourceId === resource.id}
                        confirmRemove={confirmRemoveId === resource.id}
                        onRefresh={() => void refreshResource(resource)}
                        onRemove={() => void handleRemove(resource)}
                      />
                    ))}
                  </div>
                )}
              </section>

              {resources.length > 0 && (
                <section className="rounded-xl border border-border/50 p-3.5">
                  <div className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                    <div>
                      <p className="text-xs font-semibold">Scoped file access</p>
                      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">Line previews are restricted to files that are present in this index. Removing a root immediately revokes preview access.</p>
                    </div>
                  </div>
                  <Button variant={confirmClear ? 'destructive' : 'outline'} size="sm" onClick={handleClear} disabled={isIndexing} className="mt-3 h-7 gap-1.5 text-[11px]">
                    <Trash2 className="size-3" /> {confirmClear ? 'Confirm clear all roots' : 'Clear complete index'}
                  </Button>
                </section>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
