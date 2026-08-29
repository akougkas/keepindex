import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import { Pin, X } from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import type { PinnedResult } from '@/stores/app-store'
import { PanelShell } from '@/components/PanelShell'
import { Button } from '@/components/ui/button'
import { markdownComponents, remarkCitations } from '@/lib/markdown-components'
import { cn } from '@/lib/utils'

function createCitationHandler(
  sources: PinnedResult['sources'],
  localSources: PinnedResult['localSources']
) {
  return (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest('[data-citation]')
    if (!target) return
    const raw = target.getAttribute('data-citation')
    if (!raw) return

    const { setSourcePreview } = useAppStore.getState()

    if (raw.startsWith('L')) {
      const n = parseInt(raw.slice(1), 10)
      if (n < 1 || n > 99) return
      const index = n - 1
      if (index >= localSources.length) return
      setSourcePreview({ type: 'local', index, source: localSources[index] })
    } else {
      const n = parseInt(raw, 10)
      if (n < 1 || n > 99) return
      const index = n - 1
      if (index >= sources.length) return
      setSourcePreview({ type: 'web', index, source: sources[index] })
    }
  }
}

interface PinnedPanelProps {
  pinned: PinnedResult
  onUnpin: () => void
  className?: string
}

export function PinnedPanel({ pinned, onUnpin, className }: PinnedPanelProps) {
  const { query, answer, sources, localSources, mode } = pinned

  const handleCitationClick = createCitationHandler(sources, localSources)
  const webCount = sources.length
  const localCount = localSources.length
  const wordCount = answer.trim().split(/\s+/).filter(Boolean).length
  const sourceLabel =
    webCount > 0 && localCount > 0
      ? `${webCount} web · ${localCount} local`
      : webCount > 0
        ? `${webCount} web`
        : localCount > 0
          ? `${localCount} local`
          : '0 sources'

  const truncatedQuery = query.length > 40 ? `${query.slice(0, 40)}…` : query

  return (
    <PanelShell
      title="Pinned"
      className={cn('border-l-2 border-l-primary/50', className)}
      headerActions={
        <div className="flex items-center gap-2 w-full">
          <Pin className="size-3.5 text-muted-foreground shrink-0" />
          <span className="truncate text-sm text-foreground/90 min-w-0" title={query}>
            {truncatedQuery}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onUnpin}
            title="Unpin"
            className="shrink-0 ml-auto"
          >
            <X className="size-4" />
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div
          className="prose prose-sm dark:prose-invert max-w-none"
          onClick={handleCitationClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              const target = (e.target as HTMLElement).closest('[data-citation]')
              if (target) {
                e.preventDefault()
                ;(target as HTMLElement).click()
              }
            }
          }}
          role="application"
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath, remarkCitations]}
            rehypePlugins={[rehypeKatex]}
            components={markdownComponents}
          >
            {answer}
          </ReactMarkdown>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground pt-2 border-t border-border/50">
          <span>{sourceLabel}</span>
          <span>·</span>
          <span>{wordCount} words</span>
          <span>·</span>
          <span
            className={cn(
              'px-1.5 py-0.5 rounded text-[10px] font-medium uppercase',
              mode === 'ai' ? 'bg-primary/20 text-primary' : 'bg-accent/50 text-accent-foreground'
            )}
          >
            {mode === 'ai' ? 'AI' : 'Research'}
          </span>
        </div>
      </div>
    </PanelShell>
  )
}
