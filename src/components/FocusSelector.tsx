import { memo } from 'react'
import { useAppStore, type FocusMode } from '@/stores/app-store'
import { cn } from '@/lib/utils'

const MODES: { value: FocusMode; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'news', label: 'News' },
  { value: 'academic', label: 'Academic' },
  { value: 'videos', label: 'Videos' },
  { value: 'images', label: 'Images' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'x', label: 'X' },
  { value: 'social', label: 'Social' },
  { value: 'code', label: 'Code' },
]

export const FocusSelector = memo(function FocusSelector() {
  const focusMode = useAppStore((s) => s.focusMode)
  const setFocusMode = useAppStore((s) => s.setFocusMode)

  return (
    <div className="flex flex-wrap gap-2">
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          onClick={() => setFocusMode(m.value)}
          className={cn(
            'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
            focusMode === m.value
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border/60 hover:bg-accent hover:border-accent-foreground/20'
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
})
