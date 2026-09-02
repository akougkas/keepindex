import { writeFile } from 'node:fs/promises'
import { readJsonSse, type JsonSseEvent } from '../src/lib/sse'

type Phase = {
  name: string
  startedOffsetMs: number
  durationMs: number
  status: 'ok' | 'error' | 'aborted' | 'skipped'
  detail: Record<string, string | number | boolean | null>
}

type QueryRecord = {
  requestId: string
  query: string
  outcome: string
  degraded: boolean
  sourceCount: number
  candidateSourceCount: number | null
  timings: {
    generationMs: number | null
    timeToFirstTokenMs: number | null
    tokensPerSecond: number | null
    endToEndMs: number | null
  }
  executionTrace: Phase[]
  retrievalDiagnostics: {
    web: { state: string; rawCandidateCount: number; usableCandidateCount: number; selectedCount: number; latencyMs: number | null }
    local: { state: string; rawCandidateCount: number; usableCandidateCount: number; selectedCount: number; latencyMs: number | null }
    engineCoveragePct: number | null
  } | null
  sourcePack: { web: unknown[]; local: unknown[] }
}

type ProfileResult = {
  query: string
  requestId: string
  httpStatus: number
  client: {
    responseHeadersMs: number
    firstEventMs: number | null
    sourcesMs: number | null
    firstTokenMs: number | null
    doneMs: number | null
  }
  record: QueryRecord
}

const DEFAULT_QUERIES = [
  'who is Jaime Cernuda Garcia?',
  'What is IOWarp and what problem does it solve?',
  'How does SQLite WAL differ from rollback journal mode?',
  'What is the latest stable Bun release?',
  'When may Retry-After be sent with HTTP 429 and 503 responses?',
  'What are the best tools for recording short terminal demo videos?',
  'What changed in the 2026 Ford Maverick?',
  'Compare fixed-window, semantic, and late chunking for retrieval quality.',
  'How is ChronoLog used in the projects in my local documents?',
  'What PostgreSQL indexing strategies work best for mixed read and write workloads?',
]

const baseUrl = (process.env.KEEPINDEX_URL || 'http://127.0.0.1:5173').replace(/\/$/, '')
const outputPath = process.env.KEEPINDEX_PROFILE_OUTPUT || `/tmp/keepindex-profile-${Date.now()}.json`
const configuredQueries = process.env.KEEPINDEX_PROFILE_QUERIES
  ? JSON.parse(process.env.KEEPINDEX_PROFILE_QUERIES) as unknown
  : DEFAULT_QUERIES
if (!Array.isArray(configuredQueries) || configuredQueries.some((query) => typeof query !== 'string' || !query.trim())) {
  throw new Error('KEEPINDEX_PROFILE_QUERIES must be a JSON array of non-empty strings')
}
const queries = configuredQueries.map((query) => query.trim())
if (queries.length < 10) throw new Error('The baseline requires at least 10 queries')

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]
}

function summarize(values: number[]) {
  return {
    count: values.length,
    meanMs: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: values.length ? Math.max(...values) : null,
  }
}

async function profileQuery(query: string, index: number): Promise<ProfileResult> {
  const requestId = `profile-${Date.now()}-${index + 1}-${crypto.randomUUID().slice(0, 8)}`
  const startedAt = performance.now()
  const response = await fetch(`${baseUrl}/api/ask/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      focus: 'all',
      target: 'all',
      semantic: true,
      requestId,
    }),
  })
  const responseHeadersMs = Math.round(performance.now() - startedAt)
  if (!response.ok || !response.body) throw new Error(`${query}: /api/ask returned HTTP ${response.status}`)

  let firstEventMs: number | null = null
  let sourcesMs: number | null = null
  let firstTokenMs: number | null = null
  let doneMs: number | null = null
  await readJsonSse<JsonSseEvent<string, unknown>>(response.body, {
    onEvent(event) {
      const elapsed = Math.round(performance.now() - startedAt)
      firstEventMs ??= elapsed
      if (event.type === 'sources') sourcesMs ??= elapsed
      if (event.type === 'delta') firstTokenMs ??= elapsed
      if (event.type === 'done') doneMs ??= elapsed
    },
  })

  const recordResponse = await fetch(`${baseUrl}/api/queries/${encodeURIComponent(requestId)}`)
  if (!recordResponse.ok) throw new Error(`${query}: query record returned HTTP ${recordResponse.status}`)
  const payload = await recordResponse.json() as { record: QueryRecord }
  return {
    query,
    requestId,
    httpStatus: response.status,
    client: { responseHeadersMs, firstEventMs, sourcesMs, firstTokenMs, doneMs },
    record: payload.record,
  }
}

const results: ProfileResult[] = []
for (const [index, query] of queries.entries()) {
  console.log(`[${index + 1}/${queries.length}] ${query}`)
  const result = await profileQuery(query, index)
  results.push(result)
  console.log(JSON.stringify({
    outcome: result.record.outcome,
    endToEndMs: result.record.timings.endToEndMs,
    firstTokenMs: result.client.firstTokenMs,
    web: result.record.sourcePack.web.length,
    local: result.record.sourcePack.local.length,
  }))
}

const phaseNames = Array.from(new Set(results.flatMap((result) => result.record.executionTrace.map((phase) => phase.name)))).sort()
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  baseUrl,
  configuration: { target: 'all', focus: 'all', semantic: true, sequential: true },
  queryCount: results.length,
  summary: {
    endToEnd: summarize(results.flatMap((result) => result.record.timings.endToEndMs == null ? [] : [result.record.timings.endToEndMs])),
    clientFirstEvent: summarize(results.flatMap((result) => result.client.firstEventMs == null ? [] : [result.client.firstEventMs])),
    clientFirstToken: summarize(results.flatMap((result) => result.client.firstTokenMs == null ? [] : [result.client.firstTokenMs])),
    phases: Object.fromEntries(phaseNames.map((name) => [
      name,
      summarize(results.flatMap((result) => result.record.executionTrace
        .filter((phase) => phase.name === name && phase.status !== 'skipped')
        .map((phase) => phase.durationMs))),
    ])),
  },
  results,
}

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(`\nWrote ${outputPath}`)
console.log(JSON.stringify(report.summary, null, 2))
