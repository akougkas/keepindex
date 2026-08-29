/**
 * Citation-coverage inflation.
 *
 * `citationCoveragePct` is the number the UI shows as a grounding badge and the
 * number the research repair loop optimises against. Every case below is one
 * way the current scorer reports coverage that the answer did not earn: an
 * empty denominator graded as perfect, short factual sentences exempted from
 * the denominator, a whole table credited by one row's citation, and two
 * sentences fused because a citation opened the second one.
 *
 * The reverse-direction cases at the end pin what a fix must not break: a
 * genuinely well cited answer stays strong, and Markdown scaffolding stays out
 * of the denominator.
 */
import { describe, expect, it } from 'bun:test'
import { __test__, extractCitationIds } from './index'

const { assessGrounding, collectGroundingClaimSegments, normalizeGroundingProse } = __test__

const segmentsOf = (text: string) => collectGroundingClaimSegments(normalizeGroundingProse(text))

describe('empty claim denominator', () => {
  it('does not report perfect coverage for an answer with nothing gradeable', () => {
    // Every line is exempt: a heading, a question, and an explicit hypothesis.
    // Nothing was graded, so nothing was covered, yet one valid identifier is
    // enough to hard-code the score to 100.
    const answer = [
      '## Open questions',
      '',
      'Which retention window applies to the archived audit records [1]?',
      '',
      'Hypothesis: the archive tier may retain those records for longer [1].',
    ].join('\n')

    expect(segmentsOf(answer)).toEqual([])
    expect(extractCitationIds(answer)).toEqual(['1', '1'])

    const quality = assessGrounding(answer, 1, 0)
    expect(quality.citationCoveragePct).toBeLessThan(100)
    expect(quality.status).not.toBe('strong')
  })

  it('does not report perfect coverage for a bare cited fragment', () => {
    // The whole answer is one four-word fragment. It is below the claim floor,
    // so the denominator is empty and the single identifier buys 100%.
    const quality = assessGrounding('Yes, WAL is faster [1].', 3, 0)

    expect(segmentsOf('Yes, WAL is faster [1].')).toEqual([])
    expect(quality.citationCoveragePct).toBeLessThan(100)
    expect(quality.status).not.toBe('strong')
  })
})

describe('short factual assertions', () => {
  it('counts a six-word factual assertion as a gradeable claim', () => {
    const answer = [
      'SQLite enables write-ahead logging by default in this build [1].',
      'Write throughput doubled after the migration.',
      'Readers never block a concurrent writer.',
      'The rollback journal was removed entirely.',
    ].join(' ')

    // Three uncited factual assertions plus one cited one: 25%, not 100%.
    expect(segmentsOf(answer)).toHaveLength(4)
    expect(assessGrounding(answer, 1, 0).citationCoveragePct).toBe(25)
  })

  it('scores a wholly uncited compact answer at zero however short its sentences', () => {
    // The register a 4B-class model writes in. One valid identifier on the only
    // long sentence must not certify the four uncited ones around it.
    const answer = [
      'Rebuilding the index is the documented recovery path for a corrupt shard [1].',
      'The rebuild takes about four minutes.',
      'Query latency roughly triples during it.',
      'No queries are dropped while rebuilding.',
      'The shard reopens read-write afterwards.',
    ].join(' ')

    const quality = assessGrounding(answer, 1, 0)
    expect(segmentsOf(answer)).toHaveLength(5)
    expect(quality.citationCoveragePct).toBe(20)
    expect(quality.status).not.toBe('strong')
  })
})

describe('Markdown table rows', () => {
  const header = ['| Strategy | Observed outcome |', '|---|---|']
  const oneRowCited = [
    ...header,
    '| Fixed window | Throughput improved by roughly one third in the soak test [1] |',
    '| Sliding log | Latency regressed under sustained concurrent write pressure |',
    '| Token bucket | Memory use grew slightly across that same soak test |',
  ].join('\n')
  const everyRowCited = [
    ...header,
    '| Fixed window | Throughput improved by roughly one third in the soak test [1] |',
    '| Sliding log | Latency regressed under sustained concurrent write pressure [2] |',
    '| Token bucket | Memory use grew slightly across that same soak test [1] |',
  ].join('\n')

  it('grades each data row independently instead of as one fused claim', () => {
    // The rows survive normalization intact, so the fusion is the segmenter's
    // doing: rows end in `|` and are joined by single newlines.
    expect(normalizeGroundingProse(oneRowCited)).toContain('| Sliding log |')
    expect(segmentsOf(oneRowCited).length).toBeGreaterThanOrEqual(3)
  })

  it('does not let one cited row certify the uncited rows beside it', () => {
    const partial = assessGrounding(oneRowCited, 2, 0)
    const complete = assessGrounding(everyRowCited, 2, 0)

    expect(complete.citationCoveragePct).toBe(100)
    expect(partial.citationCoveragePct).toBeLessThan(complete.citationCoveragePct)
    expect(partial.citationCoveragePct).toBeLessThanOrEqual(40)
    expect(partial.status).not.toBe('strong')
  })

  it('keeps every uncited table row in the coverage denominator', () => {
    const uncitedTable = [
      ...header,
      '| Fixed window | Throughput improved by roughly one third in the soak test |',
      '| Sliding log | Latency regressed under sustained concurrent write pressure |',
      '',
      'The published benchmark documents the measurement methodology in full [1].',
    ].join('\n')

    expect(assessGrounding(uncitedTable, 1, 0).citationCoveragePct).toBeLessThanOrEqual(34)
  })
})

describe('sentence segmentation across a leading citation', () => {
  it('does not merge two sentences because the citation opens the second run', () => {
    const answer =
      'The scheduler was rewritten to use a work stealing queue. ' +
      '[1] Latency at the ninety ninth percentile fell by one third.'

    const segments = segmentsOf(answer)
    expect(segments).toHaveLength(2)
    // A citation after the closing period belongs to the sentence it closes,
    // which is the convention the trailing-citation case already pins. It must
    // not also carry the sentence that follows it.
    expect(segments[0]).toContain('[1]')
    expect(segments[1]).not.toContain('[1]')
    expect(assessGrounding(answer, 1, 0).citationCoveragePct).toBe(50)
  })

  it('does not merge across a leading local identifier either', () => {
    const answer =
      'The vault records the retention policy for archived audit logs. ' +
      '[L1] The production cluster has never exercised that policy in practice.'

    expect(segmentsOf(answer)).toHaveLength(2)
    expect(assessGrounding(answer, 0, 1).citationCoveragePct).toBe(50)
  })

  it('still keeps a trailing citation attached to the sentence it closes', () => {
    const answer = 'Throughput doubled between 2023 and 2024 on the vendor benchmark. [1]'

    expect(segmentsOf(answer)).toHaveLength(1)
    expect(assessGrounding(answer, 1, 0).citationCoveragePct).toBe(100)
  })
})

describe('a fix must not become punitive', () => {
  it('keeps a genuinely well cited answer at full coverage and strong status', () => {
    const answer = [
      'The scheduler was rewritten to use a work stealing queue [1].',
      'Latency at the ninety ninth percentile fell by one third [2].',
      'Memory use grew slightly under sustained write pressure [1].',
      'The change shipped in the March maintenance release [2].',
    ].join(' ')

    const quality = assessGrounding(answer, 2, 0)
    expect(quality.citationCoveragePct).toBe(100)
    expect(quality.invalidCitations).toEqual([])
    expect(quality.status).toBe('strong')
  })

  it('keeps short cited assertions at full coverage', () => {
    // The mirror of the short-claim case: counting short sentences must credit
    // them when they are cited, not merely enlarge the denominator.
    const answer = [
      'Write throughput doubled after migration [1].',
      'Readers never block a writer [1].',
      'The rollback journal is gone [2].',
    ].join(' ')

    const quality = assessGrounding(answer, 2, 0)
    expect(quality.citationCoveragePct).toBe(100)
    expect(quality.status).toBe('strong')
  })

  it('keeps headings, fences, and list scaffolding out of the denominator', () => {
    const report = [
      '# Executive Summary',
      '',
      'The scheduler now uses a work stealing queue design [1].',
      '',
      '## Benchmarks',
      '',
      '```ts',
      'const next = queue[3]',
      'const prev = queue[7]',
      '```',
      '',
      'Findings from the gathered benchmark evidence are summarised below:',
      '',
      '- Latency at the ninety ninth percentile fell by one third [2].',
      '- Memory use grew slightly under sustained write pressure [1].',
    ].join('\n')

    const segments = segmentsOf(report)
    expect(segments).toHaveLength(3)
    expect(segments.some((segment) => /^#{1,6}\s/.test(segment))).toBe(false)
    expect(segments.some((segment) => segment.includes('queue[3]'))).toBe(false)
    expect(segments.some((segment) => /:\s*$/.test(segment))).toBe(false)

    const quality = assessGrounding(report, 2, 0)
    expect(quality.invalidCitations).toEqual([])
    expect(quality.citationCoveragePct).toBe(100)
    expect(quality.status).toBe('strong')
  })

  it('keeps a table header and separator row out of the denominator', () => {
    const table = [
      '| Strategy | Observed outcome |',
      '|---|---|',
      '| Fixed window | Throughput improved by roughly one third in the soak test [1] |',
      '| Sliding log | Latency regressed under sustained concurrent write pressure [2] |',
    ].join('\n')

    const segments = segmentsOf(table)
    expect(segments.some((segment) => /^\s*\|?(?:\s*:?-{3,}:?\s*\|){1,}\s*$/.test(segment))).toBe(false)
    expect(assessGrounding(table, 2, 0).citationCoveragePct).toBe(100)
  })
})
