import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { MODEL_BENCHMARK_CASES, benchmarkMessages, scoreBenchmarkAnswer } from '../server/model-benchmark'

type Model = {
  id: string; temperature: number; purpose?: string; repository: string; revision: string
  file?: string; sizeBytes?: number; sha256?: string; args?: string; reasoningEffort?: string
}
type Completion = {
  text: string; elapsedMs: number; firstContentMs: number | null; finishReason: string | null
  promptTokens: number | null; outputTokens: number | null; tokensPerSecond: number | null
  reportedModel: string | null; fingerprint: string | null; reasoningChars: number
}

const arg = (name: string, fallback = '') => {
  const i = process.argv.indexOf(name)
  return i < 0 ? fallback : process.argv[i + 1] ?? fallback
}
const base = arg('--url', 'http://127.0.0.1:13305/api').replace(/\/$/, '')
const host = new URL(base).hostname
if (!['127.0.0.1', 'localhost', '[::1]', 'host.docker.internal'].includes(host)) throw new Error('This benchmark only calls a runtime on this computer.')
const manifestPath = resolve(arg('--manifest', 'docs/benchmarks/2026-09-11/models.json'))
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { models: Model[] }
const filter = arg('--models').split(',').filter(Boolean)
const temperatureOverride = arg('--temperature')
if (temperatureOverride && (!Number.isFinite(Number(temperatureOverride)) || Number(temperatureOverride) < 0 || Number(temperatureOverride) > 2)) throw new Error('temperature must be 0..2')
const models = manifest.models.filter(m => !filter.length || filter.includes(m.id))
  .map(m => temperatureOverride ? { ...m, temperature: Number(temperatureOverride) } : m)
if (!models.length) throw new Error('No matching models')
if (filter.some(id => !models.some(m => m.id === id))) throw new Error('An explicitly requested model is missing from the manifest')
const repetitions = Number(arg('--repeats', '2'))
const seedOffset = Number(arg('--seed-offset', '0'))
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw new Error('repeats must be 1..10')
if (!Number.isSafeInteger(seedOffset) || seedOffset < 0) throw new Error('seed-offset must be a nonnegative integer')
const output = resolve(arg('--output', '/tmp/keepindex-model-benchmark.json'))
const cases = MODEL_BENCHMARK_CASES.filter(c => !arg('--case') || c.id === arg('--case'))
if (!cases.length) throw new Error('No matching benchmark case')
const records: Record<string, unknown>[] = []
const reports: Record<string, unknown>[] = []
const corpusHash = createHash('sha256').update(JSON.stringify(MODEL_BENCHMARK_CASES)).digest('hex')
const promptHash = createHash('sha256').update(JSON.stringify(MODEL_BENCHMARK_CASES.map(benchmarkMessages))).digest('hex')
const startedAt = new Date().toISOString()

async function request(path: string, body?: unknown, timeoutMs = 90_000) {
  const response = await fetch(`${base}/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeoutMs),
  })
  const data = await response.json() as Record<string, unknown>
  if (!response.ok || data.status === 'error') throw new Error(`${path}: HTTP ${response.status} ${JSON.stringify(data).slice(0, 500)}`)
  return data
}

async function complete(model: Model, messages: ReturnType<typeof benchmarkMessages>, seed: number): Promise<Completion> {
  const started = performance.now()
  const response = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90_000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model.id, messages, stream: true,
      stream_options: { include_usage: true }, max_tokens: 1024,
      temperature: model.temperature, top_p: 0.95, seed, cache_prompt: false,
      chat_template_kwargs: { enable_thinking: false },
      ...(model.reasoningEffort ? { reasoning_effort: model.reasoningEffort } : {}),
    }),
  })
  if (!response.ok || !response.body) throw new Error(`completion: HTTP ${response.status}`)
  const result: Completion = { text: '', elapsedMs: 0, firstContentMs: null, finishReason: null, promptTokens: null, outputTokens: null, tokensPerSecond: null, reportedModel: null, fingerprint: null, reasoningChars: 0 }
  let doneFrame = false
  const parse = (line: string) => {
    if (!line.startsWith('data:')) return
    const raw = line.slice(5).trim()
    if (raw === '[DONE]') { doneFrame = true; return }
    if (!raw) return
    const d = JSON.parse(raw)
    if (d.error) throw new Error('Inference stream returned an error')
    // Lemonade sometimes exposes a GGUF path as model identity; omit paths in
    // public artifacts and separately verify loaded model via its health API.
    if (typeof d.model === 'string' && !/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(d.model)) result.reportedModel = d.model
    if (d.system_fingerprint) result.fingerprint = d.system_fingerprint
    const choice = d.choices?.[0]
    if (choice?.delta?.content) {
      result.firstContentMs ??= performance.now() - started
      result.text += choice.delta.content
    }
    result.reasoningChars += (choice?.delta?.reasoning_content ?? '').length
    if (choice?.finish_reason) result.finishReason = choice.finish_reason
    if (typeof d.usage?.prompt_tokens === 'number') result.promptTokens = d.usage.prompt_tokens
    if (typeof d.usage?.completion_tokens === 'number') result.outputTokens = d.usage.completion_tokens
    if (typeof d.timings?.predicted_per_second === 'number') result.tokensPerSecond = d.timings.predicted_per_second
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      pending += decoder.decode(value, { stream: true })
      if (pending.length > 2_000_000 || result.text.length > 100_000) throw new Error('Oversized inference output')
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) parse(line)
    }
    pending += decoder.decode()
    if (pending.trim()) parse(pending)
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  result.elapsedMs = performance.now() - started
  if (!doneFrame) throw new Error('Incomplete SSE stream')
  if (result.reportedModel && result.reportedModel !== model.id) throw new Error(`Model substitution: requested ${model.id}, received ${result.reportedModel}`)
  return result
}

async function save() {
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify({ schemaVersion: 1, startedAt, updatedAt: new Date().toISOString(), corpusHash, promptHash,
    configuration: { contextSize: 16384, parallel: 1, maxTokens: 1024, repetitions, seedOffset, cachePrompt: false, toolHarness: false, synthesisAndSelectionProxy: true },
    models: reports, results: records,
  }, null, 2) + '\n')
}

for (const model of models) {
  console.log(`Loading ${model.id}`)
  const loadStarted = performance.now()
  const report: Record<string, unknown> = { ...model, status: 'loading' }
  reports.push(report)
  try {
    const catalog = await request('models')
    const installed = (catalog.data as Array<Record<string, unknown>>).find(m => m.id === model.id)
    if (installed?.downloaded !== true || installed.recipe !== 'llamacpp') throw new Error('Model must already be downloaded with the llama.cpp recipe')
    if (typeof installed.checkpoint !== 'string' || !installed.checkpoint.startsWith(`${model.repository}:`)) throw new Error('Installed model repository does not match the manifest; verify its weights before benchmarking')
    // One model at a time; saved runtime options are not overwritten.
    await request('unload', {})
    await request('load', { model_name: model.id, ctx_size: 16384, llamacpp_backend: 'rocm',
      llamacpp_args: `--parallel 1 -b 512 -ub 256${model.args ? ` ${model.args}` : ''}`,
      merge_args: false, save_options: false }, 120_000)
    report.switchAndLoadMs = performance.now() - loadStarted
    const health = await request('health')
    const loaded = (health.all_models_loaded as Array<Record<string, unknown>>).find(m => m.model_name === model.id)
    if (!loaded?.loaded || loaded.backend_alive !== true) throw new Error('Requested model is not alive in Lemonade health')
    report.backend = loaded.recipe_options
    report.device = loaded.device
    report.lemonadeVersion = health.version
    report.hostMemoryGbAfterLoad = (await request('system-stats')).memory_gb
    const warmup = await complete(model, [{ role: 'user', content: 'Reply with exactly: ready' }], 123)
    report.warmupMs = warmup.elapsedMs
    report.fingerprint = warmup.fingerprint
    report.status = 'testing'
    let consecutiveTimeouts = 0
    trials: for (let repeat = 0; repeat < repetitions; repeat++) {
      // Rotate order between repetitions; no repeated prompt cache advantage.
      const ordered = [...cases.slice(repeat % cases.length), ...cases.slice(0, repeat % cases.length)]
      for (const entry of ordered) {
        const seed = 700 + seedOffset + repeat
        const caseStarted = performance.now()
        try {
          const response = await complete(model, benchmarkMessages(entry), seed)
          consecutiveTimeouts = 0
          const score = scoreBenchmarkAnswer(entry, response.text)
          if (response.finishReason !== 'stop') { score.passed = false; score.failures.push(`finish reason: ${response.finishReason}`) }
          records.push({ model: model.id, caseId: entry.id, task: entry.task, repeat, seed, ...response, score })
          console.log(`${model.id} ${repeat + 1}/${repetitions} ${entry.id}: ${score.passed ? 'PASS' : 'FAIL'} ${(response.elapsedMs / 1000).toFixed(2)}s ${score.failures.join('; ')}`)
        } catch (error) {
          records.push({ model: model.id, caseId: entry.id, task: entry.task, repeat, seed, elapsedMs: performance.now() - caseStarted, error: String(error), score: { passed: false } })
          console.log(`${model.id} ${entry.id}: ERROR ${String(error)}`)
          consecutiveTimeouts = error instanceof Error && error.name === 'TimeoutError' ? consecutiveTimeouts + 1 : 0
        }
        await save()
        if (consecutiveTimeouts >= 2) {
          report.status = 'stalled'
          report.error = 'Stopped after two consecutive timeouts; remaining trials were not completed.'
          await request('unload', {})
          break trials
        }
      }
    }
    if (report.status === 'testing') report.status = 'tested'
  } catch (error) {
    report.status = 'unavailable'
    // Runtime error messages can contain local paths. Keep raw diagnostics in
    // local logs; only publish the failure class in the benchmark artifact.
    report.error = 'Model load or warmup failed; see compatibility notes.'
    console.error(`${model.id}: ${String(error)}`)
  }
  await save()
}
console.log(`Saved ${output}`)
