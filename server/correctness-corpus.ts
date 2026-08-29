/**
 * KeepIndex's five-case live correctness corpus.
 *
 * The date-sensitive cases are frozen at 2026-08-28 so a future release does
 * not silently change today's gold answer. The harness grades the exact source
 * pack persisted by KeepIndex, not a browser rendering or uncited model memory.
 */

export type CorrectnessCorpusCase = {
  id: string
  category: 'world-knowledge' | 'timely-recent' | 'tricky-complex' | 'deep-research' | 'local-web-fusion'
  mode: 'ai' | 'research'
  asOf: string
  query: string
  expectedSummary: string
  timeoutMs: number
  expectations: {
    minSources: number
    maxSources: number
    minWebSources: number
    minLocalSources: number
    minDistinctWebHosts?: number
    requiredWebUrlPatterns?: string[]
    requiredLocalFileNames?: string[]
    answerPatterns: string[]
    forbiddenAnswerPatterns?: string[]
    evidencePatterns?: string[]
    minCitationCoveragePct: number
    requiredGroundingStatus: 'strong' | 'mixed' | 'weak' | 'ungrounded'
    requiredEventTypes: string[]
    planQuestionRange?: [number, number]
  }
}

export const CORRECTNESS_CORPUS_AS_OF = '2026-08-28T23:59:59Z'

export const CORRECTNESS_CORPUS: readonly CorrectnessCorpusCase[] = [
  {
    id: 'world-seasons',
    category: 'world-knowledge',
    mode: 'ai',
    asOf: CORRECTNESS_CORPUS_AS_OF,
    query: 'Why does Earth have seasons? Explain the physical mechanism, why Earth–Sun distance is not the main cause, and why the Northern and Southern Hemispheres have opposite seasons. Cite authoritative scientific sources.',
    expectedSummary: 'Axial tilt (about 23.4–23.5°) changes solar angle and day length; opposite hemispheres reverse, and orbital distance is not the primary cause.',
    timeoutMs: 240_000,
    expectations: {
      minSources: 2,
      maxSources: 18,
      minWebSources: 2,
      minLocalSources: 0,
      minDistinctWebHosts: 1,
      requiredWebUrlPatterns: ['(?:nasa\\.gov|weather\\.gov)'],
      answerPatterns: [
        '23\\.(?:4|5)',
        'axial tilt|axis.{0,30}tilt|tilted axis',
        'Northern.{0,120}Southern|Southern.{0,120}Northern',
        'opposite|revers',
        'direct.{0,30}(?:sun|solar)|solar angle|day length|longer days',
        'distance.{0,80}(?:not|isn.t).{0,30}(?:main|primary|cause)|not.{0,40}(?:caused|driven).{0,30}distance',
      ],
      forbiddenAnswerPatterns: [
        'seasons (?:are|are primarily|are mainly) caused by (?:the )?Earth.?s distance',
        'both hemispheres (?:experience|have) (?:the )?(?:same|identical) season',
      ],
      evidencePatterns: ['tilt', '23\\.(?:4|5)|perihelion|aphelion'],
      minCitationCoveragePct: 80,
      requiredGroundingStatus: 'strong',
      requiredEventTypes: ['sources', 'quality', 'metrics', 'done'],
    },
  },
  {
    id: 'recent-bun-release',
    category: 'timely-recent',
    mode: 'ai',
    asOf: CORRECTNESS_CORPUS_AS_OF,
    query: 'As of 2026-08-28, what is the latest stable Bun release and when was it published? Exclude drafts and prereleases. Verify it against both Bun’s official release post and the oven-sh/bun GitHub release record.',
    expectedSummary: 'At the frozen cutoff, Bun 1.4 / bun-v1.4.0 is the latest stable release and both official records date it August 20, 2026.',
    timeoutMs: 240_000,
    expectations: {
      minSources: 2,
      maxSources: 18,
      minWebSources: 2,
      minLocalSources: 0,
      minDistinctWebHosts: 2,
      requiredWebUrlPatterns: [
        'github\\.com/oven-sh/bun/releases(?:/tag/bun-v1\\.4\\.0)?',
        'bun\\.(?:com|sh)/(?:blog/)?bun-v1\\.4|bun\\.com/1\\.4',
      ],
      answerPatterns: [
        'Bun (?:v)?1\\.4',
        'bun-v1\\.4\\.0',
        '2026-08-20|August 20,? 2026',
        'stable|non-prerelease|not a prerelease',
      ],
      forbiddenAnswerPatterns: [
        '(?:^|\\n)The latest stable.{0,40}1\\.3\\.',
        '(?:1\\.3\\.\\d+[^\\n]{0,180}(?:older|outdated|superseded|predates)[^\\n]{0,120}\\bconflict(?:s|ed|ing)?\\b|\\bconflict(?:s|ed|ing)?\\b[^\\n]{0,120}(?:older|outdated|superseded|predates)[^\\n]{0,180}1\\.3\\.\\d+)',
      ],
      evidencePatterns: ['Bun (?:v)?1\\.4|bun-v1\\.4\\.0', 'Aug(?:ust)? 20,? 2026|2026-08-20'],
      minCitationCoveragePct: 80,
      requiredGroundingStatus: 'strong',
      requiredEventTypes: ['sources', 'quality', 'metrics', 'done'],
    },
  },
  {
    id: 'http-retry-after',
    category: 'tricky-complex',
    mode: 'ai',
    asOf: CORRECTNESS_CORPUS_AS_OF,
    query: 'Under the normative HTTP specifications, is a server required to send Retry-After with 429 Too Many Requests? May it send Retry-After with 503 Service Unavailable, and what two field-value forms are valid? Quote the RFC requirement levels (MUST/SHOULD/MAY) precisely.',
    expectedSummary: 'RFC 6585 says 429 MAY include Retry-After; RFC 9110 says 503 MAY send it, and values are HTTP-date or non-negative delay-seconds.',
    timeoutMs: 240_000,
    expectations: {
      minSources: 2,
      maxSources: 18,
      minWebSources: 2,
      minLocalSources: 0,
      minDistinctWebHosts: 1,
      requiredWebUrlPatterns: [
        '(?:rfc-editor\\.org/(?:rfc/|info/)?rfc6585|httpwg\\.org/specs/rfc6585|datatracker\\.ietf\\.org/doc/html/rfc6585)',
        '(?:rfc-editor\\.org/(?:rfc/|info/)?rfc9110|httpwg\\.org/specs/rfc9110|datatracker\\.ietf\\.org/doc/html/rfc9110)',
      ],
      answerPatterns: [
        '429.{0,160}(?:MAY|optional|not required)|(?:MAY|optional|not required).{0,160}429',
        '503.{0,160}MAY|MAY.{0,160}503',
        'HTTP-date',
        'delay-seconds',
        'non-negative|decimal integer',
      ],
      forbiddenAnswerPatterns: [
        'server (?:MUST|is required to) (?:send|include) Retry-After with (?:a )?429',
        'Retry-After.{0,80}(?:invalid|not permitted|forbidden).{0,40}503',
        '503.{0,120}(?:server )?SHOULD (?:send|include)|server.{0,80}SHOULD (?:send|include).{0,80}503',
        'RFC 6585\s*(?:§|section)\s*7\.2',
        'Retry-Under',
      ],
      evidencePatterns: ['429.{0,160}MAY|MAY.{0,160}429', '503.{0,320}MAY|MAY.{0,320}503'],
      minCitationCoveragePct: 80,
      requiredGroundingStatus: 'strong',
      requiredEventTypes: ['sources', 'quality', 'metrics', 'done'],
    },
  },
  {
    id: 'research-chunking',
    category: 'deep-research',
    mode: 'research',
    asOf: CORRECTNESS_CORPUS_AS_OF,
    query: 'Design an evidence-based chunking policy and experiment for KeepIndex’s local Markdown vault. KeepIndex currently retrieves vault chunks with BM25 and must make no cloud calls. Compare fixed/token windows, recursive or structure-aware splitting, embedding-based semantic chunking, and late chunking across retrieval quality, context preservation, build/query latency, index cost, and operational complexity. Clearly separate published findings from hypotheses, and prioritize original papers or first-party technical reports through 2026-08-28.',
    expectedSummary: 'No universal chunker wins; benchmark four strategies on a frozen corpus while treating semantic and late chunking as explicitly local embedding architecture-expansion arms.',
    timeoutMs: 600_000,
    expectations: {
      minSources: 6,
      maxSources: 18,
      minWebSources: 5,
      minLocalSources: 1,
      minDistinctWebHosts: 3,
      requiredWebUrlPatterns: [
        '(?:trychroma\\.com/research/evaluating-chunking|research\\.trychroma\\.com/evaluating-chunking)',
        'arxiv\\.org/abs/2409\\.04701',
      ],
      requiredLocalFileNames: ['Evaluating Chunking Strategies for Retrieval.md'],
      answerPatterns: [
        '(?:^|\\n)#{1,2}\\s+Executive Summary\\b',
        '(?:^|\\n)#{1,2}\\s+Key Findings & Core Analysis\\b',
        '(?:^|\\n)#{1,2}\\s+Technical Details & Evidence Comparison\\b',
        '(?:^|\\n)#{1,2}\\s+Open Questions & Future Outlook\\b',
        'fixed|token window',
        'recursive|structure-aware',
        'semantic chunk',
        'late chunk',
        'BM25',
        'embedding',
        'no (?:universal|single).{0,30}(?:best|winner|optimal)|(?:best|winner|optimal).{0,30}not universal|corpus-dependent|(?:cannot|does not|not enough to) support (?:a )?definitive recommendation|quality rankings.{0,50}not established',
        'precision',
        'recall',
        'MRR',
        'IoU|Jaccard',
        'latency',
        'index (?:size|cost)|memory|build time|storage per token|embedding dimension',
        'local embedding|locally hosted|no cloud',
        'hypoth',
      ],
      evidencePatterns: ['chunk', 'late chunk|2409\\.04701'],
      minCitationCoveragePct: 80,
      requiredGroundingStatus: 'strong',
      requiredEventTypes: ['plan', 'searching', 'sources', 'synthesizing', 'quality', 'metrics', 'done'],
      planQuestionRange: [3, 5],
    },
  },
  {
    id: 'fusion-anthropic-agents',
    category: 'local-web-fusion',
    mode: 'ai',
    asOf: CORRECTNESS_CORPUS_AS_OF,
    query: 'Using my saved vault clipping “Building effective agents.md” and Anthropic’s current official “Building effective agents” page, compare them as of 2026-08-28. Explain Anthropic’s workflow-versus-agent distinction, enumerate the five workflow patterns, summarize when they advise adding agentic complexity, and report any substantive disagreement or evidence of staleness. Do not treat the saved clipping and live page as independent corroboration.',
    expectedSummary: 'Both same-origin artifacts distinguish predefined workflows from model-directed agents and list five patterns; compare staleness without claiming independent corroboration.',
    timeoutMs: 240_000,
    expectations: {
      minSources: 2,
      maxSources: 18,
      minWebSources: 1,
      minLocalSources: 1,
      minDistinctWebHosts: 1,
      requiredWebUrlPatterns: ['anthropic\\.com/(?:engineering|research)/building-effective-agents'],
      requiredLocalFileNames: ['Building effective agents.md'],
      answerPatterns: [
        'prompt chaining',
        'routing',
        'parallelization',
        'orchestrator-workers',
        'evaluator-optimizer',
        'predefined.{0,80}(?:code paths|workflow)',
        'dynamic.{0,100}(?:process|tool use|direct)',
        'simplest solution|add complexity only|complexity only when',
        'latency.{0,60}cost|cost.{0,60}latency',
        'not independent(?:ly)?|non-independent|same[- ]origin|saved copy|rather than independent(?:ly)?|(?:cannot|did not|never).{0,100}independent(?:ly)?',
        'no (?:substantive )?(?:conflict|disagreement)|cannot (?:report|find|confirm).{0,80}(?:conflict|disagreement|diverg)|(?:fragments|excerpts).{0,80}(?:consistent|agree)',
        '\\[L\\d+\\]',
        '\\[\\d+\\]',
      ],
      forbiddenAnswerPatterns: [
        '(?:two|independent) (?:independent )?(?:sources|confirmations).{0,50}(?:corroborate|confirm)',
        'byte-for-byte identical|complete(?:ly)? identical|verbatim copy|actually the same document',
      ],
      evidencePatterns: ['workflow', 'agent'],
      minCitationCoveragePct: 80,
      requiredGroundingStatus: 'strong',
      requiredEventTypes: ['sources', 'quality', 'metrics', 'done'],
    },
  },
] as const
