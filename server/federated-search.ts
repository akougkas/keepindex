import { canonicalizeUrl, hostOf } from './retrieval'

export type SearchTarget = 'all' | 'web' | 'files' | 'vault' | 'documents' | 'history'
export type SearchResultKind = 'web' | 'history' | 'note' | 'document' | 'code' | 'file'

export type FederatedSearchResult = {
  id: string
  kind: SearchResultKind
  title: string
  url: string
  snippet: string
  score: number
  nativeRank: number
  sourceTypes: SearchResultKind[]
  engines?: string[]
  publishedDate?: string
  filePath?: string
  fileName?: string
  startLine?: number
  endLine?: number
  resourceId?: string
  resourceLabel?: string
  extension?: string
  mimeType?: string
  metadataOnly?: boolean
  tags?: string[]
  aliases?: string[]
  modifiedAt?: number
  browser?: string
  profile?: string
  visitCount?: number
  lastVisitedAt?: number
}

export type FederatedStreams = {
  web: FederatedSearchResult[]
  local: FederatedSearchResult[]
  history: FederatedSearchResult[]
}

export type FederatedSearchResponse = {
  results: FederatedSearchResult[]
  counts: { web: number; local: number; history: number; total: number }
  available: { web: number; local: number; history: number }
}

export function normalizeSearchTarget(value: unknown): SearchTarget {
  return value === 'web' || value === 'files' || value === 'vault' ||
    value === 'documents' || value === 'history'
    ? value
    : 'all'
}

export function targetIncludesWeb(target: SearchTarget): boolean {
  return target === 'all' || target === 'web'
}

export function targetIncludesHistory(target: SearchTarget): boolean {
  return target === 'all' || target === 'history'
}

export function targetIncludesLocal(target: SearchTarget): boolean {
  return target === 'all' || target === 'files' || target === 'vault' || target === 'documents'
}

function identity(result: FederatedSearchResult): string {
  if (result.kind === 'web' || result.kind === 'history') return `url:${canonicalizeUrl(result.url)}`
  return `file:${result.filePath ?? result.url}:${result.startLine ?? 0}:${result.endLine ?? 0}`
}

function displayWinner(left: FederatedSearchResult, right: FederatedSearchResult): FederatedSearchResult {
  // A live web result usually has a useful snippet; history contributes private
  // recency and frequency metadata to the same URL instead of becoming a card duplicate.
  if (left.kind === 'web' && right.kind === 'history') return left
  if (right.kind === 'web' && left.kind === 'history') return right
  if (right.snippet.length > left.snippet.length) return right
  return left
}

/**
 * Admission floor for provider-native relevance, mirroring the ask path's
 * minWebRelevanceScore. Rank-only fusion cannot tell a perfect match from a
 * negligible one once both are first in their stream, so a candidate that its
 * own provider scored near zero is dropped before it can claim a slot. Kept
 * deliberately low so a legitimately thin stream still contributes.
 */
const MIN_RELEVANCE_SCORE = 0.05

function admitByRelevance(
  candidates: FederatedSearchResult[],
  minRelevanceScore: number
): FederatedSearchResult[] {
  if (minRelevanceScore <= 0) return candidates
  // A candidate without a usable score is admitted: an unknown relevance is not
  // evidence of a bad match, and rank order still decides where it lands.
  return candidates.filter((candidate) =>
    !Number.isFinite(candidate.score) || candidate.score >= minRelevanceScore
  )
}

/** Weighted reciprocal-rank fusion across independently scored providers. */
export function fuseFederatedSearch(
  streams: FederatedStreams,
  limit: number,
  options: {
    rrfK?: number
    webWeight?: number
    localWeight?: number
    historyWeight?: number
    minRelevanceScore?: number
  } = {}
): FederatedSearchResponse {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0
  const rrfK = Math.max(1, options.rrfK ?? 40)
  const minRelevanceScore = Math.max(0, options.minRelevanceScore ?? MIN_RELEVANCE_SCORE)
  const weights = {
    web: Math.max(0, options.webWeight ?? 1),
    // The live-web stream has already passed stricter relevance admission than
    // a one-token BM25/FTS match. Keep local evidence competitive without
    // allowing a weak private match to outrank an exact first-party web hit.
    local: Math.max(0, options.localWeight ?? 0.92),
    history: Math.max(0, options.historyWeight ?? 0.82),
  }
  const fused = new Map<string, {
    result: FederatedSearchResult
    fusionScore: number
    bestRank: number
    kinds: Set<SearchResultKind>
  }>()

  const admitted: FederatedStreams = {
    web: admitByRelevance(streams.web, minRelevanceScore),
    local: admitByRelevance(streams.local, minRelevanceScore),
    history: admitByRelevance(streams.history, minRelevanceScore),
  }
  // The floor may never blank a page that had evidence. When every provider
  // scored its whole set low, the thin set is still the best answer available.
  const admittedStreams = admitted.web.length + admitted.local.length + admitted.history.length > 0
    ? admitted
    : streams

  for (const [streamName, candidates] of Object.entries(admittedStreams) as Array<[keyof FederatedStreams, FederatedSearchResult[]]>) {
    candidates.forEach((candidate, index) => {
      const nativeRank = index + 1
      const key = identity(candidate)
      const existing = fused.get(key)
      const contribution = weights[streamName] / (rrfK + nativeRank)
      if (!existing) {
        fused.set(key, {
          result: { ...candidate, nativeRank },
          fusionScore: contribution,
          bestRank: nativeRank,
          kinds: new Set([candidate.kind]),
        })
        return
      }
      const winner = displayWinner(existing.result, candidate)
      const history = candidate.kind === 'history' ? candidate : existing.result.kind === 'history' ? existing.result : null
      existing.result = {
        ...winner,
        ...(history ? {
          browser: history.browser,
          profile: history.profile,
          visitCount: history.visitCount,
          lastVisitedAt: history.lastVisitedAt,
        } : {}),
      }
      existing.fusionScore += contribution
      existing.bestRank = Math.min(existing.bestRank, nativeRank)
      existing.kinds.add(candidate.kind)
    })
  }

  const ordered = Array.from(fused.values())
    .map((entry) => ({
      ...entry.result,
      score: Number(entry.fusionScore.toFixed(8)),
      nativeRank: entry.bestRank,
      sourceTypes: Array.from(entry.kinds).sort(),
    }))
    .sort((a, b) =>
      b.score - a.score ||
      a.nativeRank - b.nativeRank ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id)
    )

  // Keep the all-sources page diverse before backfilling. It is better to show
  // one excellent local match than ten URLs from one host, and vice versa.
  const selected: FederatedSearchResult[] = []
  const perHost = new Map<string, number>()
  const perFile = new Map<string, number>()
  // Backfill in widening tiers instead of draining the held-back rows outright.
  // The strict cap runs first, then a relaxed second tier, and only a page that
  // would otherwise ship short falls through to the uncapped pass. Every tier
  // keeps fusion order, so the selection stays deterministic.
  let pending = ordered
  for (const relaxation of [1, 2, Infinity]) {
    if (selected.length >= safeLimit) break
    const heldBack: FederatedSearchResult[] = []
    for (const result of pending) {
      if (selected.length >= safeLimit) {
        heldBack.push(result)
        continue
      }
      const webLike = result.kind === 'web' || result.kind === 'history'
      const diversityKey = webLike ? hostOf(result.url) : result.filePath ?? result.url
      const counter = webLike ? perHost : perFile
      const used = counter.get(diversityKey) ?? 0
      if (used >= (webLike ? 3 : 2) * relaxation) {
        heldBack.push(result)
        continue
      }
      counter.set(diversityKey, used + 1)
      selected.push(result)
    }
    pending = heldBack
  }

  return {
    results: selected,
    // web and local partition the displayed rows; history deliberately overlaps
    // web, because a live page the user has also visited is one card carrying a
    // private corroboration signal. web + local + history therefore does not
    // have to equal total. Callers summing web and history to count selected web
    // sources are double counting and must read counts.web alone.
    counts: {
      web: selected.filter((result) => result.kind === 'web').length,
      local: selected.filter((result) => result.kind !== 'web' && result.kind !== 'history').length,
      history: selected.filter((result) => result.kind === 'history' || result.sourceTypes.includes('history')).length,
      total: selected.length,
    },
    available: {
      web: streams.web.length,
      local: streams.local.length,
      history: streams.history.length,
    },
  }
}
