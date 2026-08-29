import { describe, expect, it } from 'bun:test'
import {
  buildQueryRetrievalDiagnostics,
  classifyRetrievalOutcome,
} from './retrieval-diagnostics'

describe('retrieval outcome classification', () => {
  it('does not confuse an HTTP-successful partial engine fleet with full health', () => {
    const diagnostics = buildQueryRetrievalDiagnostics({
      strategy: 'weighted-rrf-v1',
      web: {
        provider: 'searxng',
        rawCandidateCount: 70,
        usableCandidateCount: 18,
        selectedCount: 6,
        latencyMs: 1_234,
      },
      local: {
        provider: 'vault-bm25',
        rawCandidateCount: 456,
        usableCandidateCount: 4,
        selectedCount: 2,
        latencyMs: 8,
      },
      engines: {
        live: ['google', 'bing', 'google'],
        down: [
          { engine: 'duckduckgo', reason: 'CAPTCHA' },
          { engine: 'mojeek', reason: 'access denied' },
        ],
      },
    })

    expect(diagnostics.web).toMatchObject({
      provider: 'searxng',
      state: 'partial',
      rawCandidateCount: 70,
      usableCandidateCount: 18,
      selectedCount: 6,
      latencyMs: 1_234,
    })
    expect(diagnostics.local).toMatchObject({
      state: 'ok',
      rawCandidateCount: 456,
      usableCandidateCount: 4,
      selectedCount: 2,
    })
    expect(diagnostics.liveEngines).toEqual(['bing', 'google'])
    expect(diagnostics.failedEngines).toEqual([
      { engine: 'duckduckgo', reason: 'CAPTCHA' },
      { engine: 'mojeek', reason: 'access denied' },
    ])
    expect(diagnostics.engineCoveragePct).toBe(50)
  })

  it('distinguishes no-results, throttling, timeout, unreachable, and skipped', () => {
    const base = {
      provider: 'provider',
      rawCandidateCount: 0,
      usableCandidateCount: 0,
      selectedCount: 0,
    }
    expect(classifyRetrievalOutcome(base)).toBe('no-results')
    expect(classifyRetrievalOutcome({ ...base, rawCandidateCount: 12 })).toBe('partial')
    expect(classifyRetrievalOutcome({ ...base, error: 'HTTP 429', status: 429 })).toBe('rate-limited')
    expect(classifyRetrievalOutcome({ ...base, error: 'request timed out', status: 408 })).toBe('timeout')
    expect(classifyRetrievalOutcome({ ...base, error: 'connection refused' })).toBe('unreachable')
    expect(classifyRetrievalOutcome({ ...base, attempted: false })).toBe('skipped')
    expect(classifyRetrievalOutcome({ ...base, rawCandidateCount: 2, error: 'late failure' })).toBe('partial')
  })

  it('counts an engine once when it was live in one branch and failed in another', () => {
    const diagnostics = buildQueryRetrievalDiagnostics({
      strategy: 'weighted-rrf-research-v1',
      web: {
        provider: 'searxng',
        rawCandidateCount: 12,
        usableCandidateCount: 6,
        selectedCount: 4,
      },
      local: {
        provider: 'vault-bm25',
        rawCandidateCount: 0,
        usableCandidateCount: 0,
        selectedCount: 0,
      },
      engines: {
        live: ['bing', 'google'],
        down: [
          { engine: 'google', reason: 'one branch timed out' },
          { engine: 'mojeek', reason: 'access denied' },
        ],
      },
    })

    expect(diagnostics.engineCoveragePct).toBe(67)
    expect(diagnostics.web.state).toBe('partial')
  })
})
