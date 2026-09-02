import { useEffect, useMemo, useState } from 'react'
import {
  BookOpenText,
  BrainCircuit,
  Clock3,
  Code2,
  ExternalLink,
  File,
  FileText,
  FolderOpen,
  Globe2,
  History,
  Layers3,
  ShieldCheck,
} from 'lucide-react'
import { useAppStore, type KnowledgeSource, type Source, type SourceKind } from '@/stores/app-store'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type ResultFilter = 'all' | 'web' | 'local' | 'history'

const LOCAL_KINDS = new Set<SourceKind>(['note', 'document', 'code', 'file'])

function kindLabel(result: Source): string {
  if (result.kind === 'history') return 'History'
  if (result.kind === 'note') return 'Obsidian'
  if (result.kind === 'document') return (result.extension || 'Document').replace(/^\./, '').toUpperCase()
  if (result.kind === 'code') return 'Code'
  if (result.kind === 'file') return 'File'
  return 'Web'
}

function ResultIcon({ kind }: { kind?: SourceKind }) {
  const className = 'size-4'
  if (kind === 'history') return <History className={className} />
  if (kind === 'note') return <BookOpenText className={className} />
  if (kind === 'document') return <FileText className={className} />
  if (kind === 'code') return <Code2 className={className} />
  if (kind === 'file') return <File className={className} />
  return <Globe2 className={className} />
}

function relativeTime(timestamp?: number): string {
  if (!timestamp) return ''
  const days = Math.floor(Math.max(0, Date.now() - timestamp) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function MatchText({ text, query, className }: { text: string; query: string; className?: string }) {
  const terms = useMemo(() => Array.from(new Set(
    query.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? []
  )).sort((a, b) => b.length - a.length).slice(0, 8), [query])
  if (!text || terms.length === 0) return <span className={className}>{text}</span>
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'gi'))
  const termSet = new Set(terms)
  return (
    <span className={className}>
      {parts.map((part, index) => termSet.has(part.toLowerCase())
        ? <mark key={`${part}-${index}`} className="rounded-sm bg-primary/15 px-0.5 text-inherit">{part}</mark>
        : part)}
    </span>
  )
}

function toKnowledgeSource(result: Source): KnowledgeSource | null {
  if (!result.filePath) return null
  return {
    filePath: result.filePath,
    fileName: result.fileName || result.title,
    content: result.snippet,
    startLine: result.startLine,
    endLine: result.endLine,
    resourceId: result.resourceId,
    resourceLabel: result.resourceLabel,
    sourceKind: result.kind && LOCAL_KINDS.has(result.kind) ? result.kind as KnowledgeSource['sourceKind'] : undefined,
    extension: result.extension,
    mimeType: result.mimeType,
    metadataOnly: result.metadataOnly,
    aliases: result.aliases,
    tags: result.tags,
    modifiedAt: result.modifiedAt,
  }
}

export function SearchResultsPanel() {
  const searchResults = useAppStore((state) => state.searchResults)
  const searchResultsQuery = useAppStore((state) => state.searchResultsQuery)
  const searchMeta = useAppStore((state) => state.searchMeta)
  const isLoading = useAppStore((state) => state.isLoading)
  const query = useAppStore((state) => state.query)
  const setSourcePreview = useAppStore((state) => state.setSourcePreview)
  const [filter, setFilter] = useState<ResultFilter>('all')
  const visibleResults = searchResultsQuery === query ? searchResults : []

  useEffect(() => setFilter('all'), [searchResultsQuery])

  const filtered = useMemo(() => visibleResults.filter((result) => {
    if (filter === 'all') return true
    if (filter === 'web') return !result.kind || result.kind === 'web'
    if (filter === 'history') return result.kind === 'history' || result.sourceTypes?.includes('history')
    return result.kind ? LOCAL_KINDS.has(result.kind) : false
  }), [filter, visibleResults])

  if (isLoading && visibleResults.length === 0) {
    return (
      <div className="space-y-2.5">
        <Skeleton className="h-11 w-full rounded-xl" />
        {[1, 2, 3, 4, 5].map((index) => <Skeleton key={index} className="h-28 w-full rounded-xl" />)}
      </div>
    )
  }

  if (visibleResults.length === 0) {
    return (
      <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 px-6 text-center">
        <Layers3 className="size-7 text-muted-foreground/45" />
        <p className="mt-3 text-sm font-semibold">{query ? 'Nothing matched this target' : 'Your search fabric is ready'}</p>
        <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
          {query
            ? 'Try All sources, fewer query operators, or enable Concept search for meaning-based local expansion.'
            : 'Search the live web, indexed files, Obsidian notes, parsed documents, and private browser history together.'}
        </p>
      </div>
    )
  }

  const filterCounts: Record<ResultFilter, number> = {
    all: visibleResults.length,
    web: visibleResults.filter((result) => !result.kind || result.kind === 'web').length,
    local: visibleResults.filter((result) => result.kind && LOCAL_KINDS.has(result.kind)).length,
    history: visibleResults.filter((result) => result.kind === 'history' || result.sourceTypes?.includes('history')).length,
  }

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 rounded-xl border border-border/60 bg-card/90 p-2 shadow-sm backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-1.5">
          {(['all', 'web', 'local', 'history'] as ResultFilter[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              disabled={filterCounts[value] === 0}
              className={cn(
                'rounded-lg px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] transition-colors disabled:opacity-35',
                filter === value ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {value} <span className="ml-1 opacity-65">{filterCounts[value]}</span>
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 px-1 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
            {searchMeta?.semantic.requested && (
              <span className={cn('inline-flex items-center gap-1', searchMeta.semantic.mode === 'embedding-rerank' ? 'text-primary' : 'text-[oklch(0.68_0.13_75)]')}>
                <BrainCircuit className="size-3" /> {searchMeta.semantic.mode === 'embedding-rerank' ? 'embedding reranked' : 'keyword fallback'}
              </span>
            )}
            <span className="inline-flex items-center gap-1"><ShieldCheck className="size-3" /> local-first</span>
          </div>
        </div>
        {(searchMeta?.degraded || searchMeta?.semantic.warning) && (
          <p className="mt-1.5 border-t border-border/50 px-2 pt-1.5 text-[10px] text-[oklch(0.68_0.13_75)]">
            {searchMeta.degraded ? 'Live web was unavailable; surviving private sources are shown. ' : ''}
            {searchMeta.semantic.warning}
          </p>
        )}
      </div>

      {filtered.map((result, index) => {
        const local = result.kind ? LOCAL_KINDS.has(result.kind) : false
        const history = result.kind === 'history'
        const content = (
          <article className="group relative overflow-hidden rounded-xl border border-border/55 bg-card/55 px-4 py-3.5 transition-all duration-200 hover:-translate-y-px hover:border-primary/35 hover:bg-card hover:shadow-[0_12px_32px_-24px_oklch(0.2_0.03_250/0.7)]">
            <div className="flex items-start gap-3">
              <div className={cn(
                'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border',
                local ? 'border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-600' :
                  history ? 'border-amber-500/25 bg-amber-500/[0.07] text-amber-600' :
                    'border-primary/20 bg-primary/[0.06] text-primary'
              )}>
                <ResultIcon kind={result.kind} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <h3 className="min-w-0 flex-1 text-[15px] font-semibold leading-snug tracking-[-0.01em] group-hover:text-primary">
                    <MatchText text={result.title || result.url} query={query} />
                  </h3>
                  {!local && <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/45" />}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                  <span className={cn('font-semibold', local ? 'text-emerald-600' : history ? 'text-amber-600' : 'text-primary')}>{kindLabel(result)}</span>
                  {local ? (
                    <>
                      <span className="normal-case tracking-normal" title={result.filePath}>{result.resourceLabel || result.filePath}</span>
                      {result.startLine && !result.metadataOnly && <span>L{result.startLine}{result.endLine && result.endLine !== result.startLine ? `–${result.endLine}` : ''}</span>}
                      {result.modifiedAt && <span>{relativeTime(result.modifiedAt)}</span>}
                    </>
                  ) : (
                    <>
                      <span className="normal-case tracking-normal">{domain(result.url)}</span>
                      {result.lastVisitedAt && <span className="inline-flex items-center gap-1"><Clock3 className="size-2.5" /> {relativeTime(result.lastVisitedAt)}</span>}
                      {result.visitCount && <span>{result.visitCount} visits</span>}
                    </>
                  )}
                  {result.sourceTypes && result.sourceTypes.length > 1 && (
                    <span className="rounded-full border border-border px-1.5 py-0.5">web + history</span>
                  )}
                </div>
                <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                  <MatchText text={result.snippet} query={query} />
                </p>
                {(result.tags?.length || result.aliases?.length) ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {result.tags?.slice(0, 4).map((tag) => <span key={tag} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">#{tag}</span>)}
                    {result.aliases?.slice(0, 2).map((alias) => <span key={alias} className="rounded-md border border-border/60 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">aka {alias}</span>)}
                  </div>
                ) : null}
              </div>
              <span className="mt-0.5 font-mono text-[9px] text-muted-foreground/45">{String(index + 1).padStart(2, '0')}</span>
            </div>
          </article>
        )

        if (local) {
          return (
            <button
              key={result.id || `${result.filePath}-${index}`}
              type="button"
              className="block w-full text-left"
              onClick={() => {
                const source = toKnowledgeSource(result)
                if (source) setSourcePreview({ type: 'local', index, source })
              }}
            >
              {content}
            </button>
          )
        }
        return (
          <a key={result.id || `${result.url}-${index}`} href={result.url} target="_blank" rel="noopener noreferrer" className="block">
            {content}
          </a>
        )
      })}

      {filtered.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">No results in this source group.</p>
      )}
      <div className="flex items-center justify-center gap-2 py-2 font-mono text-[9px] uppercase tracking-[0.13em] text-muted-foreground/65">
        <FolderOpen className="size-3" /> {searchMeta ? searchMeta.available.web + searchMeta.available.local + searchMeta.available.history : visibleResults.length} candidates fused privately
      </div>
    </div>
  )
}
