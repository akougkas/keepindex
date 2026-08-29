import { readFileSync } from 'node:fs'
import {
  canonicalizeUrl,
  rankWebResults,
  selectFusedEvidence,
  type FusionLocalEvidence,
  type RankedResult,
  type RankedSearchResult,
} from '../retrieval'

export type RegressionLabel = 'gold' | 'supporting' | 'distractor'

export type RegressionWebCandidate = RankedSearchResult & {
  id: string
  label: RegressionLabel
  provenance: {
    provider: 'searxng'
    branch: string
    capture: 'scrubbed-live-shape'
  }
}

export type RegressionRankedWebCandidate = RankedResult & Pick<
  RegressionWebCandidate,
  'id' | 'label' | 'provenance'
>

export type RegressionVaultCandidate = FusionLocalEvidence & {
  id: string
  label: RegressionLabel
  title: string
  endLine: number
  score: number
  normalizedScore: number
  /** Share of non-stopword query terms present in the chunk. */
  queryCoverage: number
  retrievalRank: number
  excerpt: string
  provenance: {
    provider: 'vault-bm25'
    branch: string
    documentId: string
  }
}

export type RegressionCase = {
  id: string
  shape: string
  query: string
  fixedNow: string
  selectionLimit: number
  observedFailureShape: {
    webCandidates: number
    vaultCandidates: number
    selectedWeb: number
    selectedVault: number
  }
  engineHealth: {
    live: string[]
    down: Array<{ engine: string; reason: string }>
  }
  expected: {
    minimumWebSelected: number
    minimumVaultSelected: number
    requiredGoldIds: string[]
  }
  webCandidates: RegressionWebCandidate[]
  vaultCandidates: RegressionVaultCandidate[]
}

export type RetrievalRegressionCorpus = {
  schemaVersion: 1
  scrubbed: true
  description: string
  cases: RegressionCase[]
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid retrieval regression fixture: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads and minimally validates the checked-in JSON corpus. Keeping disk I/O
 * and the cast here makes the test assertions independent of JSON import
 * semantics and gives future fixture schema changes one adaptation point.
 */
export function loadRetrievalRegressionCorpus(): RetrievalRegressionCorpus {
  const fixtureUrl = new URL('./retrieval-regression.json', import.meta.url)
  const parsed: unknown = JSON.parse(readFileSync(fixtureUrl, 'utf8'))
  invariant(isRecord(parsed), 'root must be an object')
  invariant(parsed.schemaVersion === 1, 'unsupported schemaVersion')
  invariant(parsed.scrubbed === true, 'corpus must be explicitly scrubbed')
  invariant(Array.isArray(parsed.cases) && parsed.cases.length > 0, 'cases must be a non-empty array')

  const corpus = parsed as RetrievalRegressionCorpus
  for (const testCase of corpus.cases) {
    invariant(typeof testCase.id === 'string' && testCase.id.length > 0, 'case id is required')
    invariant(Number.isFinite(Date.parse(testCase.fixedNow)), `${testCase.id} fixedNow must be an ISO date`)
    invariant(testCase.webCandidates.length === 18, `${testCase.id} must contain 18 web candidates`)
    invariant(testCase.vaultCandidates.length === 18, `${testCase.id} must contain 18 vault candidates`)

    const ids = [...testCase.webCandidates, ...testCase.vaultCandidates].map((candidate) => candidate.id)
    invariant(new Set(ids).size === ids.length, `${testCase.id} candidate ids must be unique`)
    const canonicalUrls = testCase.webCandidates.map((candidate) => canonicalizeUrl(candidate.url))
    invariant(
      new Set(canonicalUrls).size === canonicalUrls.length,
      `${testCase.id} web candidate canonical URLs must be unique`
    )
  }
  return corpus
}

/**
 * Ranks the web branch and restores fixture-only labels/provenance that the
 * public rankWebResults return type intentionally does not expose. If ranking
 * becomes generic later, this adapter can collapse to a cast without changing
 * the evaluation assertions.
 */
export function rankRegressionWebCandidates(testCase: RegressionCase): RegressionRankedWebCandidate[] {
  const metadata = new Map(
    testCase.webCandidates.map((candidate) => [canonicalizeUrl(candidate.url), candidate] as const)
  )
  return rankWebResults(
    testCase.query,
    testCase.webCandidates,
    Date.parse(testCase.fixedNow)
  ).map((ranked) => {
    const fixtureCandidate = metadata.get(ranked.canonicalUrl)
    invariant(fixtureCandidate, `${testCase.id} lost metadata for ${ranked.canonicalUrl}`)
    return {
      ...ranked,
      id: fixtureCandidate.id,
      label: fixtureCandidate.label,
      provenance: fixtureCandidate.provenance,
    }
  })
}

/**
 * Single adapter seam for the fusion API. The production function's
 * current contract is `(web, local, { limit })`; a future signature change
 * should require edits here rather than throughout the regression suite.
 */
export function selectRegressionEvidence(testCase: RegressionCase) {
  return selectFusedEvidence(
    rankRegressionWebCandidates(testCase),
    testCase.vaultCandidates,
    { limit: testCase.selectionLimit }
  )
}

export function regressionSelectionKey(testCase: RegressionCase): string[] {
  return selectRegressionEvidence(testCase).ordered.map((candidate) => candidate.source.id)
}
