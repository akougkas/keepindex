import { describe, expect, it } from 'bun:test'
import { rankHistorySuggestions } from './history-suggestions'

describe('history suggestions', () => {
  it('preserves frequency order while promoting prefix matches over substrings', () => {
    const frequencyRanked = [
      'Compare SQLite WAL modes',
      'SQLite backup safety',
      'WAL checkpoint tuning',
      'SQLite WAL durability',
    ]

    expect(rankHistorySuggestions(frequencyRanked, 'sqlite')).toEqual([
      'SQLite backup safety',
      'SQLite WAL durability',
      'Compare SQLite WAL modes',
    ])
  })

  it('returns the frequency-ranked head when the input is empty', () => {
    expect(rankHistorySuggestions(['third query', 'second query', 'first query'], '', 2))
      .toEqual(['third query', 'second query'])
  })
})
