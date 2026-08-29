import { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Trash2, Library } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  collectionMatchesSearch,
  useCollectionsStore,
  type CollectionItem,
} from '@/stores/collections-store'
import { useAppStore } from '@/stores/app-store'
import { cn } from '@/lib/utils'

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(ts).toLocaleDateString()
}

interface CollectionsPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function CollectionsPanel({ isOpen, onClose }: CollectionsPanelProps) {
  const [search, setSearch] = useState('')
  const items = useCollectionsStore((s) => s.items)
  const removeItem = useCollectionsStore((s) => s.removeItem)
  const loadFromCollection = useAppStore((s) => s.loadFromCollection)
  const resetResults = useAppStore((s) => s.resetResults)
  const query = useAppStore((s) => s.query)
  const answer = useAppStore((s) => s.answer)
  const mode = useAppStore((s) => s.mode)
  const researchReport = useAppStore((s) => s.researchReport)

  useEffect(() => {
    if (!isOpen) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  const filtered = useMemo(
    () =>
      items.filter((item) => collectionMatchesSearch(item, search)),
    [items, search]
  )

  const handleLoad = (item: CollectionItem) => {
    loadFromCollection(item)
    onClose()
  }

  const handleRemove = (item: CollectionItem, e: React.MouseEvent) => {
    e.stopPropagation()
    const content = mode === 'research' ? researchReport : answer
    const isViewingThis = item.query === query && item.answer === content
    removeItem(item.id)
    if (isViewingThis) resetResults()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            aria-hidden
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 bottom-0 w-full max-w-[350px] sm:w-[350px] bg-card border-l border-border shadow-2xl z-50 flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-labelledby="collections-dialog-title"
          >
            <div className="shrink-0 p-4 border-b border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Library className="size-5 text-muted-foreground" />
                <h2 id="collections-dialog-title" className="font-semibold">Collections</h2>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close collections">
                <X className="size-4" />
              </Button>
            </div>
            <div className="p-3 border-b border-border/30">
              <Input
                placeholder="Search collections..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="flex-1 overflow-auto p-3">
              {filtered.length === 0 ? (
                <p className="text-muted-foreground text-sm py-8 text-center">
                  {items.length === 0
                    ? 'No saved items yet. Save an answer with the bookmark icon.'
                    : 'No matching items.'}
                </p>
              ) : (
                <div className="space-y-2">
                  {filtered.map((item) => (
                    <motion.div
                      key={item.id}
                      layout
                      className={cn(
                        'rounded-lg border border-border/50 p-3 cursor-pointer transition-colors',
                        'hover:border-primary/40 hover:bg-accent/30'
                      )}
                      onClick={() => handleLoad(item)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          handleLoad(item)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium line-clamp-1 flex-1 min-w-0">
                          {item.query}
                        </p>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={(e) => handleRemove(item, e)}
                          className="shrink-0 h-6 w-6 text-muted-foreground hover:text-destructive"
                          aria-label={`Remove ${item.query} from collections`}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                        {item.answer.slice(0, 100)}
                        {item.answer.length > 100 ? '...' : ''}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs text-muted-foreground">
                          {item.sources.length} source
                          {item.sources.length !== 1 ? 's' : ''}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(item.createdAt)}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
