import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { KEEPINDEX_STORAGE_KEYS } from '@/lib/storage-contract'
import { useAppStore, type ChatMessage } from './app-store'
import { createId } from '@/lib/utils'

function safeStorage() {
  return {
    getItem: (name: string) => {
      try {
        return localStorage.getItem(name)
      } catch {
        return null
      }
    },
    setItem: (name: string, value: string) => {
      try {
        localStorage.setItem(name, value)
      } catch (e) {
        if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)) {
          useAppStore.setState({ error: 'Storage full. Remove some saved items.' })
        }
      }
    },
    removeItem: (name: string) => {
      try {
        localStorage.removeItem(name)
      } catch {
        /* ignore */
      }
    },
  }
}

function deriveTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user')?.content ?? ''
  return first.length > 60 ? first.slice(0, 60) + '…' : first || 'New conversation'
}

export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

interface ChatHistoryState {
  conversations: Conversation[]
  activeConversationId: string | null
  saveConversation: (messages: ChatMessage[]) => void
  loadConversation: (id: string) => void
  deleteConversation: (id: string) => void
  newConversation: () => void
  renameConversation: (id: string, title: string) => void
}

const MAX_CONVERSATIONS = 50

export const useChatHistoryStore = create<ChatHistoryState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeConversationId: null,

      saveConversation: (messages) => {
        if (messages.length === 0) return
        const { activeConversationId, conversations } = get()
        const now = Date.now()
        const title = deriveTitle(messages)

        if (activeConversationId) {
          const idx = conversations.findIndex((c) => c.id === activeConversationId)
          if (idx >= 0) {
            const updated = [...conversations]
            updated[idx] = {
              ...updated[idx],
              messages: [...messages],
              title,
              updatedAt: now,
            }
            set({ conversations: updated })
            return
          }
        }

        const newConv: Conversation = {
          id: createId(),
          title,
          messages: [...messages],
          createdAt: now,
          updatedAt: now,
        }
        const next = [newConv, ...conversations].slice(0, MAX_CONVERSATIONS)
        set({ conversations: next, activeConversationId: newConv.id })
      },

      loadConversation: (id) => {
        useAppStore.getState().abortActiveRequests()
        const conv = get().conversations.find((c) => c.id === id)
        if (!conv) return
        set({ activeConversationId: id })
        const lastUserQuery =
          [...conv.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
        useAppStore.setState({
          chatMessages: [...conv.messages],
          chatThinking: {},
          chatMetrics: {},
          query: lastUserQuery || useAppStore.getState().query,
          error: null,
        })
      },

      deleteConversation: (id) => {
        const { activeConversationId, conversations } = get()
        const next = conversations.filter((c) => c.id !== id)
        set({ conversations: next })
        if (activeConversationId === id) {
          useAppStore.getState().abortActiveRequests()
          set({ activeConversationId: null })
          useAppStore.setState({ chatMessages: [], chatThinking: {}, chatMetrics: {}, query: '' })
        }
      },

      newConversation: () => {
        useAppStore.getState().abortActiveRequests()
        set({ activeConversationId: null })
        useAppStore.setState({ chatMessages: [], chatThinking: {}, chatMetrics: {}, query: '' })
      },

      renameConversation: (id, title) => {
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, title: title.trim() || c.title, updatedAt: Date.now() } : c
          ),
        }))
      },
    }),
    { name: KEEPINDEX_STORAGE_KEYS.chatHistory, storage: createJSONStorage(() => safeStorage()) }
  )
)
