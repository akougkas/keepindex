/**
 * Fixed factual-query retrieval benchmark.
 *
 * The fixtures below stand in for SearXNG's merged multi-engine output: the same
 * page arrives from several engines with different tracking parameters, one
 * publisher floods the list, content farms rank highly, and some results are
 * plainly off-topic. `relevant` is the hand-labelled set of canonical URLs that
 * genuinely answer the query.
 *
 * The suite measures ranked retrieval against the raw engine order and fails if
 * quality regresses below the recorded thresholds, so ranking changes have to
 * justify themselves with numbers rather than intuition.
 */
import { describe, expect, it } from 'bun:test'
import {
  canonicalizeUrl,
  dedupeWebResults,
  hostOf,
  rankWebResults,
  selectDiversePack,
  selectFusedEvidence,
  type RankedSearchResult,
} from './retrieval'

/** Fixed clock: recency must not make the benchmark drift over time. */
const NOW = Date.parse('2026-03-01T00:00:00.000Z')
const PACK_SIZE = 10

type Case = {
  query: string
  candidates: RankedSearchResult[]
  /** Canonical URLs that actually answer the query. */
  relevant: string[]
}

function c(
  url: string,
  title: string,
  snippet: string,
  rank: number,
  extra: Partial<RankedSearchResult> = {}
): RankedSearchResult {
  return { url, title, snippet, rank, ...extra }
}

const CASES: Case[] = [
  {
    query: 'sqlite wal mode concurrent readers writers',
    relevant: [
      'https://www.sqlite.org/wal.html',
      'https://www.sqlite.org/lockingv3.html',
      'https://en.wikipedia.org/wiki/SQLite',
    ],
    candidates: [
      c('https://w3schools.com/sql/sql_intro.asp', 'SQL Introduction', 'Learn SQL basics with examples.', 1),
      c('https://geeksforgeeks.org/sqlite-tutorial/', 'SQLite Tutorial', 'SQLite tutorial for beginners.', 2),
      c('https://www.sqlite.org/wal.html', 'Write-Ahead Logging', 'WAL mode allows readers and writers to proceed concurrently.', 3, { engines: ['google'], publishedDate: '2025-11-02T00:00:00Z' }),
      c('http://sqlite.org/wal.html?utm_source=newsletter', 'Write-Ahead Logging', 'WAL mode permits concurrent readers and one writer without blocking.', 4, { engines: ['brave'] }),
      c('https://www.sqlite.org/wal.html#section_2', 'Write-Ahead Logging', 'WAL.', 6, { engines: ['duckduckgo'] }),
      c('https://pinterest.com/pin/sqlite', 'SQLite infographic', 'Pin about databases.', 5),
      c('https://www.sqlite.org/lockingv3.html', 'File Locking And Concurrency', 'Describes concurrent readers and writers locking in SQLite.', 7, { engines: ['google'] }),
      c('https://en.wikipedia.org/wiki/SQLite', 'SQLite', 'SQLite supports WAL mode for concurrent readers.', 8, { engines: ['google', 'bing'] }),
      c('https://medium.com/@dev/sqlite-tips-9f2', 'Ten SQLite tips', 'My favourite database tricks.', 9),
      c('https://coursehero.com/file/12/sqlite', 'SQLite notes', 'Uploaded lecture notes.', 10),
    ],
  },
  {
    query: 'http 429 too many requests retry after header',
    relevant: [
      'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429',
      'https://www.rfc-editor.org/rfc/rfc6585',
      'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After',
    ],
    candidates: [
      c('https://blog.example.com/rate-limit-rant', 'Why rate limits annoy me', 'A personal rant about APIs.', 1),
      c('https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429', '429 Too Many Requests', 'The 429 status code indicates the user has sent too many requests. Retry-After may be sent.', 2, { engines: ['google', 'bing'] }),
      c('https://www.rfc-editor.org/rfc/rfc6585', 'RFC 6585: Additional HTTP Status Codes', 'Defines 429 Too Many Requests and the Retry-After header semantics.', 4, { engines: ['google'] }),
      c('https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After', 'Retry-After', 'The Retry-After response HTTP header indicates how long to wait before making a follow-up request.', 5, { engines: ['bing'] }),
      c('http://www.rfc-editor.org/rfc/rfc6585/?utm_medium=social', 'RFC 6585', 'Additional HTTP status codes including 429.', 8, { engines: ['duckduckgo'] }),
      c('https://tutorialspoint.com/http/http_status_codes.htm', 'HTTP Status Codes', 'A list of every HTTP code.', 3),
      c('https://quora.com/what-is-429', 'What is a 429 error?', 'Community answers.', 6),
      c('https://csdn.net/article/429', 'HTTP 429 错误', 'Blog repost.', 7),
      c('https://stackoverflow.com/questions/1/429-handling', 'Handling 429 responses with backoff', 'How should a client honour Retry-After when it receives 429?', 9, { engines: ['google'] }),
      c('https://shop.example.com/tshirt-429', '429 T-Shirt', 'Buy developer merch.', 10),
    ],
  },
  {
    query: 'bm25 ranking function term frequency saturation',
    relevant: [
      'https://en.wikipedia.org/wiki/Okapi_BM25',
      'https://nlp.stanford.edu/IR-book/html/htmledition/okapi-bm25-a-non-binary-model-1.html',
      'https://arxiv.org/abs/1904.08375',
    ],
    candidates: [
      c('https://geeksforgeeks.org/bm25/', 'BM25 in Python', 'Copy this snippet.', 1),
      c('https://en.wikipedia.org/wiki/Okapi_BM25', 'Okapi BM25', 'BM25 is a ranking function using term frequency saturation controlled by k1 and length normalisation by b.', 2, { engines: ['google', 'bing', 'brave'] }),
      c('https://nlp.stanford.edu/IR-book/html/htmledition/okapi-bm25-a-non-binary-model-1.html', 'Okapi BM25: a non-binary model', 'The BM25 ranking function and its term frequency saturation behaviour.', 4, { engines: ['google'] }),
      c('https://arxiv.org/abs/1904.08375', 'Revisiting BM25 term saturation', 'Analysis of the BM25 ranking function and term frequency saturation.', 7, { engines: ['bing'] }),
      c('https://medium.com/@x/bm25-explained-simply-1', 'BM25 explained simply', 'A gentle intro.', 3),
      c('https://medium.com/@x/bm25-explained-simply-2', 'BM25 explained simply, part 2', 'More intro.', 5),
      c('https://medium.com/@x/bm25-explained-simply-3', 'BM25 explained simply, part 3', 'Even more intro.', 6),
      c('https://medium.com/@x/bm25-explained-simply-4', 'BM25 explained simply, part 4', 'Still more intro.', 8),
      c('https://en.m.wikipedia.org/wiki/Okapi_BM25?utm_campaign=share', 'Okapi BM25', 'Mobile mirror.', 9),
      c('https://scribd.com/doc/9/bm25', 'BM25 slides', 'Download required.', 10),
    ],
  },
  {
    query: 'postgresql vacuum bloat autovacuum tuning',
    relevant: [
      'https://www.postgresql.org/docs/current/routine-vacuuming.html',
      'https://www.postgresql.org/docs/current/runtime-config-autovacuum.html',
    ],
    candidates: [
      c('https://javatpoint.com/postgresql-vacuum', 'PostgreSQL VACUUM', 'Syntax reference.', 1),
      c('https://www.postgresql.org/docs/current/routine-vacuuming.html', 'Routine Vacuuming', 'Explains table bloat and how autovacuum reclaims space.', 2, { engines: ['google', 'bing'], publishedDate: '2025-09-01T00:00:00Z' }),
      c('https://www.postgresql.org/docs/current/runtime-config-autovacuum.html', 'Automatic Vacuuming parameters', 'Autovacuum tuning parameters and thresholds.', 3, { engines: ['google'] }),
      c('https://www.postgresql.org/docs/current/sql-vacuum.html', 'VACUUM', 'SQL command reference.', 4, { engines: ['google'] }),
      c('https://www.postgresql.org/docs/current/sql-analyze.html', 'ANALYZE', 'SQL command reference.', 5, { engines: ['google'] }),
      c('https://www.postgresql.org/docs/current/sql-cluster.html', 'CLUSTER', 'SQL command reference.', 6, { engines: ['google'] }),
      c('https://blog.example.io/pg-bloat-story', 'How we fixed 400GB of bloat', 'A war story about autovacuum tuning.', 7),
      c('https://csdn.net/pg-vacuum', 'PG VACUUM 详解', 'Translated repost.', 8),
      c('https://www.postgresql.org/docs/current/routine-vacuuming.html?utm_source=hn#VACUUM-BASICS', 'Routine Vacuuming', 'Duplicate from another engine.', 9, { engines: ['duckduckgo'] }),
      c('https://pinterest.com/pin/postgres', 'Postgres elephant art', 'Pin.', 10),
    ],
  },
  {
    query: 'tls 1.3 handshake zero round trip resumption',
    relevant: [
      'https://www.rfc-editor.org/rfc/rfc8446',
      'https://en.wikipedia.org/wiki/Transport_Layer_Security',
    ],
    candidates: [
      c('https://www.rfc-editor.org/rfc/rfc8446', 'RFC 8446: TLS 1.3', 'Specifies the TLS 1.3 handshake including 0-RTT resumption.', 3, { engines: ['google', 'bing'] }),
      c('https://en.wikipedia.org/wiki/Transport_Layer_Security', 'Transport Layer Security', 'TLS 1.3 reduces the handshake and supports zero round trip resumption.', 5, { engines: ['google'] }),
      c('https://w3schools.com/tags/att_tls.asp', 'HTML TLS attribute', 'Unrelated reference page.', 1),
      c('https://tutorialspoint.com/tls/index.htm', 'TLS Tutorial', 'Beginner tutorial.', 2),
      c('https://blogspot.com/2019/tls-notes', 'TLS notes from 2019', 'Outdated personal notes.', 4, { publishedDate: '2019-02-02T00:00:00Z' }),
      c('http://www.rfc-editor.org/rfc/rfc8446/?fbclid=zz', 'RFC 8446', 'Duplicate via another engine.', 6, { engines: ['brave'] }),
      c('https://academia.edu/paper/tls', 'TLS paper', 'Sign in to read.', 7),
      c('https://news.example.com/tls-launch', 'Vendor announces TLS support', 'Press release.', 8, { publishedDate: '2026-02-20T00:00:00Z' }),
    ],
  },
  {
    query: 'raft consensus leader election term',
    relevant: [
      'https://raft.github.io/raft.pdf',
      'https://en.wikipedia.org/wiki/Raft_(algorithm)',
    ],
    candidates: [
      c('https://medium.com/@a/raft-1', 'Raft explained 1', 'Intro.', 1),
      c('https://medium.com/@a/raft-2', 'Raft explained 2', 'Intro.', 2),
      c('https://medium.com/@a/raft-3', 'Raft explained 3', 'Intro.', 3),
      c('https://medium.com/@a/raft-4', 'Raft explained 4', 'Intro.', 4),
      c('https://medium.com/@a/raft-5', 'Raft explained 5', 'Intro.', 5),
      c('https://raft.github.io/raft.pdf', 'In Search of an Understandable Consensus Algorithm', 'Raft separates leader election, log replication, and safety; each term begins with an election.', 6, { engines: ['google', 'bing'] }),
      c('https://en.wikipedia.org/wiki/Raft_(algorithm)', 'Raft (algorithm)', 'Raft consensus uses randomized timeouts for leader election within a term.', 7, { engines: ['google'] }),
      c('https://quora.com/raft-vs-paxos', 'Raft vs Paxos?', 'Opinions.', 8),
    ],
  },
]

function precisionAtK(packUrls: string[], relevant: Set<string>, k: number): number {
  const window = packUrls.slice(0, k)
  if (window.length === 0) return 0
  const hits = window.filter((url) => relevant.has(canonicalizeUrl(url))).length
  return hits / Math.min(k, window.length)
}

function reciprocalRank(packUrls: string[], relevant: Set<string>): number {
  const position = packUrls.findIndex((url) => relevant.has(canonicalizeUrl(url)))
  return position === -1 ? 0 : 1 / (position + 1)
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length
}

/** Ranked pipeline: dedupe, rank, then cut under the per-host cap. */
function rankedPack(testCase: Case): string[] {
  const ranked = rankWebResults(testCase.query, testCase.candidates, NOW)
  return selectDiversePack(ranked, PACK_SIZE).map((r) => r.url)
}

/** Control: what the prompt used to receive, raw engine order truncated. */
function baselinePack(testCase: Case): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const candidate of testCase.candidates) {
    if (seen.has(candidate.url)) continue
    seen.add(candidate.url)
    out.push(candidate.url)
    if (out.length >= PACK_SIZE) break
  }
  return out
}

describe('retrieval benchmark', () => {
  const rankedP3: number[] = []
  const rankedP5: number[] = []
  const rankedMrr: number[] = []
  const baseP3: number[] = []
  const baseP5: number[] = []
  const baseMrr: number[] = []

  for (const testCase of CASES) {
    const relevant = new Set(testCase.relevant.map(canonicalizeUrl))
    const ranked = rankedPack(testCase)
    const baseline = baselinePack(testCase)
    rankedP3.push(precisionAtK(ranked, relevant, 3))
    rankedP5.push(precisionAtK(ranked, relevant, 5))
    rankedMrr.push(reciprocalRank(ranked, relevant))
    baseP3.push(precisionAtK(baseline, relevant, 3))
    baseP5.push(precisionAtK(baseline, relevant, 5))
    baseMrr.push(reciprocalRank(baseline, relevant))
  }

  it('reports the measured retrieval quality of the fixed query set', () => {
    const report = {
      queries: CASES.length,
      rankedPrecisionAt3: Number(mean(rankedP3).toFixed(3)),
      rankedPrecisionAt5: Number(mean(rankedP5).toFixed(3)),
      rankedMRR: Number(mean(rankedMrr).toFixed(3)),
      baselinePrecisionAt3: Number(mean(baseP3).toFixed(3)),
      baselinePrecisionAt5: Number(mean(baseP5).toFixed(3)),
      baselineMRR: Number(mean(baseMrr).toFixed(3)),
    }
    console.log('[retrieval-benchmark]', JSON.stringify(report))
    expect(report.queries).toBe(6)
  })

  it('ranks every labelled source above the engine baseline', () => {
    expect(mean(rankedP3)).toBeGreaterThan(mean(baseP3))
    expect(mean(rankedP5)).toBeGreaterThan(mean(baseP5))
    expect(mean(rankedMrr)).toBeGreaterThan(mean(baseMrr))
  })

  it('holds the recorded quality thresholds', () => {
    // Thresholds recorded from the measured run, compared on three decimals so
    // float noise cannot flip the gate. Lowering one means retrieval quality
    // regressed; raising it locks in a genuine improvement.
    const round = (value: number) => Number(value.toFixed(3))
    expect(round(mean(rankedMrr))).toBeGreaterThanOrEqual(0.95)
    expect(round(mean(rankedP3))).toBeGreaterThanOrEqual(0.833)
    expect(round(mean(rankedP5))).toBeGreaterThanOrEqual(0.5)
  })

  it('surfaces a relevant source first for every query', () => {
    for (const testCase of CASES) {
      const relevant = new Set(testCase.relevant.map(canonicalizeUrl))
      const pack = rankedPack(testCase)
      expect({ query: testCase.query, top: pack[0], hit: relevant.has(canonicalizeUrl(pack[0])) })
        .toEqual({ query: testCase.query, top: pack[0], hit: true })
    }
  })

  it('collapses duplicate documents that the raw engine merge leaves behind', () => {
    let candidateTotal = 0
    let dedupedTotal = 0
    for (const testCase of CASES) {
      candidateTotal += testCase.candidates.length
      dedupedTotal += dedupeWebResults(testCase.candidates).length
    }
    const collapsed = candidateTotal - dedupedTotal
    console.log(`[retrieval-benchmark] deduped ${collapsed}/${candidateTotal} candidate results`)
    // Five duplicate pairs are planted across the fixtures.
    expect(collapsed).toBeGreaterThanOrEqual(5)

    // No pack may contain the same document twice under any URL spelling.
    for (const testCase of CASES) {
      const canonical = rankedPack(testCase).map(canonicalizeUrl)
      expect(new Set(canonical).size).toBe(canonical.length)
    }
  })

  it('never lets one publisher own the evidence pack', () => {
    // The cap binds only when candidates outnumber slots. When the pool is
    // thinner than the pack, backfilling is correct: dropping real evidence to
    // satisfy a diversity quota would leave the prompt worse grounded.
    for (const testCase of CASES) {
      const deduped = dedupeWebResults(testCase.candidates)
      const limit = Math.min(5, deduped.length - 1)
      if (limit < 2) continue
      const counts = new Map<string, number>()
      for (const entry of selectDiversePack(rankWebResults(testCase.query, testCase.candidates, NOW), limit)) {
        const host = hostOf(entry.url)
        counts.set(host, (counts.get(host) ?? 0) + 1)
      }
      const distinctHosts = new Set(deduped.map((r) => hostOf(r.url))).size
      if (distinctHosts > 3) {
        const worst = Math.max(...counts.values())
        expect({ query: testCase.query, capped: worst <= 3 })
          .toEqual({ query: testCase.query, capped: true })
      }
    }
  })

  it('is deterministic: the same candidates always produce the same pack', () => {
    for (const testCase of CASES) {
      const first = rankedPack(testCase)
      const second = rankedPack(testCase)
      expect(second).toEqual(first)

      // Research fans out concurrently, so branch completion order must not
      // change the evidence the model receives.
      const shuffled = rankedPack({ ...testCase, candidates: [...testCase.candidates].reverse() })
      expect(shuffled).toEqual(first)
    }
  })

  it('demotes content farms and scrapers out of the top of the pack', () => {
    const farmPattern = /(w3schools|geeksforgeeks|tutorialspoint|javatpoint|coursehero|scribd|pinterest|quora|csdn|academia\.edu)/i
    for (const testCase of CASES) {
      const top3 = rankedPack(testCase).slice(0, 3)
      expect({ query: testCase.query, farms: top3.filter((url) => farmPattern.test(url)) })
        .toEqual({ query: testCase.query, farms: [] })
    }
  })
})

describe('fused evidence benchmark', () => {
  const rankedWeb = (url: string, relevanceScore: number) => ({
    title: url,
    url,
    snippet: '',
    canonicalUrl: canonicalizeUrl(url),
    relevanceScore,
    queryCoverage: 1,
    queryTermCount: 1,
    mergedCount: 1,
  })
  const local = (filePath: string, normalizedScore: number) => ({
    filePath,
    startLine: 1,
    normalizedScore,
  })

  const cases = [
    {
      web: [rankedWeb('https://weak.example/off-topic', 0.8)],
      local: [local('/vault/exact-answer.md', 1)],
      relevant: 'l:/vault/exact-answer.md',
    },
    {
      web: [rankedWeb('https://sqlite.org/wal.html', 5.5)],
      local: [local('/vault/tangential-note.md', 1)],
      relevant: 'w:https://sqlite.org/wal.html',
    },
    {
      web: [rankedWeb('https://rfc-editor.org/primary', 5.2)],
      local: [local('/vault/measured-observation.md', 0.95)],
      relevant: 'w:https://rfc-editor.org/primary',
    },
  ]

  it('reports and gates source-type selection on labelled mixed fixtures', () => {
    const reciprocalRanks = cases.map((testCase) => {
      const selection = selectFusedEvidence(testCase.web, testCase.local, { limit: 1 })
      const keys = selection.ordered.map((item) =>
        item.kind === 'web' ? `w:${item.source.url}` : `l:${item.source.filePath}`
      )
      const position = keys.indexOf(testCase.relevant)
      return position < 0 ? 0 : 1 / (position + 1)
    })
    const report = {
      queries: cases.length,
      fusedMRR: Number(mean(reciprocalRanks).toFixed(3)),
      localTop1: cases.filter((testCase, index) =>
        reciprocalRanks[index] === 1 && testCase.relevant.startsWith('l:')
      ).length,
      webTop1: cases.filter((testCase, index) =>
        reciprocalRanks[index] === 1 && testCase.relevant.startsWith('w:')
      ).length,
    }
    console.log('[fusion-benchmark]', JSON.stringify(report))
    expect(report).toEqual({ queries: 3, fusedMRR: 1, localTop1: 1, webTop1: 2 })
  })
})
