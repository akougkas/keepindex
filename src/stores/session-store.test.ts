import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { sessionMutationQueue } from '@/lib/mutation-queue'
import { useSessionStore } from './session-store'

const originalFetch = globalThis.fetch

function jsonResponse(
  body: unknown,
  init: ResponseInit = {}
): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

async function drainSessionMutations(): Promise<void> {
  await sessionMutationQueue.runAfterPending(async () => undefined)
}

beforeEach(async () => {
  await drainSessionMutations()
  useSessionStore.setState({
    lastQuery: '',
    lastMode: 'ai',
    lastFocusMode: 'all',
    lastAnswer: '',
    lastSources: [],
    lastLocalSources: [],
    searchHistory: [],
    serverRevision: 0,
    sessionConflict: null,
  })
})

afterEach(async () => {
  await drainSessionMutations()
  globalThis.fetch = originalFetch
})

describe('shared-session revisions', () => {
  it('hydrates the server revision and advances it with If-Match after a save', async () => {
    let saveInit: RequestInit | undefined
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
      if (url === '/api/history?limit=50') {
        return jsonResponse({ history: [] })
      }
      if (url === '/api/session' && !init?.method) {
        return jsonResponse(
          {
            session: {
              lastQuery: 'Remote query',
              lastMode: 'ai',
              lastFocusMode: 'all',
              lastAnswer: 'Remote answer',
              lastSources: [],
              lastLocalSources: [],
            },
            revision: 4,
            updatedAt: 123,
          },
          { headers: { ETag: '"shared-session-4"' } }
        )
      }
      if (url === '/api/session' && init?.method === 'PUT') {
        saveInit = init
        return jsonResponse(
          { saved: true, revision: 5, updatedAt: 456 },
          { headers: { ETag: '"shared-session-5"' } }
        )
      }
      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as typeof fetch

    await useSessionStore.getState().hydrateFromServer()

    expect(useSessionStore.getState().lastQuery).toBe('Remote query')
    expect(useSessionStore.getState().serverRevision).toBe(4)

    useSessionStore.getState().setLastSession({
      query: 'Locally edited query',
      mode: 'research',
      focusMode: 'academic',
      answer: 'Locally edited answer',
    })
    await drainSessionMutations()

    expect(new Headers(saveInit?.headers).get('If-Match')).toBe('"shared-session-4"')
    expect(useSessionStore.getState().serverRevision).toBe(5)
    expect(useSessionStore.getState().sessionConflict).toBeNull()
  })

  it('surfaces a stale-write conflict without replacing the optimistic local edit', async () => {
    let saveInit: RequestInit | undefined
    useSessionStore.setState({ serverRevision: 11 })
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      saveInit = init
      return jsonResponse(
        {
          error: 'session revision conflict',
          revision: 12,
          updatedAt: 789,
          session: {
            lastQuery: 'Changed on another client',
            lastMode: 'search',
            lastFocusMode: 'news',
            lastAnswer: 'Remote answer',
            lastSources: [],
            lastLocalSources: [],
          },
        },
        { status: 412, headers: { ETag: '"shared-session-12"' } }
      )
    }) as typeof fetch

    useSessionStore.getState().setLastSession({
      query: 'My unsaved local edit',
      mode: 'ai',
      focusMode: 'code',
      answer: 'Keep this local answer',
    })
    await drainSessionMutations()

    const state = useSessionStore.getState()
    expect(new Headers(saveInit?.headers).get('If-Match')).toBe('"shared-session-11"')
    expect(state.lastQuery).toBe('My unsaved local edit')
    expect(state.lastAnswer).toBe('Keep this local answer')
    expect(state.serverRevision).toBe(11)
    expect(state.sessionConflict).toContain('revision 12')
  })

  it('protects a shared-session clear with the current revision', async () => {
    let clearInit: RequestInit | undefined
    useSessionStore.setState({
      lastQuery: 'Clear me',
      lastAnswer: 'Existing answer',
      serverRevision: 20,
    })
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      clearInit = init
      return jsonResponse(
        { cleared: true, revision: 21, updatedAt: 900 },
        { headers: { ETag: '"shared-session-21"' } }
      )
    }) as typeof fetch

    useSessionStore.getState().clearLastSession()
    await drainSessionMutations()

    const state = useSessionStore.getState()
    expect(clearInit?.method).toBe('DELETE')
    expect(new Headers(clearInit?.headers).get('If-Match')).toBe('"shared-session-20"')
    expect(state.lastQuery).toBe('')
    expect(state.lastAnswer).toBe('')
    expect(state.serverRevision).toBe(21)
  })
})
