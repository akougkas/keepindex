import { useState, useCallback } from 'react'
import { Plus, Search, MessageSquare, Pencil, Trash2, FlaskConical, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAppStore } from '@/stores/app-store'
import { useChatHistoryStore } from '@/stores/chat-history-store'
import { useJourneyStore } from '@/stores/journey-store'
import { buildChatMarkdown, slugifyTopic } from '@/lib/chat-export'
import { cn } from '@/lib/utils'

function buildConversationHandoffContext(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): string {
  const recent = messages
    .filter((m) => m.content.trim().length > 0)
    .slice(-8)
    .map((m) => ({
      role: m.role === 'user' ? 'User' : 'Assistant',
      content: m.content.replace(/\s+/g, ' ').trim().slice(0, 500),
    }))
  if (recent.length === 0) return ''
  return ['Recent chat context (reference only):', ...recent.map((m) => `- ${m.role}: ${m.content}`)].join('\n')
}

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

export function ChatContextPanel() {
  const chatMessages = useAppStore((s) => s.chatMessages)
  const setMode = useAppStore((s) => s.setMode)
  const streamAnswer = useAppStore((s) => s.streamAnswer)
  const startResearch = useAppStore((s) => s.startResearch)

  const conversations = useChatHistoryStore((s) => s.conversations)
  const activeConversationId = useChatHistoryStore((s) => s.activeConversationId)
  const newConversation = useChatHistoryStore((s) => s.newConversation)
  const loadConversation = useChatHistoryStore((s) => s.loadConversation)
  const deleteConversation = useChatHistoryStore((s) => s.deleteConversation)
  const renameConversation = useChatHistoryStore((s) => s.renameConversation)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const lastUserMessage = [...chatMessages].reverse().find((m) => m.role === 'user')?.content

  const handleSearchWeb = useCallback(() => {
    const query = lastUserMessage ?? chatMessages.find((m) => m.role === 'user')?.content ?? ''
    const handoffContext = buildConversationHandoffContext(chatMessages)
    if (query) {
      useJourneyStore.getState().addNode({
        mode: 'ai',
        action: 'handoff_to_ai',
        query,
        metadata: { fromMode: 'chat', contextMessages: Math.min(chatMessages.length, 8) },
      })
      setMode('ai')
      void streamAnswer(query, { handoffContext })
    }
  }, [lastUserMessage, chatMessages, setMode, streamAnswer])

  const handleDeepResearch = useCallback(() => {
    if (!lastUserMessage) return
    const handoffContext = buildConversationHandoffContext(chatMessages)
    useJourneyStore.getState().addNode({
      mode: 'research',
      action: 'handoff_to_research',
      query: lastUserMessage,
      metadata: { fromMode: 'chat', contextMessages: Math.min(chatMessages.length, 8) },
    })
    setMode('research')
    void startResearch(lastUserMessage, { handoffContext })
  }, [lastUserMessage, chatMessages, setMode, startResearch])

  const handleExportChat = useCallback(() => {
    if (chatMessages.length === 0) return
    const { markdown, topic } = buildChatMarkdown(chatMessages)
    const blob = new Blob([markdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `keepindex-chat-${slugifyTopic(topic) || 'conversation'}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [chatMessages])

  const startRename = (conv: { id: string; title: string }) => {
    setEditingId(conv.id)
    setEditValue(conv.title)
  }

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      renameConversation(editingId, editValue.trim())
    }
    setEditingId(null)
    setEditValue('')
  }

  const cancelRename = () => {
    setEditingId(null)
    setEditValue('')
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitRename()
    if (e.key === 'Escape') cancelRename()
  }

  const isEmpty = conversations.length === 0 && chatMessages.length === 0

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <Button
        variant="outline"
        size="sm"
        onClick={newConversation}
        className="w-full justify-start gap-2"
        title="Start a fresh chat conversation"
      >
        <Plus className="size-4" />
        New conversation
      </Button>

      {chatMessages.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportChat}
          className="w-full justify-start gap-2"
          title="Export this conversation as Markdown"
        >
          <Download className="size-4" />
          Export
        </Button>
      )}

      {chatMessages.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleSearchWeb}
          className="w-full justify-start gap-2"
          title="Use this conversation context to generate an AI answer"
        >
          <Search className="size-4" />
          Search the web
        </Button>
      )}

      {chatMessages.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleDeepResearch}
          className="w-full justify-start gap-2"
          title="Run deep research from the latest chat question"
        >
          <FlaskConical className="size-4" />
          Deep Research
        </Button>
      )}

      {conversations.length > 0 && (
        <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-hidden">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground shrink-0">
            HISTORY
          </p>
          <div className="flex-1 overflow-auto space-y-2 pr-1">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => !editingId && loadConversation(conv.id)}
                className={cn(
                  'rounded-lg border p-3 cursor-pointer transition-colors group',
                  activeConversationId === conv.id
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-border/40 hover:border-primary/30 hover:bg-accent/20'
                )}
              >
                {editingId === conv.id ? (
                  <Input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleRenameKeyDown}
                    onBlur={commitRename}
                    onClick={(e) => e.stopPropagation()}
                    className="h-7 text-sm mb-1"
                    autoFocus
                  />
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium line-clamp-1 flex-1 min-w-0">
                        {conv.title}
                      </p>
                      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={(e) => {
                            e.stopPropagation()
                            startRename(conv)
                          }}
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="size-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteConversation(conv.id)
                          }}
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {conv.messages.length} message{conv.messages.length !== 1 ? 's' : ''} ·{' '}
                      {formatRelativeTime(conv.updatedAt)}
                    </p>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {isEmpty && (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center flex-1">
          <MessageSquare className="size-10 opacity-40 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Your conversations will appear here</p>
        </div>
      )}
    </div>
  )
}
