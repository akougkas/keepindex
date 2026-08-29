import { describe, expect, it } from 'bun:test'
import {
  collectionMatchesSearch,
  formatSearchCollectionSnapshot,
  type CollectionItem,
} from './collections-store'

const source = {
  title: 'SQLite write-ahead logging',
  url: 'https://sqlite.org/wal.html',
  snippet: 'Readers and writers can overlap under WAL mode.',
}

describe('search collections', () => {
  it('stores readable result content instead of a count-only placeholder', () => {
    const snapshot = formatSearchCollectionSnapshot('SQLite concurrency', [source])
    expect(snapshot).toContain('# Search snapshot: SQLite concurrency')
    expect(snapshot).toContain('SQLite write-ahead logging')
    expect(snapshot).toContain('https://sqlite.org/wal.html')
    expect(snapshot).toContain('Readers and writers can overlap')
  })

  it('matches saved answer text and source content as well as the query', () => {
    const item: CollectionItem = {
      id: 'saved-search',
      query: 'database modes',
      answer: formatSearchCollectionSnapshot('database modes', [source]),
      sources: [source],
      mode: 'search',
      createdAt: 1,
    }
    expect(collectionMatchesSearch(item, 'write-ahead')).toBe(true)
    expect(collectionMatchesSearch(item, 'overlap')).toBe(true)
    expect(collectionMatchesSearch(item, 'unrelated phrase')).toBe(false)
  })
})
