import { describe, expect, it } from 'bun:test'
import { CORRECTNESS_CORPUS, CORRECTNESS_CORPUS_AS_OF } from './correctness-corpus'

describe('live correctness corpus contract', () => {
  it('contains exactly one runnable case for each requested category', () => {
    expect(CORRECTNESS_CORPUS).toHaveLength(5)
    expect(new Set(CORRECTNESS_CORPUS.map((entry) => entry.id)).size).toBe(5)
    expect(CORRECTNESS_CORPUS.map((entry) => entry.category).sort()).toEqual([
      'deep-research',
      'local-web-fusion',
      'timely-recent',
      'tricky-complex',
      'world-knowledge',
    ])
  })

  it('freezes all date-sensitive expectations and requires terminal evidence events', () => {
    for (const entry of CORRECTNESS_CORPUS) {
      expect(entry.asOf).toBe(CORRECTNESS_CORPUS_AS_OF)
      expect(entry.query.trim().length).toBeGreaterThan(20)
      expect(entry.expectations.maxSources).toBe(18)
      expect(entry.expectations.requiredEventTypes).toContain('sources')
      expect(entry.expectations.requiredEventTypes).toContain('done')
      expect(entry.expectations.minCitationCoveragePct).toBeGreaterThanOrEqual(80)
    }
  })

  it('accepts semantically equivalent research heading levels and index-cost terminology', () => {
    const research = CORRECTNESS_CORPUS.find((entry) => entry.id === 'research-chunking')!
    const patternFor = (needle: string) => research.expectations.answerPatterns.find(
      (pattern) => pattern.includes(needle)
    )!
    const matches = (pattern: string, value: string) => new RegExp(pattern, 'is').test(value)

    expect(matches(patternFor('Executive Summary'), '# Executive Summary')).toBe(true)
    expect(matches(patternFor('Key Findings'), '# Key Findings & Core Analysis')).toBe(true)
    expect(matches(patternFor('Technical Details'), '## Technical Details & Evidence Comparison')).toBe(true)
    expect(matches(patternFor('Open Questions'), '## Open Questions & Future Outlook')).toBe(true)
    expect(matches(patternFor('Executive Summary'), '### Executive Summary')).toBe(false)

    const indexPattern = patternFor('index (?:size|cost)')
    for (const wording of [
      'index size',
      'index cost',
      'storage per token',
      'embedding dimension',
    ]) expect(matches(indexPattern, wording)).toBe(true)

    const universalPattern = patternFor('not universal')
    for (const wording of [
      'The best method is not universal.',
      'No single chunking policy is optimal.',
      'There is no universal winner.',
      'The evidence cannot support a definitive recommendation.',
      'Quality rankings across the four methods are not established for BM25.',
    ]) expect(matches(universalPattern, wording)).toBe(true)
  })

  it('rejects treating a known superseded Bun release as a current conflict', () => {
    const bunCase = CORRECTNESS_CORPUS.find((entry) => entry.id === 'recent-bun-release')
    const forbidden = bunCase?.expectations.forbiddenAnswerPatterns ?? []
    const isForbidden = (answer: string): boolean => forbidden.some((pattern) =>
      new RegExp(pattern, 'is').test(answer)
    )

    expect(isForbidden(
      'A third-party site claims 1.3.14 is latest; this is an older, superseded version and conflicts with the current 1.4.0 release.'
    )).toBe(true)
    expect(isForbidden(
      'A third-party site lists 1.3.14, but it is an older, superseded release.'
    )).toBe(false)
    expect(isForbidden(
      'One record says August 19 while the primary ledger says August 20; that date claim conflicts with the primary record.'
    )).toBe(false)
  })

  it('accepts explicit equivalent wording for non-independent fusion provenance', () => {
    const fusion = CORRECTNESS_CORPUS.find((entry) => entry.id === 'fusion-anthropic-agents')!
    const provenancePattern = fusion.expectations.answerPatterns.find(
      (pattern) => pattern.includes('same[- ]origin')
    )!
    const matches = (value: string) => new RegExp(provenancePattern, 'is').test(value)

    expect(matches('The clipping and live page are same-origin renderings.')).toBe(true)
    expect(matches('They corroborate rather than independently confirm each other.')).toBe(true)
    expect(matches('They cannot serve as mutually independent corroboration.')).toBe(true)
    expect(matches('These are two independent sources.')).toBe(false)
  })
})
