import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { MODEL_BENCHMARK_CASES, benchmarkMessages, scoreBenchmarkAnswer } from '../server/model-benchmark'

type Result = {
  model: string; task: 'answer' | 'rank'; caseId: string; seed: number; error?: string; text?: string
  elapsedMs?: number; firstContentMs?: number | null; tokensPerSecond?: number | null
  finishReason?: string; score: {
    passed: boolean; factRecall?: number | null; supportedFactFraction?: number | null
    precision?: number | null; recall?: number | null; ndcg?: number | null
  }
}
type Model = { id: string; status: string; temperature: number; sizeBytes?: number; args?: string; fingerprint?: string; revision?: string; file?: string; reasoningEffort?: string }
type Report = { corpusHash: string; promptHash: string; configuration: { contextSize: number; parallel: number; maxTokens: number }; models: Model[]; results: Result[] }
const args = process.argv.slice(2)
const flag = args.indexOf('--output-dir')
const outputDir = resolve(flag < 0 ? '/tmp/keepindex-model-summary' : args[flag + 1])
if (flag >= 0) args.splice(flag, 2)
if (!args.length) throw new Error('Provide one or more benchmark result JSON files.')
const inputs = await Promise.all(args.map(async path => JSON.parse(await readFile(path, 'utf8')) as Report | { reports: Report[] }))
const reports = inputs.flatMap(input => 'reports' in input ? input.reports : [input])
if (!reports.length) throw new Error('No benchmark reports in the input files.')
if (new Set(reports.map(r => `${r.corpusHash}:${r.promptHash}`)).size !== 1) throw new Error('Cannot combine different corpora or prompts.')
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
if (reports[0].corpusHash !== hash(JSON.stringify(MODEL_BENCHMARK_CASES)) || reports[0].promptHash !== hash(JSON.stringify(MODEL_BENCHMARK_CASES.map(benchmarkMessages)))) throw new Error('These results do not match the current benchmark corpus and prompts.')
if (new Set(reports.map(r => JSON.stringify([r.configuration.contextSize, r.configuration.parallel, r.configuration.maxTokens]))).size !== 1) throw new Error('Compare different context/token limits in separate reports.')
const scorerHash = hash(await readFile(new URL('../server/model-benchmark.ts', import.meta.url), 'utf8'))
// Recompute metrics uniformly from raw text. Correcting a metric's format
// handling must not favor whichever model happened to run after that fix.
for (const report of reports) for (const result of report.results) {
  const entry = MODEL_BENCHMARK_CASES.find(c => c.id === result.caseId)
  if (entry && typeof result.text === 'string') {
    result.score = scoreBenchmarkAnswer(entry, result.text)
    if (result.finishReason !== 'stop') result.score.passed = false
  }
}
const groups = new Map<string, { model: Model; results: Result[] }>()
const seen = new Set<string>()
for (const report of reports) {
  for (const model of report.models) {
    const key = JSON.stringify([model.id, model.revision, model.file, model.temperature, model.args, model.reasoningEffort, model.fingerprint])
    const group = groups.get(key) ?? { model, results: [] }
    if (model.status !== 'tested') group.model = model
    const results = report.results.filter(r => r.model === model.id)
    for (const result of results) {
      const identity = `${key}|${result.caseId}|${result.seed}`
      if (seen.has(identity)) throw new Error(`Duplicate trial: ${identity}`)
      seen.add(identity)
    }
    group.results.push(...results)
    groups.set(key, group)
  }
}
const average = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
const percentile = (xs: number[], fraction: number) => xs.length ? [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * fraction) - 1)] : null
const numeric = (xs: Array<number | null | undefined>): number[] => xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
const pct = (x: number | null) => x == null ? '—' : `${(100 * x).toFixed(1)}%`
const seconds = (x: number | null) => x == null ? '—' : (x / 1000).toFixed(2)
const rows = [...groups.values()].map(({ model, results }) => {
  const answers = results.filter(r => r.task === 'answer')
  const ranking = results.filter(r => r.task === 'rank')
  return {
    model: model.id, temperature: model.temperature, status: model.status,
    weightsGiB: model.sizeBytes ? model.sizeBytes / 2 ** 30 : null,
    answerPass: answers.filter(r => r.score.passed).length, answerCount: answers.length,
    rankPass: ranking.filter(r => r.score.passed).length, rankCount: ranking.length,
    requiredFactRecall: average(numeric(answers.map(r => r.error ? 0 : r.score.factRecall))),
    requiredFactsWithSupportingCitations: average(numeric(answers.map(r => r.error ? 0 : r.score.supportedFactFraction))),
    rankPrecision: average(ranking.map(r => r.score.precision ?? 0)),
    rankRecall: average(ranking.map(r => r.score.recall ?? 0)),
    rankNdcg: average(ranking.map(r => r.score.ndcg ?? 0)),
    medianAnswerMs: percentile(numeric(answers.map(r => r.elapsedMs)), 0.5),
    p95AnswerMs: percentile(numeric(answers.map(r => r.elapsedMs)), 0.95),
    medianFirstContentMs: percentile(numeric(answers.map(r => r.firstContentMs)), 0.5),
    medianTokensPerSecond: percentile(numeric(answers.map(r => r.tokensPerSecond)), 0.5),
    medianRankMs: percentile(numeric(ranking.map(r => r.elapsedMs)), 0.5),
    longPack: answers.filter(r => r.caseId === 'long-pack-needle').map(r => ({ passed: r.score.passed, elapsedMs: r.elapsedMs, finishReason: r.finishReason })),
    errors: results.filter(r => r.error).length,
    truncated: results.filter(r => r.finishReason === 'length').length,
    fingerprint: model.fingerprint ?? null,
  }
})

const markdown = [
  '# Measured model matrix', '',
  'Answer pass is a strict composite of required facts, supporting citations, abstention/conflict handling, output limits, and successful completion. It is not a general accuracy percentage. Selection pass requires the exact relevant-document set and valid JSON. Read the methodology and raw outputs before choosing a model.', '',
  '| Model | Status | Temp | Weights GiB | Answer passes | Required facts | Cited facts (strict) | Selection passes | Answer p50 / p95 (s) | First content p50 (s) | Generation tok/s p50 |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...rows.map(r => `| ${r.model} | ${r.status} | ${r.temperature} | ${r.weightsGiB?.toFixed(2) ?? '—'} | ${r.answerPass}/${r.answerCount} | ${pct(r.requiredFactRecall)} | ${pct(r.requiredFactsWithSupportingCitations)} | ${r.rankPass}/${r.rankCount} | ${seconds(r.medianAnswerMs)} / ${seconds(r.p95AnswerMs)} | ${seconds(r.medianFirstContentMs)} | ${r.medianTokensPerSecond?.toFixed(1) ?? '—'} |`),
  '', 'Cited facts uses the specified placement of a supporting citation after the fact in the same sentence/bullet. A preceding citation can be understandable to a reader while failing this output contract. These percentages are case-macro averages, not an independent semantic audit of every claim.', '',
  '| Model | Temp | Selection precision | Selection recall | nDCG | Selection p50 (s) |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
  ...rows.map(r => `| ${r.model} | ${r.temperature} | ${pct(r.rankPrecision)} | ${pct(r.rankRecall)} | ${r.rankNdcg?.toFixed(3) ?? '—'} | ${seconds(r.medianRankMs)} |`),
  '', 'Context-1 is a retrieval specialist. Its answer column is an out-of-role experiment; selection is a fixed-candidate proxy, not a reproduction of its agentic retrieval harness.', '',
  'Weights are GGUF file sizes, not loaded RAM/VRAM. Generation rates use backend-reported token timings. Different tokenizers, output lengths, sampling settings, and MTP modes limit comparisons of raw token rates. Load time is excluded; request errors and truncations remain failures.', '',
  `Corpus SHA-256: \`${reports[0].corpusHash}\``,
  `Prompt SHA-256: \`${reports[0].promptHash}\``, '',
  `Scorer SHA-256: \`${scorerHash}\``, '',
]
await mkdir(outputDir, { recursive: true })
await writeFile(resolve(outputDir, 'matrix.md'), markdown.join('\n'))
await writeFile(resolve(outputDir, 'summary.json'), JSON.stringify(rows, null, 2) + '\n')
await writeFile(resolve(outputDir, 'scored-results.json'), JSON.stringify({ scorerHash, reports }, null, 2) + '\n')
const columns = ['model', 'status', 'temperature', 'weightsGiB', 'answerPass', 'answerCount', 'requiredFactRecall', 'requiredFactsWithSupportingCitations', 'rankPass', 'rankCount', 'rankPrecision', 'rankRecall', 'rankNdcg', 'medianAnswerMs', 'p95AnswerMs', 'medianFirstContentMs', 'medianTokensPerSecond', 'medianRankMs', 'errors', 'truncated'] as const
const csv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
await writeFile(resolve(outputDir, 'matrix.csv'), [columns.map(csv).join(','), ...rows.map(row => columns.map(c => csv(row[c])).join(','))].join('\n') + '\n')
console.log(markdown.join('\n'))
