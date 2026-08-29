import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverBrowserHistorySources, readBrowserHistorySource } from './browser-history'
import { createDatabaseService } from './database'

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('private browser-history reader', () => {
  test('reads an isolated Chromium copy, converts timestamps, and excludes unsafe URLs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'keepindex-history-test-'))
    temporaryDirectories.push(directory)
    const historyPath = join(directory, 'History')
    const db = new Database(historyPath)
    db.exec(`
      CREATE TABLE urls (
        id INTEGER PRIMARY KEY,
        url TEXT,
        title TEXT,
        visit_count INTEGER,
        typed_count INTEGER,
        last_visit_time INTEGER
      );
    `)
    const visitedAt = 1_710_000_000_123
    const chromeTime = (visitedAt + 11_644_473_600_000) * 1000
    const insert = db.prepare('INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time) VALUES (?, ?, ?, ?, ?)')
    insert.run('https://docs.example.test/private-search', 'Private Search Notes', 7, 2, chromeTime)
    insert.run('file:///home/user/private.txt', 'Private file', 3, 0, chromeTime)
    db.close()

    const visits = await readBrowserHistorySource({
      path: historyPath,
      browser: 'chrome',
      profile: 'Default',
      platform: 'linux',
    })

    expect(visits).toHaveLength(1)
    expect(visits[0]).toMatchObject({
      browser: 'chrome',
      profile: 'Default',
      url: 'https://docs.example.test/private-search',
      title: 'Private Search Notes',
      visitCount: 7,
      typedCount: 2,
      lastVisitedAt: visitedAt,
    })
    expect(visits[0]?.sourceKey).toStartWith(`chrome\u0000Default\u0000${historyPath}\u0000`)
    expect(visits[0]?.sourceKey).toEndWith('https://docs.example.test/private-search')
  })

  test('indexes history with FTS5, ranks it privately, and clears it without touching the source', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'keepindex-history-index-test-'))
    temporaryDirectories.push(directory)
    const service = createDatabaseService({ path: join(directory, 'keepindex.sqlite') })
    try {
      const imported = await service.upsertBrowserHistory([
        {
          sourceKey: 'chrome-default-private-search',
          browser: 'chrome',
          profile: 'Default',
          url: 'https://docs.example.test/federated-search',
          title: 'Federated private search architecture',
          visitCount: 9,
          typedCount: 3,
          lastVisitedAt: Date.now() - 86_400_000,
        },
        {
          sourceKey: 'firefox-work-recipes',
          browser: 'firefox',
          profile: 'work',
          url: 'https://food.example.test/recipes',
          title: 'Dinner recipes',
          visitCount: 2,
          typedCount: 0,
          lastVisitedAt: Date.now() - 30 * 86_400_000,
        },
      ])
      expect(imported).toEqual({ imported: 2, total: 2 })
      const matches = await service.searchBrowserHistory('private architecture', 5)
      expect(matches).toHaveLength(1)
      expect(matches[0]?.title).toBe('Federated private search architecture')
      expect((await service.getBrowserHistoryStatus()).entryCount).toBe(2)

      await service.clearBrowserHistory()
      expect((await service.getBrowserHistoryStatus()).indexed).toBe(false)
      expect(await service.searchBrowserHistory('private architecture', 5)).toEqual([])
    } finally {
      service.close()
    }
  })

  test('uses only the canonical configured history path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'keepindex-history-config-test-'))
    temporaryDirectories.push(directory)
    const canonicalPath = join(directory, 'canonical-History')
    const alternatePath = join(directory, 'alternate-History')
    const unrelatedPath = join(directory, 'unrelated-History')
    for (const path of [canonicalPath, alternatePath, unrelatedPath]) {
      const database = new Database(path, { create: true })
      database.close()
    }

    const sources = await discoverBrowserHistorySources({
      KEEPINDEX_BROWSER_HISTORY_PATHS: canonicalPath,
      APP_BROWSER_HISTORY_PATHS: alternatePath,
      BROWSER_HISTORY_PATHS: unrelatedPath,
    })

    expect(sources.some((source) => source.path === canonicalPath)).toBe(true)
    expect(sources.some((source) => source.path === alternatePath)).toBe(false)
    expect(sources.some((source) => source.path === unrelatedPath)).toBe(false)
  })
})
