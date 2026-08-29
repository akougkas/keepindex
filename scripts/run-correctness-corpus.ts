import { CORRECTNESS_CORPUS, type CorrectnessCorpusCase } from '../server/correctness-corpus'
import { readKeepIndexEnvironment } from '../server/environment'
import { readJsonSse, type JsonSseEvent } from '../src/lib/sse'

type SourcePack = {
  web: Array<{ title?: string; url?: string; snippet?: string }>
  local: Array<{ fileName?: string; filePath?: string; content?: string }>
}

type QueryRecord = {
  requestId: string
  outcome: string
  answerText: string
  sourcePack: SourcePack
  citationIds: string[]
  grounding: {
    status: string
    citationCoveragePct: number
    invalidCitations: string[]
  } | null
  retrievalDiagnostics: {
    web?: { provider?: string; selectedCount?: number }
    local?: { provider?: string; selectedCount?: number }
  } | null
  timings: { endToEndMs: number | null }
  error: string | null
}

type CorpusEvent = JsonSseEvent<string, unknown>

type CaseResult = {
  id: string
  category: string
  mode: string
  requestId: string
  passed: boolean
  failures: string[]
  outcome: string
  elapsedMs: number
  webSources: number
  localSources: number
  citationCoveragePct: number | null
  groundingStatus: string | null
  engineWebProvider: string | null
  localProvider: string | null
  eventTypes: string[]
}

function argumentValue(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

const baseUrl = (
  argumentValue('--base-url') ?? readKeepIndexEnvironment('URL') ?? 'http://127.0.0.1:5173'
).replace(/\/$/, '')
const model = argumentValue('--model') ?? readKeepIndexEnvironment('CORPUS_MODEL') ?? ''
const selectedCase = argumentValue('--case')
const jsonOutput = process.argv.includes('--json')
const listOnly = process.argv.includes('--list')

function regex(pattern: string): RegExp {
  return new RegExp(pattern, 'is')
}

function matches(pattern: string, value: string): boolean {
  return regex(pattern).test(value)
}

function sourceEvidence(pack: SourcePack): string {
  return [
    ...pack.web.flatMap((source) => [source.title ?? '', source.url ?? '', source.snippet ?? '']),
    ...pack.local.flatMap((source) => [source.fileName ?? '', source.filePath ?? '', source.content ?? '']),
  ].join('\n')
}

function evaluate(entry: CorrectnessCorpusCase, record: QueryRecord, eventTypes: Set<string>, planCount: number | null): string[] {
  const failures: string[] = []
  const { expectations } = entry
  const pack = record.sourcePack ?? { web: [], local: [] }
  const totalSources = pack.web.length + pack.local.length
  const evidence = sourceEvidence(pack)
  const webUrls = pack.web.map((source) => source.url ?? '')
  const localNames = pack.local.map((source) => source.fileName ?? '')
  const distinctHosts = new Set(webUrls.flatMap((url) => {
    try { return [new URL(url).hostname.replace(/^www\./, '')] } catch { return [] }
  }))

  if (record.outcome !== 'succeeded') failures.push(`outcome was ${record.outcome}${record.error ? `: ${record.error}` : ''}`)
  if (!record.answerText.trim()) failures.push('answer was empty')
  if (totalSources < expectations.minSources || totalSources > expectations.maxSources) {
    failures.push(`source count ${totalSources} was outside ${expectations.minSources}..${expectations.maxSources}`)
  }
  if (pack.web.length < expectations.minWebSources) failures.push(`web sources ${pack.web.length} < ${expectations.minWebSources}`)
  if (pack.local.length < expectations.minLocalSources) failures.push(`local sources ${pack.local.length} < ${expectations.minLocalSources}`)
  if (expectations.minDistinctWebHosts != null && distinctHosts.size < expectations.minDistinctWebHosts) {
    failures.push(`distinct web hosts ${distinctHosts.size} < ${expectations.minDistinctWebHosts}`)
  }

  for (const pattern of expectations.requiredWebUrlPatterns ?? []) {
    if (!webUrls.some((url) => matches(pattern, url))) failures.push(`missing required web URL /${pattern}/`)
  }
  for (const fileName of expectations.requiredLocalFileNames ?? []) {
    if (!localNames.includes(fileName)) failures.push(`missing required local file ${fileName}`)
  }
  for (const pattern of expectations.answerPatterns) {
    if (!matches(pattern, record.answerText)) failures.push(`answer missed /${pattern}/`)
  }
  for (const pattern of expectations.forbiddenAnswerPatterns ?? []) {
    if (matches(pattern, record.answerText)) failures.push(`answer matched forbidden /${pattern}/`)
  }
  for (const pattern of expectations.evidencePatterns ?? []) {
    if (!matches(pattern, evidence)) failures.push(`source evidence missed /${pattern}/`)
  }
  for (const eventType of expectations.requiredEventTypes) {
    if (!eventTypes.has(eventType)) failures.push(`stream missed ${eventType} event`)
  }

  if (!record.grounding) {
    failures.push('grounding assessment missing')
  } else {
    if (record.grounding.invalidCitations.length > 0) {
      failures.push(`invalid citations: ${record.grounding.invalidCitations.join(', ')}`)
    }
    if (record.grounding.citationCoveragePct < expectations.minCitationCoveragePct) {
      failures.push(`citation coverage ${record.grounding.citationCoveragePct}% < ${expectations.minCitationCoveragePct}%`)
    }
    if (record.grounding.status !== expectations.requiredGroundingStatus) {
      failures.push(`grounding was ${record.grounding.status}, expected ${expectations.requiredGroundingStatus}`)
    }
  }
  if (record.citationIds.length === 0) failures.push('answer contained no recognized citations')

  if (expectations.planQuestionRange) {
    const [minimum, maximum] = expectations.planQuestionRange
    if (planCount == null || planCount < minimum || planCount > maximum) {
      failures.push(`research plan questions ${planCount ?? 'missing'} outside ${minimum}..${maximum}`)
    }
  }
  return failures
}

async function runCase(entry: CorrectnessCorpusCase): Promise<CaseResult> {
  const requestId = `corpus-${entry.id}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  const eventTypes = new Set<string>()
  let planCount: number | null = null
  const startedAt = Date.now()
  const signal = AbortSignal.timeout(entry.timeoutMs)
  const response = await fetch(`${baseUrl}${entry.mode === 'research' ? '/api/research' : '/api/ask'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: entry.query, focus: 'all', requestId, ...(model ? { model } : {}) }),
    signal,
  })
  if (!response.ok || !response.body) throw new Error(`${entry.id}: HTTP ${response.status}`)

  await readJsonSse<CorpusEvent>(response.body, {
    signal,
    onEvent: (event) => {
      if (event.requestId && event.requestId !== requestId) return
      eventTypes.add(event.type)
      if (event.type === 'plan' && event.data && typeof event.data === 'object') {
        const subQuestions = (event.data as { subQuestions?: unknown }).subQuestions
        if (Array.isArray(subQuestions)) planCount = subQuestions.length
      }
    },
  })

  const recordResponse = await fetch(`${baseUrl}/api/queries/${encodeURIComponent(requestId)}`)
  if (!recordResponse.ok) throw new Error(`${entry.id}: query record HTTP ${recordResponse.status}`)
  const payload = await recordResponse.json() as { record: QueryRecord }
  const record = payload.record
  const failures = evaluate(entry, record, eventTypes, planCount)
  return {
    id: entry.id,
    category: entry.category,
    mode: entry.mode,
    requestId,
    passed: failures.length === 0,
    failures,
    outcome: record.outcome,
    elapsedMs: record.timings.endToEndMs ?? Date.now() - startedAt,
    webSources: record.sourcePack.web.length,
    localSources: record.sourcePack.local.length,
    citationCoveragePct: record.grounding?.citationCoveragePct ?? null,
    groundingStatus: record.grounding?.status ?? null,
    engineWebProvider: record.retrievalDiagnostics?.web?.provider ?? null,
    localProvider: record.retrievalDiagnostics?.local?.provider ?? null,
    eventTypes: [...eventTypes],
  }
}

if (listOnly) {
  for (const entry of CORRECTNESS_CORPUS) console.log(`${entry.id}\t${entry.category}\t${entry.mode}\t${entry.query}`)
  process.exit(0)
}

const cases = selectedCase
  ? CORRECTNESS_CORPUS.filter((entry) => entry.id === selectedCase)
  : [...CORRECTNESS_CORPUS]
if (cases.length === 0) throw new Error(`Unknown corpus case: ${selectedCase}`)

const results: CaseResult[] = []
for (const entry of cases) {
  try {
    results.push(await runCase(entry))
  } catch (error) {
    results.push({
      id: entry.id,
      category: entry.category,
      mode: entry.mode,
      requestId: '',
      passed: false,
      failures: [error instanceof Error ? error.message : String(error)],
      outcome: 'harness-error',
      elapsedMs: 0,
      webSources: 0,
      localSources: 0,
      citationCoveragePct: null,
      groundingStatus: null,
      engineWebProvider: null,
      localProvider: null,
      eventTypes: [],
    })
  }
}

if (jsonOutput) {
  console.log(JSON.stringify({ baseUrl, model, asOf: CORRECTNESS_CORPUS[0]?.asOf, results }, null, 2))
} else {
  console.log(`KeepIndex correctness corpus · model=${model} · ${baseUrl}`)
  for (const result of results) {
    const status = result.passed ? 'PASS' : 'FAIL'
    const coverage = result.citationCoveragePct == null ? '-' : `${result.citationCoveragePct}%`
    console.log(`${status} ${result.id} · ${(result.elapsedMs / 1000).toFixed(1)}s · web=${result.webSources} local=${result.localSources} · grounding=${result.groundingStatus ?? '-'} ${coverage}`)
    for (const failure of result.failures) console.log(`  - ${failure}`)
  }
  console.log(`${results.filter((result) => result.passed).length}/${results.length} cases passed`)
}

if (results.some((result) => !result.passed)) process.exitCode = 1
