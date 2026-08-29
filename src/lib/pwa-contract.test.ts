import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createId } from './utils'

const projectFile = (path: string) => resolve(process.cwd(), path)

describe('KeepIndex PWA identity', () => {
  test('uses one consistent install identity and production icon set', async () => {
    const manifest = JSON.parse(await readFile(projectFile('public/manifest.webmanifest'), 'utf8')) as {
      name: string
      short_name: string
      description: string
      icons: Array<{ src: string; sizes: string; purpose: string }>
    }

    expect(manifest.name).toBe('KeepIndex — Private, local-first federated search')
    expect(manifest.short_name).toBe('KeepIndex')
    expect(manifest.description).toBe('Search your world. Keep it yours.')
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: '/keepindex-icon.svg', sizes: 'any' }),
      expect.objectContaining({ src: '/icons/keepindex-192.png', sizes: '192x192' }),
      expect.objectContaining({ src: '/icons/keepindex-512.png', sizes: '512x512' }),
      expect.objectContaining({ src: '/icons/keepindex-maskable-512.png', purpose: 'maskable' }),
    ]))
  })

  test('starts at a clean v1 and deletes every cache outside the current namespace', async () => {
    const source = await readFile(projectFile('public/sw.js'), 'utf8')
    expect(source).toContain("const CACHE_NAME = 'keepindex-shell-v1'")
    expect(source).toContain('keys.filter((key) => key !== CACHE_NAME)')
    expect(source).not.toContain('startsWith(CACHE_NAME)')
  })

  test('activation actually deletes every stale cache and retains the current shell', async () => {
    const source = await readFile(projectFile('public/sw.js'), 'utf8')
    const listeners = new Map<string, (event: { waitUntil(promise: Promise<unknown>): void }) => void>()
    const deleted: string[] = []
    let claimed = false
    const worker = {
      addEventListener(type: string, handler: (event: { waitUntil(promise: Promise<unknown>): void }) => void) {
        listeners.set(type, handler)
      },
      skipWaiting() {},
      clients: { claim() { claimed = true } },
    }
    const cacheStorage = {
      async keys() { return ['stale-shell-v9', 'keepindex-shell-v1', 'unrelated-cache'] },
      async delete(key: string) { deleted.push(key); return true },
    }

    new Function('self', 'caches', source)(worker, cacheStorage)
    let activation = Promise.resolve()
    listeners.get('activate')?.({ waitUntil(promise) { activation = Promise.resolve(promise) } })
    await activation

    expect(deleted.sort()).toEqual(['stale-shell-v9', 'unrelated-cache'])
    expect(claimed).toBe(true)
  })

  test('keeps plain LAN HTTP usable when service-worker registration is unavailable', async () => {
    const source = await readFile(projectFile('src/main.tsx'), 'utf8')
    expect(source).toContain("navigator.serviceWorker.register('/sw.js').catch")
  })
})

describe('LAN-safe client identifiers', () => {
  test('keeps working when secure-context randomUUID is unavailable', () => {
    const cryptoWithoutRandomUuid = {
      randomUUID: undefined,
      getRandomValues<T extends ArrayBufferView | null>(array: T): T {
        if (array instanceof Uint8Array) array.fill(0x2a)
        return array
      },
    } as unknown as Pick<Crypto, 'randomUUID' | 'getRandomValues'>

    expect(createId(cryptoWithoutRandomUuid)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})
