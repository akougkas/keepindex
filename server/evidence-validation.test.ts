import { describe, expect, it } from 'bun:test'
import { liveReleaseMismatch, unsupportedEvidenceLiterals } from './evidence-validation'

describe('citation support beyond identifier coverage', () => {
  it('rejects invented versions and code even when the citation ID resolves', () => {
    expect(unsupportedEvidenceLiterals(['Version 1.2.0 adds `context(scope="library")` [1].'], ['Version 0.4.7 adds safer keyboard controls.'], [])).toEqual(['context(scope="library")', '1.2.0'])
  })
  it('checks the cited passage, rather than accepting a literal anywhere in the pack', () => {
    expect(unsupportedEvidenceLiterals(['The `extensions run` command is available [L1].'], ['extensions run'], ['Safer keyboard controls'])).toEqual(['extensions run'])
  })
  it('accepts supported identifiers, dates, and combined citations', () => {
    expect(unsupportedEvidenceLiterals(['Version v0.4.7 was published 2026-09-11 and adds `extensions run` [1, L1].'], ['tag_name: v0.4.7; published_at: 2026-09-11'], ['extensions run'])).toEqual([])
  })
  it('rejects a latest-release answer that ignores the available current version', () => {
    const sources = [{ snippet: 'Live GitHub release record: tag_name: v2.8.1; published_at: 2026-09-11' }]
    expect(liveReleaseMismatch('latest widget-tool release', 'Latest version is 1.0.0 [1].', sources)).toContain('2.8.1')
    expect(liveReleaseMismatch('latest widget-tool release', 'Latest version is 2.8.1 [1].', sources)).toBeNull()
  })
})
