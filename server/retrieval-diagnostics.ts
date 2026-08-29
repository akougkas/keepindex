import type {
  QueryRetrievalDiagnostics,
  RetrievalOutcomeState,
  RetrievalSourceOutcome,
} from './database'

export type RetrievalAttemptSnapshot = {
  provider: string
  attempted?: boolean
  rawCandidateCount: number
  usableCandidateCount: number
  selectedCount: number
  latencyMs?: number | null
  error?: string | null
  /** Non-error admission notes such as gate rejection counts. */
  detail?: string | null
  status?: number | null
  partial?: boolean
}

export type EngineHealthSnapshot = {
  live: string[]
  down: Array<{ engine: string; reason: string }>
  observedAt?: number | null
}

export type QueryRetrievalDiagnosticsInput = {
  strategy: string
  web: RetrievalAttemptSnapshot
  local: RetrievalAttemptSnapshot
  engines?: EngineHealthSnapshot | null
  fallbackAttempted?: boolean
  fallbackReason?: string | null
}

function nonNegativeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

function boundedText(value: string | null | undefined, limit = 240): string | null {
  const text = value?.trim()
  return text ? text.slice(0, limit) : null
}

export function classifyRetrievalOutcome(
  attempt: RetrievalAttemptSnapshot
): RetrievalOutcomeState {
  if (attempt.attempted === false) return 'skipped'
  if (attempt.error) {
    if (attempt.usableCandidateCount > 0 || attempt.rawCandidateCount > 0) return 'partial'
    if (attempt.status === 429) return 'rate-limited'
    if (attempt.status === 408 || /tim(?:e|ed)\s*out|timeout/i.test(attempt.error)) return 'timeout'
    if (/unavailable|unreachable|dns|connect|refused|network/i.test(attempt.error)) return 'unreachable'
    return 'error'
  }
  // A provider that reported degradation (suspended engines, a failed
  // discovery branch) is a provider fault even when it handed back nothing.
  // This has to precede the empty-candidate shortcut, otherwise a blocked
  // fleet is indistinguishable from a healthy provider that found no match.
  if (attempt.partial) return 'partial'
  if (attempt.rawCandidateCount === 0) return 'no-results'
  // The provider/retriever did return candidates, but admission rejected all
  // of them. Calling this "no-results" hides a ranking failure as an upstream
  // search miss; partial accurately preserves the distinction.
  if (attempt.usableCandidateCount === 0) return 'partial'
  return 'ok'
}

function sourceOutcome(attempt: RetrievalAttemptSnapshot): RetrievalSourceOutcome {
  return {
    provider: attempt.provider,
    state: classifyRetrievalOutcome(attempt),
    attempted: attempt.attempted !== false,
    rawCandidateCount: nonNegativeCount(attempt.rawCandidateCount),
    usableCandidateCount: nonNegativeCount(attempt.usableCandidateCount),
    selectedCount: nonNegativeCount(attempt.selectedCount),
    latencyMs:
      attempt.latencyMs == null || !Number.isFinite(attempt.latencyMs)
        ? null
        : Math.max(0, Math.round(attempt.latencyMs)),
    detail: boundedText(
      attempt.detail && attempt.error
        ? `${attempt.detail}; error=${attempt.error}`
        : attempt.detail ?? attempt.error
    ),
  }
}

function uniqueEngineFailures(
  failures: Array<{ engine: string; reason: string }>
): Array<{ engine: string; reason: string }> {
  const seen = new Set<string>()
  const result: Array<{ engine: string; reason: string }> = []
  for (const failure of failures) {
    const engine = failure.engine.trim().slice(0, 60)
    if (!engine || seen.has(engine)) continue
    seen.add(engine)
    result.push({ engine, reason: failure.reason.trim().slice(0, 120) || 'unavailable' })
  }
  return result.sort((a, b) => a.engine.localeCompare(b.engine))
}

export function buildQueryRetrievalDiagnostics(
  input: QueryRetrievalDiagnosticsInput
): QueryRetrievalDiagnostics {
  const liveEngines = Array.from(
    new Set((input.engines?.live ?? []).map((engine) => engine.trim()).filter(Boolean))
  ).sort()
  const failedEngines = uniqueEngineFailures(input.engines?.down ?? [])
  const engineTotal = new Set([
    ...liveEngines,
    ...failedEngines.map((failure) => failure.engine),
  ]).size
  const web = sourceOutcome({
    ...input.web,
    partial: input.web.partial || failedEngines.length > 0,
  })

  return {
    strategy: input.strategy.trim().slice(0, 80) || 'unknown',
    web,
    local: sourceOutcome(input.local),
    liveEngines,
    failedEngines,
    engineCoveragePct:
      engineTotal === 0 ? null : Math.round((liveEngines.length / engineTotal) * 100),
    fallbackAttempted: input.fallbackAttempted === true,
    fallbackReason: boundedText(input.fallbackReason),
  }
}
