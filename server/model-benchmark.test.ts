import { describe, expect, it } from 'bun:test'
import { MODEL_BENCHMARK_CASES, scoreBenchmarkAnswer } from './model-benchmark'

describe('release model benchmark scoring', () => {
  const exact = MODEL_BENCHMARK_CASES[0]
  it('requires correct facts and their supporting citations', () => {
    expect(scoreBenchmarkAnswer(exact, 'Aster permits 2 upload retries and uses a timeout of 45 seconds [L1].').passed).toBe(true)
    expect(scoreBenchmarkAnswer(exact, 'Aster permits **2 upload retries** and uses a timeout of **45 seconds** [L1].').passed).toBe(true)
    expect(scoreBenchmarkAnswer(exact, 'Aster permits 2 upload retries and uses a timeout of 45 seconds [L2].').passed).toBe(false)
    expect(scoreBenchmarkAnswer(exact, 'Aster permits 2 upload retries and uses a timeout of 45 seconds.').passed).toBe(false)
  })
  it('rejects fabricated citations and facts despite correct-looking output', () => {
    expect(scoreBenchmarkAnswer(exact, '2 upload retries and 45 seconds [L1]. Extra claim [L99].').passed).toBe(false)
    expect(scoreBenchmarkAnswer(exact, '2 upload retries and 45 seconds with exponential backoff [L1].').passed).toBe(false)
    expect(scoreBenchmarkAnswer(exact, '3 upload retries and 30 seconds [L1].').passed).toBe(false)
  })
  it('does not borrow a citation from a later sentence', () => {
    const score = scoreBenchmarkAnswer(exact, 'Aster permits 2 upload retries. The unrelated themes number 7 [L1]. Timeout is 45 seconds [L1].')
    expect(score.supportedFactFraction).toBe(0.5)
  })
  it('scores complete document selection and rejects extra distractors', () => {
    const entry = MODEL_BENCHMARK_CASES.find(c => c.id === 'rank-exact-project')!
    expect(scoreBenchmarkAnswer(entry, '{"ids":["D4","D2"]}').passed).toBe(true)
    expect(scoreBenchmarkAnswer(entry, '```json\n{"ids":["D4","D2"]}\n```').passed).toBe(true)
    const unquoted = scoreBenchmarkAnswer(entry, '[D2, D4]')
    expect(unquoted.passed).toBe(false)
    expect(unquoted.rankingFormatValid).toBe(false)
    expect(unquoted.precision).toBe(1)
    expect(unquoted.recall).toBe(1)
    const array = scoreBenchmarkAnswer(entry, '["D2", "D4"]')
    expect(array.passed).toBe(false)
    expect(array.precision).toBe(1)
    const wrong = scoreBenchmarkAnswer(entry, '{"ids":["D1","D2","D4"]}')
    expect(wrong.precision).toBeCloseTo(2 / 3)
    expect(wrong.ndcg).toBeLessThan(1)
    expect(wrong.passed).toBe(false)
    expect(scoreBenchmarkAnswer(entry, '{"ids":["D2","D2","D4"]}').passed).toBe(false)
  })
  it('does not count malformed or empty output as successful abstention', () => {
    const entry = MODEL_BENCHMARK_CASES.find(c => c.id === 'rank-no-evidence')!
    expect(scoreBenchmarkAnswer(entry, '{"ids":[]}').passed).toBe(true)
    expect(scoreBenchmarkAnswer(entry, '').passed).toBe(false)
    expect(scoreBenchmarkAnswer(entry, 'There is no evidence.').passed).toBe(false)
    expect(scoreBenchmarkAnswer(entry, '').precision).toBe(0)
    expect(scoreBenchmarkAnswer(entry, 'There is no evidence.').recall).toBe(0)
    expect(scoreBenchmarkAnswer(entry, '[]').precision).toBe(1)
    expect(scoreBenchmarkAnswer(entry, '[]').passed).toBe(false)
  })
  it('accepts units on arithmetic operands without accepting wrong results', () => {
    const entry = MODEL_BENCHMARK_CASES.find(c => c.id === 'simple-derived-number')!
    expect(scoreBenchmarkAnswer(entry, '80 GiB - 12 GiB - 18 GiB = 50 GiB [L1].').passed).toBe(true)
    expect(scoreBenchmarkAnswer(entry, '80 GiB - 12 GiB - 18 GiB = 60 GiB [L1].').passed).toBe(false)
    expect(scoreBenchmarkAnswer(entry, '80 GiB - 12 GiB - 18 GiB = 50 GiB [L2].').passed).toBe(false)
  })
})
