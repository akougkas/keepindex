import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/app-store'
import { cn } from '@/lib/utils'

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.rb', '.java', '.kt', '.swift',
  '.sql', '.json', '.yaml', '.yml', '.html', '.css', '.scss',
  '.md', '.sh', '.bash', '.zsh', '.r', '.lua', '.vim',
])

function isCodeLike(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  return CODE_EXTENSIONS.has(ext)
}

type FilePreview = {
  path: string
  fileName: string
  totalLines: number
  startLine: number
  endLine: number
  content: string
  extracted?: boolean
  extractor?: string
  mimeType?: string
}

export function SourcePreviewDrawer() {
  const sourcePreview = useAppStore((s) => s.sourcePreview)
  const clearSourcePreview = useAppStore((s) => s.clearSourcePreview)
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null)
  const [isLoadingFile, setIsLoadingFile] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSourcePreview()
    }
    if (sourcePreview) {
      document.addEventListener('keydown', handleEscape)
      return () => document.removeEventListener('keydown', handleEscape)
    }
  }, [sourcePreview, clearSourcePreview])

  useEffect(() => {
    setFilePreview(null)
    setFileError(null)
    if (!sourcePreview || sourcePreview.type !== 'local') return
    const controller = new AbortController()
    const source = sourcePreview.source
    const startLine = Math.max(1, (source.startLine ?? 1) - 6)
    const endLine = Math.max(startLine, (source.endLine ?? source.startLine ?? 80) + 8)
    setIsLoadingFile(true)
    void fetch(
      `/api/knowledge/file?path=${encodeURIComponent(source.filePath)}&startLine=${startLine}&endLine=${endLine}`,
      { signal: controller.signal }
    )
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load source lines')
        return response.json() as Promise<FilePreview>
      })
      .then(setFilePreview)
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          setFileError('Live file view unavailable; showing the indexed chunk.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingFile(false)
      })
    return () => controller.abort()
  }, [sourcePreview])

  return (
    <AnimatePresence>
      {sourcePreview && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={clearSourcePreview}
            className="fixed inset-0 bg-black/20 z-50"
            aria-hidden
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed bottom-0 left-0 right-0 z-50 max-h-[58vh] flex flex-col bg-card border-t border-border rounded-t-2xl shadow-2xl overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Source preview"
          >
            <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-border/50">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={cn(
                    'shrink-0 flex items-center justify-center size-6 rounded-full text-xs font-mono font-semibold',
                    sourcePreview.type === 'web'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-emerald-600 text-white'
                  )}
                >
                  {sourcePreview.type === 'web'
                    ? `[${sourcePreview.index + 1}]`
                    : `[L${sourcePreview.index + 1}]`}
                </span>
                <span className="text-sm font-medium truncate">
                  {sourcePreview.type === 'web'
                    ? sourcePreview.source.title || sourcePreview.source.url
                    : sourcePreview.source.fileName}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {sourcePreview.type === 'web' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() =>
                      window.open(sourcePreview.source.url, '_blank', 'noopener,noreferrer')
                    }
                  >
                    <ExternalLink className="size-3.5" />
                    Open
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={clearSourcePreview}
                  aria-label="Close"
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 min-h-0">
              {sourcePreview.type === 'web' ? (
                <div className="space-y-2">
                  {(sourcePreview.source.kind === 'history' || sourcePreview.source.sourceTypes?.includes('history')) && (
                    <div className="flex flex-wrap gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-amber-600">
                      <span className="rounded border border-amber-500/25 px-1.5 py-0.5">private history</span>
                      {sourcePreview.source.browser && <span>{sourcePreview.source.browser} · {sourcePreview.source.profile}</span>}
                      {!!sourcePreview.source.visitCount && <span>{sourcePreview.source.visitCount} visits</span>}
                    </div>
                  )}
                  <p className="text-sm text-foreground whitespace-pre-wrap">
                    {sourcePreview.source.snippet}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono truncate">
                    {sourcePreview.source.url}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-emerald-600">
                    <span className="rounded border border-emerald-500/25 px-1.5 py-0.5">{sourcePreview.source.sourceKind ?? 'local file'}</span>
                    {(filePreview?.extractor || sourcePreview.source.extractor) && <span>{filePreview?.extractor ?? sourcePreview.source.extractor}</span>}
                    {(filePreview?.mimeType || sourcePreview.source.mimeType) && <span className="normal-case tracking-normal text-muted-foreground">{filePreview?.mimeType ?? sourcePreview.source.mimeType}</span>}
                    {sourcePreview.source.metadataOnly && <span className="text-amber-600">metadata only</span>}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                      {sourcePreview.source.filePath}
                    </p>
                    {(sourcePreview.source.startLine || filePreview) && (
                      <span className="shrink-0 rounded-full border border-border/70 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                        L{sourcePreview.source.startLine ?? filePreview?.startLine}
                        {(sourcePreview.source.endLine ?? filePreview?.endLine) !== (sourcePreview.source.startLine ?? filePreview?.startLine)
                          ? `–${sourcePreview.source.endLine ?? filePreview?.endLine}`
                          : ''}
                      </span>
                    )}
                  </div>
                  {(sourcePreview.source.tags?.length || sourcePreview.source.aliases?.length) ? (
                    <div className="flex flex-wrap gap-1">
                      {sourcePreview.source.tags?.map((tag) => <span key={tag} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">#{tag}</span>)}
                      {sourcePreview.source.aliases?.map((alias) => <span key={alias} className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">aka {alias}</span>)}
                    </div>
                  ) : null}
                  {isLoadingFile && (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" /> Loading live line context…
                    </p>
                  )}
                  {fileError && <p className="text-xs text-[oklch(0.68_0.13_75)]">{fileError}</p>}
                  <div className="overflow-x-auto rounded-xl border border-border/60 bg-[oklch(0.13_0.015_255)] py-3 text-[oklch(0.9_0.01_250)]">
                    {(filePreview?.content ?? sourcePreview.source.content).split('\n').map((line, index) => {
                      const lineNumber = (filePreview?.startLine ?? sourcePreview.source.startLine ?? 1) + index
                      const isMatched = lineNumber >= (sourcePreview.source.startLine ?? lineNumber) && lineNumber <= (sourcePreview.source.endLine ?? lineNumber)
                      return (
                        <div
                          key={lineNumber}
                          className={cn(
                            'grid min-w-max grid-cols-[3.5rem_1fr] px-3 font-mono text-xs leading-5',
                            isMatched && 'bg-[oklch(0.72_0.16_145/0.12)]'
                          )}
                        >
                          <span className="select-none pr-4 text-right text-white/30">{lineNumber}</span>
                          <code className={cn('whitespace-pre pr-5', !isCodeLike(sourcePreview.source.filePath) && 'font-sans')}>{line || ' '}</code>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
