import { afterAll, describe, expect, it } from 'bun:test'
import { CLIENT_STORAGE_KEYS } from '@/lib/storage-contract'
import { useSettingsStore } from './settings-store'

const originalFetch = globalThis.fetch
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

afterAll(() => {
  globalThis.fetch = originalFetch
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('factory reset', () => {
  it('deletes the durable query ledger along with the shared stores', async () => {
    const requests: Array<{ url: string; method: string; ifMatch: string | null }> = []
    const removedKeys: string[] = []
    let reloaded = false
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { reload: () => { reloaded = true } } },
    })
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { removeItem: (key: string) => { removedKeys.push(key) } },
    })
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const headers = new Headers(init?.headers)
      requests.push({ url, method: init?.method ?? 'GET', ifMatch: headers.get('If-Match') })
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    await useSettingsStore.getState().resetAll()

    expect(requests).toContainEqual({ url: '/api/queries', method: 'DELETE', ifMatch: null })
    expect(requests).toContainEqual({ url: '/api/session', method: 'DELETE', ifMatch: '*' })
    expect(new Set(removedKeys)).toEqual(new Set(CLIENT_STORAGE_KEYS))
    expect(reloaded).toBe(true)
  })

  it('keeps browser data intact and does not reload when a server delete fails', async () => {
    const removedKeys: string[] = []
    let reloaded = false
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { reload: () => { reloaded = true } } },
    })
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { removeItem: (key: string) => { removedKeys.push(key) } },
    })
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return new Response('{}', {
        status: url === '/api/queries' ? 500 : 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    await expect(useSettingsStore.getState().resetAll()).rejects.toThrow('No browser data was cleared')
    expect(removedKeys).toEqual([])
    expect(reloaded).toBe(false)
  })
})
