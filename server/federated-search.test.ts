import { describe, expect, test } from 'bun:test'
import { fuseFederatedSearch, normalizeSearchTarget, type FederatedSearchResult } from './federated-search'

function result(kind: FederatedSearchResult['kind'], id: string, overrides: Partial<FederatedSearchResult> = {}): FederatedSearchResult {
  return {
    id,
    kind,
    title: id,
    url: kind === 'web' || kind === 'history' ? `https://example.com/${id}` : '',
    snippet: `${id} result`,
    score: 1,
    nativeRank: 1,
    sourceTypes: [kind],
    ...(kind !== 'web' && kind !== 'history' ? { filePath: `/notes/${id}.md` } : {}),
    ...overrides,
  }
}

describe('federated search targets', () => {
  test('normalizes only supported private and public targets', () => {
    expect(normalizeSearchTarget('vault')).toBe('vault')
    expect(normalizeSearchTarget('history')).toBe('history')
    expect(normalizeSearchTarget('unknown')).toBe('all')
  })
})

describe('weighted reciprocal-rank fusion', () => {
  test('keeps an exact top web result above an uncorroborated top local result', () => {
    const fused = fuseFederatedSearch({
      web: [result('web', 'official')],
      local: [result('note', 'incidental')],
      history: [],
    }, 5)
    expect(fused.results.map((item) => item.id)).toEqual(['official', 'incidental'])
  })

  test('deduplicates a live result with browser history and preserves private signals', () => {
    const url = 'https://example.com/guide?utm_source=test'
    const fused = fuseFederatedSearch({
      web: [result('web', 'live', { url, snippet: 'Useful live snippet' })],
      local: [],
      history: [result('history', 'visited', {
        url: 'http://www.example.com/guide',
        browser: 'chrome',
        profile: 'Default',
        visitCount: 12,
        lastVisitedAt: 1_700_000_000_000,
      })],
    }, 5)
    expect(fused.results).toHaveLength(1)
    expect(fused.results[0]).toMatchObject({
      kind: 'web',
      visitCount: 12,
      browser: 'chrome',
      sourceTypes: ['history', 'web'],
    })
    expect(fused.counts).toEqual({ web: 1, local: 0, history: 1, total: 1 })
  })

  test('caps one host and one file before backfilling', () => {
    const web = Array.from({ length: 5 }, (_, index) => result('web', `web-${index}`, {
      url: `https://same.example/page-${index}`,
    }))
    const local = Array.from({ length: 3 }, (_, index) => result('note', `note-${index}`, {
      filePath: '/vault/same.md',
      startLine: index * 10 + 1,
      endLine: index * 10 + 5,
    }))
    const fused = fuseFederatedSearch({ web, local, history: [] }, 6, { localWeight: 1 })
    expect(fused.results.filter((item) => item.kind === 'web')).toHaveLength(3)
    expect(fused.results.filter((item) => item.kind === 'note')).toHaveLength(3)
  })
})
