import { useState } from 'react'
import { BookOpenText, Check, Code2, Copy, File, FileText, Globe2, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppStore, type Source, type KnowledgeSource } from '@/stores/app-store'
import { cn } from '@/lib/utils'

function getDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export function SourcesPanel() {
  const mode = useAppStore((s) => s.mode)
  const sources = useAppStore((s) => (mode === 'research' ? s.researchSources.web : s.sources))
  const localSources = useAppStore((s) => (mode === 'research' ? s.researchSources.local : s.localSources))
  const isLoading = useAppStore((s) => s.isLoading)
  const isResearching = useAppStore((s) => s.isResearching)
  const answer = useAppStore((s) => s.answer)
  const researchReport = useAppStore((s) => s.researchReport)
  const hasCompletedQuery = (mode === 'ai' && answer) || (mode === 'research' && researchReport)

  if ((isLoading || isResearching) && sources.length === 0 && localSources.length === 0) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (sources.length === 0 && localSources.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {hasCompletedQuery ? 'No sources found for this query.' : 'Sources will appear here once you submit a query.'}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4 min-h-0 overflow-auto">
      {sources.length > 0 && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
            Web & History
          </h3>
          <ul className="flex flex-row lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible pb-2 lg:pb-0 list-none p-0 m-0">
            {sources.map((s, i) => (
              <WebSourceCard key={i} source={s} index={i} />
            ))}
          </ul>
        </div>
      )}
      {sources.length > 0 && localSources.length > 0 && (
        <div className="border-t border-border/50 pt-4" />
      )}
      {localSources.length > 0 && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
            Local Knowledge
          </h3>
          <ul className="flex flex-col gap-2 list-none p-0 m-0">
            {localSources.map((s, i) => (
              <LocalSourceCard key={i} source={s} index={i} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function WebSourceCard({ source, index }: { source: Source; index: number }) {
  const [copied, setCopied] = useState(false)
  const domain = getDomain(source.url)

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    navigator.clipboard.writeText(source.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <li id={`source-${index}`} className="shrink-0 lg:shrink w-56 lg:w-full">
      <div
        className={cn(
          'flex items-start gap-2 rounded-lg border border-border/50 p-2.5 transition-colors',
          'hover:border-primary/40 hover:bg-accent/30'
        )}
      >
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 min-w-0 flex items-start gap-2"
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-mono font-semibold">
            {index + 1}
          </span>
          {source.kind === 'history'
            ? <History className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            : <Globe2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium line-clamp-2">{source.title || source.url}</p>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {source.kind === 'history' ? `${source.browser ?? 'browser'} · ${source.visitCount ?? 0} visits` : domain}
            </p>
            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{source.snippet}</p>
          </div>
        </a>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleCopy}
          className="shrink-0 h-6 w-6"
          title="Copy URL"
        >
          {copied ? (
            <Check className="size-3 text-primary" />
          ) : (
            <Copy className="size-3 text-muted-foreground" />
          )}
        </Button>
      </div>
    </li>
  )
}

function LocalKindIcon({ kind }: { kind?: KnowledgeSource['sourceKind'] }) {
  if (kind === 'note') return <BookOpenText className="size-4 shrink-0 mt-0.5 text-emerald-600" />
  if (kind === 'code') return <Code2 className="size-4 shrink-0 mt-0.5 text-emerald-600" />
  if (kind === 'file') return <File className="size-4 shrink-0 mt-0.5 text-emerald-600" />
  return <FileText className="size-4 shrink-0 mt-0.5 text-emerald-600" />
}

function LocalSourceCard({
  source,
  index,
}: {
  source: KnowledgeSource
  index: number
}) {
  const [copied, setCopied] = useState(false)
  const setSourcePreview = useAppStore((state) => state.setSourcePreview)
  const citationId = `source-L${index + 1}`

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    navigator.clipboard.writeText(source.filePath)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <li id={citationId} className="shrink-0 lg:shrink w-full">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setSourcePreview({ type: 'local', index, source })}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setSourcePreview({ type: 'local', index, source })
          }
        }}
        className={cn(
          'flex cursor-pointer items-start gap-2 rounded-lg border border-border/50 p-2.5 transition-colors',
          'hover:border-emerald-500/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40'
        )}
      >
        <div className="flex-1 min-w-0 flex items-start gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white text-xs font-mono font-semibold">
            L{index + 1}
          </span>
          <LocalKindIcon kind={source.sourceKind} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1.5">
              <p className="min-w-0 flex-1 text-sm font-medium line-clamp-2">{source.fileName}</p>
              {source.sourceKind && <span className="rounded border border-emerald-500/20 px-1 py-0.5 font-mono text-[8px] uppercase text-emerald-600">{source.sourceKind}</span>}
            </div>
            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={source.filePath}>
              {source.resourceLabel ?? source.filePath}
              {source.startLine ? ` · L${source.startLine}${source.endLine && source.endLine !== source.startLine ? `–${source.endLine}` : ''}` : ''}
              {source.indexedAt && Date.now() - source.indexedAt > 24 * 60 * 60_000 ? ' · refresh due' : ''}
            </p>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {source.content.slice(0, 150)}{source.content.length > 150 ? '…' : ''}
            </p>
            {!!source.tags?.length && (
              <p className="mt-1 truncate font-mono text-[9px] text-emerald-700/75">{source.tags.slice(0, 4).map((tag) => `#${tag}`).join(' ')}</p>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleCopy}
          className="shrink-0 h-6 w-6"
          title="Copy path"
        >
          {copied ? (
            <Check className="size-3 text-primary" />
          ) : (
            <Copy className="size-3 text-muted-foreground" />
          )}
        </Button>
      </div>
    </li>
  )
}
