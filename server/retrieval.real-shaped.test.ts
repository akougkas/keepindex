import { describe, expect, it } from 'bun:test'
import {
  loadRetrievalRegressionCorpus,
  regressionSelectionKey,
  selectRegressionEvidence,
  type RegressionCase,
} from './fixtures/retrieval-regression'

const corpus = loadRetrievalRegressionCorpus()

function rotate<T>(values: T[], offset: number): T[] {
  const pivot = offset % values.length
  return [...values.slice(pivot), ...values.slice(0, pivot)]
}

function reorderedCase(testCase: RegressionCase, offset: number): RegressionCase {
  return {
    ...testCase,
    webCandidates: rotate(testCase.webCandidates, offset),
    vaultCandidates: rotate(testCase.vaultCandidates, testCase.vaultCandidates.length - offset),
  }
}

describe('real-shaped retrieval regression corpus', () => {
  it('contains only scrubbed synthetic data and exactly models the 18 + 18 failure shape', () => {
    expect(corpus.schemaVersion).toBe(1)
    expect(corpus.scrubbed).toBe(true)
    expect(corpus.cases).toHaveLength(2)

    const serialized = JSON.stringify(corpus).toLowerCase()
    expect(serialized).not.toContain('private owner name')
    expect(serialized).not.toContain('clio coder')

    for (const testCase of corpus.cases) {
      expect(testCase.webCandidates).toHaveLength(18)
      expect(testCase.vaultCandidates).toHaveLength(18)
      expect(testCase.observedFailureShape).toEqual({
        webCandidates: 18,
        vaultCandidates: 18,
        selectedWeb: 0,
        selectedVault: 18,
      })

      for (const candidate of testCase.webCandidates) {
        const host = new URL(candidate.url).hostname
        expect(host === 'example.org' || host.endsWith('.example.org') || host === 'example.com' || host.endsWith('.example.com')).toBe(true)
      }
      for (const candidate of testCase.vaultCandidates) {
        expect(candidate.filePath.startsWith('/fixtures/synthetic-vault/')).toBe(true)
        expect(candidate.excerpt.startsWith('Synthetic fixture only:')).toBe(true)
      }
    }
  })

  it('preserves partial engine-failure context without assigning failed engines to candidates', () => {
    for (const testCase of corpus.cases) {
      const live = new Set(testCase.engineHealth.live)
      const down = new Set(testCase.engineHealth.down.map((entry) => entry.engine))
      expect(live.size).toBeGreaterThan(0)
      expect(down.size).toBeGreaterThan(0)
      expect([...live].filter((engine) => down.has(engine))).toEqual([])

      for (const candidate of testCase.webCandidates) {
        expect(candidate.provenance).toEqual({
          provider: 'searxng',
          branch: 'general-web',
          capture: 'scrubbed-live-shape',
        })
        expect(candidate.engines?.length ?? 0).toBeGreaterThan(0)
        expect(candidate.engines?.every((engine) => live.has(engine))).toBe(true)
      }
      for (const candidate of testCase.vaultCandidates) {
        expect(candidate.provenance.provider).toBe('vault-bm25')
        expect(candidate.provenance.documentId.startsWith('synthetic-')).toBe(true)
        expect(candidate.queryCoverage).toBeGreaterThanOrEqual(0)
        expect(candidate.queryCoverage).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('real-shaped fused evidence regression', () => {
  for (const testCase of corpus.cases) {
    it(`${testCase.id}: keeps meaningful coverage from both source kinds`, () => {
      const selection = selectRegressionEvidence(testCase)
      const selectedIds = new Set(selection.ordered.map((candidate) => candidate.source.id))

      // Admission is allowed to leave the pack thin. The selector must never
      // pad to 18 with a chunk that failed the relevance/coverage floors.
      expect(selection.ordered.length).toBeGreaterThan(0)
      expect(selection.ordered.length).toBeLessThanOrEqual(testCase.selectionLimit)
      expect(selection.web.length + selection.local.length).toBe(selection.ordered.length)
      expect(selection.counts).toMatchObject({
        candidateWeb: 18,
        candidateLocal: 18,
        selectedWeb: selection.web.length,
        selectedLocal: selection.local.length,
      })
      expect(selection.counts.usableWeb + selection.counts.rejectedWeb).toBe(18)
      expect(selection.counts.usableLocal + selection.counts.rejectedLocal).toBe(18)
      expect(selection.counts.rejectedWeb).toBeGreaterThan(0)
      expect(selection.counts.rejectedLocal).toBeGreaterThan(0)
      expect(selection.web.length).toBeGreaterThanOrEqual(testCase.expected.minimumWebSelected)
      expect(selection.local.length).toBeGreaterThanOrEqual(testCase.expected.minimumVaultSelected)
      for (const requiredId of testCase.expected.requiredGoldIds) {
        expect({ requiredId, selected: selectedIds.has(requiredId) }).toEqual({ requiredId, selected: true })
      }

      // These chunks deliberately have high branch-relative BM25 scores but
      // cover less than half of the query. They reproduced the bad-vault crowd
      // out and must not re-enter the fused evidence pack.
      expect(selection.local.filter((candidate) => candidate.queryCoverage < 0.5)).toEqual([])
    })

    it(`${testCase.id}: retains source provenance through ranking and fusion`, () => {
      const selection = selectRegressionEvidence(testCase)
      const candidateIds = new Set([
        ...testCase.webCandidates.map((candidate) => candidate.id),
        ...testCase.vaultCandidates.map((candidate) => candidate.id),
      ])
      const selectedIds = selection.ordered.map((candidate) => candidate.source.id)

      expect(new Set(selectedIds).size).toBe(selectedIds.length)
      expect(selectedIds.every((id) => candidateIds.has(id))).toBe(true)

      for (const source of selection.web) {
        expect(source.provenance.provider).toBe('searxng')
        expect(source.provenance.capture).toBe('scrubbed-live-shape')
        expect(source.engines?.length ?? 0).toBeGreaterThan(0)
        expect(source.canonicalUrl.length).toBeGreaterThan(0)
      }
      for (const source of selection.local) {
        expect(source.provenance.provider).toBe('vault-bm25')
        expect(source.filePath.startsWith('/fixtures/synthetic-vault/')).toBe(true)
        expect(source.startLine).toBeGreaterThan(0)
        expect(source.endLine).toBeGreaterThanOrEqual(source.startLine ?? 0)
      }
    })

    it(`${testCase.id}: is invariant to candidate arrival order`, () => {
      const baseline = regressionSelectionKey(testCase)
      expect(regressionSelectionKey(testCase)).toEqual(baseline)
      expect(regressionSelectionKey({
        ...testCase,
        webCandidates: [...testCase.webCandidates].reverse(),
        vaultCandidates: [...testCase.vaultCandidates].reverse(),
      })).toEqual(baseline)

      for (const offset of [1, 5, 11, 17]) {
        expect(regressionSelectionKey(reorderedCase(testCase, offset))).toEqual(baseline)
      }
    })
  }

  it('reports stable coverage for the complete scrubbed corpus', () => {
    const report = corpus.cases.map((testCase) => {
      const selection = selectRegressionEvidence(testCase)
      return {
        id: testCase.id,
        candidates: testCase.webCandidates.length + testCase.vaultCandidates.length,
        selectedWeb: selection.web.length,
        selectedVault: selection.local.length,
        goldSelected: selection.ordered.filter((candidate) => candidate.source.label === 'gold').length,
      }
    })
    console.log('[real-shaped-retrieval]', JSON.stringify(report))
    expect(report.every((row) => row.candidates === 36)).toBe(true)
    expect(report.every((row) => row.selectedWeb >= 4 && row.selectedVault >= 4)).toBe(true)
    expect(report.every((row) => row.goldSelected >= 6)).toBe(true)
  })
})
