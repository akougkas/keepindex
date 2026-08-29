import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Brain, ChevronDown, ChevronRight, Sparkles } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

interface ThinkingVisualizerProps {
  thinking: string
  isThinking: boolean
  className?: string
  defaultOpen?: boolean
}

export function ThinkingVisualizer({
  thinking,
  isThinking,
  className,
  defaultOpen,
}: ThinkingVisualizerProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen ?? isThinking)
  const [startTime, setStartTime] = useState<number | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  // Auto-expand when thinking starts, track elapsed time
  useEffect(() => {
    if (isThinking) {
      if (!startTime) setStartTime(Date.now())
      setIsOpen(true)
      const interval = setInterval(() => {
        if (startTime) {
          setElapsedSeconds(Math.max(1, Math.round((Date.now() - startTime) / 1000)))
        }
      }, 500)
      return () => clearInterval(interval)
    } else if (startTime) {
      setElapsedSeconds(Math.max(1, Math.round((Date.now() - startTime) / 1000)))
    }
  }, [isThinking, startTime])

  if (!thinking && !isThinking) return null

  const wordCount = thinking.trim().split(/\s+/).filter(Boolean).length

  return (
    <div
      className={cn(
        'rounded-xl border border-border/60 bg-muted/30 backdrop-blur-sm overflow-hidden transition-all duration-200',
        isThinking && 'border-primary/40 shadow-[0_0_15px_-5px_var(--primary)]',
        className
      )}
    >
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between px-3.5 py-2.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={cn(
              'size-5 rounded-full flex items-center justify-center shrink-0 transition-colors',
              isThinking ? 'bg-primary/20 text-primary animate-pulse' : 'bg-muted text-muted-foreground'
            )}
          >
            <Brain className="size-3" />
          </div>
          <span className="font-medium truncate">
            {isThinking ? 'Reasoning in progress...' : 'Thought process'}
          </span>
          <span className="text-[11px] text-muted-foreground/80 px-1.5 py-0.5 rounded bg-muted/60 font-mono">
            {wordCount} words {elapsedSeconds > 0 ? `· ${elapsedSeconds}s` : ''}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isThinking && (
            <span className="flex items-center gap-1 text-[11px] text-primary font-medium">
              <Sparkles className="size-3 animate-spin" />
              Thinking
            </span>
          )}
          {isOpen ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden border-t border-border/40"
          >
            <div className="p-3.5 max-h-60 overflow-y-auto font-mono text-xs leading-relaxed text-muted-foreground/90 prose prose-xs dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{thinking}</ReactMarkdown>
              {isThinking && (
                <span
                  className="inline-block ml-1 size-1.5 rounded-full bg-primary animate-ping"
                  aria-hidden
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
