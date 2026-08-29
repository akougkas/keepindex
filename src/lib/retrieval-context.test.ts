import { describe, expect, it } from 'bun:test'
import { extendRetrievalContext } from './retrieval-context'

describe('continued retrieval context', () => {
  it('keeps the root topic through multiple pronoun follow-ups', () => {
    const first = extendRetrievalContext('SQLite WAL versus rollback journals', 'How does it compare?')
    const second = extendRetrievalContext(first, 'What about write contention?')

    expect(second).toBe(
      'SQLite WAL versus rollback journals How does it compare? What about write contention?'
    )
    expect(second).toContain('SQLite WAL versus rollback journals')
  })

  it('preserves the root and newest question under the request-size bound', () => {
    const result = extendRetrievalContext(`root-topic ${'old '.repeat(400)}`, 'newest follow-up')
    expect(result.length).toBeLessThanOrEqual(1000)
    expect(result).toStartWith('root-topic')
    expect(result).toEndWith('newest follow-up')
  })
})
