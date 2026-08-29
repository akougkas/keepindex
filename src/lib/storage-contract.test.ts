import { describe, expect, it } from 'bun:test'
import {
  CLIENT_STORAGE_KEYS,
  KEEPINDEX_STORAGE_KEYS,
  clearKeepIndexClientStorage,
} from './storage-contract'

class MemoryStorage implements Storage {
  protected readonly values = new Map<string, string>()

  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

describe('KeepIndex browser storage contract', () => {
  it('defines the exact public storage keys', () => {
    expect(KEEPINDEX_STORAGE_KEYS).toEqual({
      collections: 'keepindex-collections',
      session: 'keepindex-session',
      chatHistory: 'keepindex-chat-history',
      settings: 'keepindex-settings',
      theme: 'keepindex-theme',
      journey: 'keepindex-journey',
      workspaceRecovery: 'keepindex-workspace-recovery',
    })
  })

  it('exposes every storage key in deterministic order', () => {
    expect(CLIENT_STORAGE_KEYS).toEqual([
      'keepindex-collections',
      'keepindex-session',
      'keepindex-chat-history',
      'keepindex-settings',
      'keepindex-theme',
      'keepindex-journey',
      'keepindex-workspace-recovery',
    ])
  })

  it('uses one unique KeepIndex namespace', () => {
    expect(new Set(CLIENT_STORAGE_KEYS).size).toBe(CLIENT_STORAGE_KEYS.length)
    expect(CLIENT_STORAGE_KEYS.every((key) => key.startsWith('keepindex-'))).toBe(true)
  })

  it('clears every KeepIndex browser-storage surface', () => {
    const storage = new MemoryStorage()
    CLIENT_STORAGE_KEYS.forEach((key) => storage.setItem(key, 'state'))

    clearKeepIndexClientStorage(storage)

    expect(storage.length).toBe(0)
  })

  it('preserves storage owned by other applications', () => {
    const storage = new MemoryStorage()
    storage.setItem('another-app', 'untouched')
    CLIENT_STORAGE_KEYS.forEach((key) => storage.setItem(key, 'state'))

    clearKeepIndexClientStorage(storage)

    expect(storage.getItem('another-app')).toBe('untouched')
    expect(storage.length).toBe(1)
  })

  it('attempts every removal and reports the first failure', () => {
    const attempted: string[] = []
    const firstError = new Error('storage unavailable')
    const storage = {
      removeItem(key: string) {
        attempted.push(key)
        if (key === KEEPINDEX_STORAGE_KEYS.session) throw firstError
        if (key === KEEPINDEX_STORAGE_KEYS.theme) throw new Error('later failure')
      },
    }

    expect(() => clearKeepIndexClientStorage(storage)).toThrow(firstError)
    expect(attempted).toEqual(CLIENT_STORAGE_KEYS)
  })
})

async function runInlineThemeScript(initial: Record<string, string>): Promise<boolean> {
  const html = await Bun.file(new URL('../../index.html', import.meta.url)).text()
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1] ?? '')
    .find((candidate) => candidate.includes(KEEPINDEX_STORAGE_KEYS.theme))
  if (!script) throw new Error('Inline theme bootstrap script was not found.')

  const storage = new MemoryStorage()
  Object.entries(initial).forEach(([key, value]) => storage.setItem(key, value))
  const classes = new Set<string>()
  const documentStub = {
    documentElement: {
      classList: {
        add: (value: string) => classes.add(value),
        remove: (value: string) => classes.delete(value),
      },
    },
  }
  const execute = new Function('localStorage', 'document', script) as (
    localStorage: Storage,
    document: typeof documentStub
  ) => void
  execute(storage, documentStub)
  return classes.has('dark')
}

describe('pre-React KeepIndex theme', () => {
  it('applies saved light mode before React renders', async () => {
    expect(await runInlineThemeScript({ [KEEPINDEX_STORAGE_KEYS.theme]: 'light' })).toBe(false)
  })

  it('applies saved dark mode before React renders', async () => {
    expect(await runInlineThemeScript({ [KEEPINDEX_STORAGE_KEYS.theme]: 'dark' })).toBe(true)
  })

  it('uses the safe dark default for missing or invalid state', async () => {
    expect(await runInlineThemeScript({})).toBe(true)
    expect(await runInlineThemeScript({ [KEEPINDEX_STORAGE_KEYS.theme]: 'invalid' })).toBe(true)
  })
})
