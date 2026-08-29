import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { User, Sparkles } from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import { useSettingsStore } from '@/stores/settings-store'
import { ThinkingVisualizer } from '@/components/ThinkingVisualizer'
import { QueryVitals } from '@/components/QueryVitals'
import { cn } from '@/lib/utils'

function StreamingDots() {
  return (
    <span className="inline-flex items-center gap-0.5 ml-1" aria-hidden>
      <span
        className="size-1.5 rounded-full bg-primary"
        style={{ animation: 'bounce-dot 1.4s ease-in-out 0s infinite both' }}
      />
      <span
        className="size-1.5 rounded-full bg-primary"
        style={{ animation: 'bounce-dot 1.4s ease-in-out 0.2s infinite both' }}
      />
      <span
        className="size-1.5 rounded-full bg-primary"
        style={{ animation: 'bounce-dot 1.4s ease-in-out 0.4s infinite both' }}
      />
    </span>
  )
}

export function ChatPanel() {
  const chatMessages = useAppStore((s) => s.chatMessages)
  const isChatStreaming = useAppStore((s) => s.isChatStreaming)
  const isThinking = useAppStore((s) => s.isThinking)
  const chatThinking = useAppStore((s) => s.chatThinking)
  const chatMetrics = useAppStore((s) => s.chatMetrics)
  const showThinking = useSettingsStore((s) => s.showThinking)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, chatThinking])

  if (chatMessages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
        Start a conversation. Ask anything.
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
      <AnimatePresence initial={false}>
        {chatMessages.map((msg, idx) => {
          const msgThinking = chatThinking[msg.id]
          const isLastMessage = idx === chatMessages.length - 1
          const isMsgThinking = isLastMessage && isThinking

          return (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className={cn(
                'flex gap-3',
                msg.role === 'user' ? 'justify-end' : 'justify-start'
              )}
            >
              {msg.role === 'assistant' && (
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary mt-1">
                  <Sparkles className="size-4" />
                </div>
              )}
              <div
                className={cn(
                  'max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 space-y-2',
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card border border-border/60 shadow-sm'
                )}
              >
                {msg.role === 'user' ? (
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">
                    {msg.content}
                  </p>
                ) : (
                  <>
                    {showThinking && (msgThinking || isMsgThinking) && (
                      <ThinkingVisualizer
                        thinking={msgThinking || ''}
                        isThinking={isMsgThinking}
                        className="mb-2"
                      />
                    )}
                    {msg.content ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none [&_a]:text-primary [&_a]:hover:underline">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content}
                        </ReactMarkdown>
                        {isChatStreaming && isLastMessage && !isMsgThinking && (
                          <StreamingDots />
                        )}
                      </div>
                    ) : isChatStreaming && isLastMessage ? (
                      <div className="text-xs text-muted-foreground italic flex items-center gap-1.5">
                        <Sparkles className="size-3 text-primary animate-spin" />
                        Generating response...
                      </div>
                    ) : null}
                    {chatMetrics[msg.id] && <QueryVitals metrics={chatMetrics[msg.id]} className="mt-2" />}
                  </>
                )}
              </div>
              {msg.role === 'user' && (
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground mt-1">
                  <User className="size-4" />
                </div>
              )}
            </motion.div>
          )
        })}
      </AnimatePresence>
      <div ref={bottomRef} />
    </div>
  )
}
