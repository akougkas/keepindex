import { afterEach, describe, expect, test } from 'bun:test'
import { __test__, type KnowledgeChunk } from './index'

const BOUNDARY = Date.parse('2025-01-01T00:00:00Z')

function chunk(filePath: string, content: string, metadata: KnowledgeChunk['metadata']): KnowledgeChunk {
  return {
    id: filePath,
    filePath,
    fileName: filePath.split('/').at(-1) ?? filePath,
    content,
    startLine: 1,
    endLine: content.split('\n').length,
    metadata,
  }
}

const protocolNote = chunk(
  '/home/synthetic/vault/protocol/model-context-protocol.md',
  'The model context protocol standardises tool discovery for local agents. A streaming window keeps partial answers visible while retrieval finishes.',
  { sourceKind: 'note', extension: '.md', tags: ['protocol', 'agents'], modifiedAt: Date.parse('2026-03-05T00:00:00Z') }
)

const deprecatedNote = chunk(
  '/home/synthetic/vault/archive/deprecated-protocol-notes.md',
  'Deprecated notes describing the model context protocol before the streaming window rewrite landed.',
  { sourceKind: 'note', extension: '.md', tags: ['archive'], modifiedAt: Date.parse('2024-02-11T00:00:00Z') }
)

const specDocument = chunk(
  '/home/synthetic/documents/protocol-spec-draft.pdf',
  'Specification draft: the model context protocol defines transport framing and capability negotiation.',
  { sourceKind: 'document', extension: '.pdf', tags: ['protocol'], modifiedAt: Date.parse('2026-01-20T00:00:00Z') }
)

const clientFile = chunk(
  '/home/synthetic/code/runtime/protocol-client.ts',
  'Bootstrap for the model context protocol client used by the local agent runtime.',
  { sourceKind: 'file', extension: '.ts', tags: ['runtime'], modifiedAt: Date.parse('2026-02-02T00:00:00Z') }
)

const undatedNote = chunk(
  '/home/synthetic/vault/inbox/protocol-scratch.md',
  'Scratch capture of the model context protocol handshake with no recorded modification time.',
  { sourceKind: 'note', extension: '.md', tags: ['protocol'] }
)

function datedCorpus(): KnowledgeChunk[] {
  return [protocolNote, deprecatedNote, specDocument, clientFile].map((source) => ({ ...source }))
}

function names(results: { fileName: string }[]): string[] {
  return results.map((result) => result.fileName).sort()
}

afterEach(() => __test__.setKnowledgeIndex([]))

describe('inherited local search options', () => {
  test('retains an inherited phrase when the query carries no quotes', () => {
    const parsed = __test__.parseLocalSearchQuery('model context protocol', { phrases: ['context window streaming'] })
    expect(parsed.options.phrases).toEqual(['context window streaming'])
  })

  test('merges inherited phrases with inline quoted phrases', () => {
    const parsed = __test__.parseLocalSearchQuery('"model context protocol" notes', { phrases: ['context window streaming'] })
    expect([...(parsed.options.phrases ?? [])].sort()).toEqual(['context window streaming', 'model context protocol'])
  })

  test('retains inherited extensions, tags, and exclusions', () => {
    const parsed = __test__.parseLocalSearchQuery('model context protocol tag:agents', {
      extensions: ['.md'],
      tags: ['protocol'],
      excludedTerms: ['deprecated'],
    })
    expect(parsed.options).toMatchObject({
      extensions: ['.md'],
      excludedTerms: ['deprecated'],
    })
    expect([...(parsed.options.tags ?? [])].sort()).toEqual(['agents', 'protocol'])
  })

  test('searchKnowledge honours an inherited phrase that no chunk contains', () => {
    __test__.setKnowledgeIndex(datedCorpus())
    const results = __test__.searchKnowledge('model context protocol', 10, { phrases: ['context window streaming'] })
    expect(results).toHaveLength(0)
  })

  test('searchKnowledge keeps chunks that satisfy the inherited phrase', () => {
    __test__.setKnowledgeIndex(datedCorpus())
    const results = __test__.searchKnowledge('model context protocol', 10, { phrases: ['model context protocol'] })
    expect(names(results)).toEqual([
      'deprecated-protocol-notes.md',
      'model-context-protocol.md',
      'protocol-client.ts',
      'protocol-spec-draft.pdf',
    ])
  })

  test('a pre-parsed federated query keeps the same phrase constraint on re-entry', () => {
    __test__.setKnowledgeIndex(datedCorpus())
    const raw = '"model context protocol" "context window streaming"'
    const singleParse = __test__.searchKnowledge(raw, 20)
    const parsed = __test__.parseLocalSearchQuery(raw)
    const doubleParse = __test__.searchKnowledge(parsed.query, 20, parsed.options)
    expect(singleParse).toHaveLength(0)
    expect(doubleParse).toHaveLength(0)
  })
})

describe('quoted phrase semantics', () => {
  test('a single quoted phrase filters to chunks containing that exact phrase', () => {
    __test__.setKnowledgeIndex(datedCorpus())
    const results = __test__.searchKnowledge('"capability negotiation"', 10)
    expect(names(results)).toEqual(['protocol-spec-draft.pdf'])
  })

  test('a quoted phrase requires adjacency, not merely both words', () => {
    __test__.setKnowledgeIndex(datedCorpus())
    expect(__test__.searchKnowledge('streaming window', 10).length).toBeGreaterThan(0)
    expect(__test__.searchKnowledge('"window streaming"', 10)).toHaveLength(0)
  })

  test('two quoted phrases are combined with AND', () => {
    __test__.setKnowledgeIndex(datedCorpus())
    expect(__test__.searchKnowledge('"model context protocol" "streaming window"', 20).length).toBeGreaterThan(0)
    expect(__test__.searchKnowledge('"model context protocol" "context window streaming"', 20)).toHaveLength(0)
  })
})

describe('structured operators', () => {
  test('type: restricts results to one source kind', () => {
    __test__.setKnowledgeIndex(datedCorpus())
    expect(names(__test__.searchKnowledge('model context protocol type:note', 10))).toEqual([
      'deprecated-protocol-notes.md',
      'model-context-protocol.md',
    ])
    expect(names(__test__.searchKnowledge('model context protocol type:document', 10))).toEqual([
      'protocol-spec-draft.pdf',
    ])
  })

  test('ext: restricts results to one file extension', () => {
    __test__.setKnowledgeIndex(datedCorpus())
    expect(names(__test__.searchKnowledge('model context protocol ext:ts', 10))).toEqual(['protocol-client.ts'])
  })

  test('path: restricts results to a path fragment', () => {
    __test__.setKnowledgeIndex(datedCorpus())
    expect(names(__test__.searchKnowledge('model context protocol path:"synthetic/vault"', 10))).toEqual([
      'deprecated-protocol-notes.md',
      'model-context-protocol.md',
    ])
  })

  test('tag: restricts results to chunks carrying every requested tag', () => {
    __test__.setKnowledgeIndex(datedCorpus())
    expect(names(__test__.searchKnowledge('model context protocol tag:protocol', 10))).toEqual([
      'model-context-protocol.md',
      'protocol-spec-draft.pdf',
    ])
    expect(names(__test__.searchKnowledge('model context protocol tag:protocol tag:agents', 10))).toEqual([
      'model-context-protocol.md',
    ])
  })

  test('-term excludes chunks mentioning the term anywhere', () => {
    __test__.setKnowledgeIndex(datedCorpus())
    expect(names(__test__.searchKnowledge('model context protocol -deprecated', 10))).toEqual([
      'model-context-protocol.md',
      'protocol-client.ts',
      'protocol-spec-draft.pdf',
    ])
  })

  test('before: keeps only chunks modified before the boundary', () => {
    __test__.setKnowledgeIndex(datedCorpus())
    expect(names(__test__.searchKnowledge('model context protocol before:2025-01-01', 10))).toEqual([
      'deprecated-protocol-notes.md',
    ])
  })

  test('after: keeps only chunks modified after the boundary', () => {
    __test__.setKnowledgeIndex(datedCorpus())
    expect(names(__test__.searchKnowledge('model context protocol after:2025-01-01', 10))).toEqual([
      'model-context-protocol.md',
      'protocol-client.ts',
      'protocol-spec-draft.pdf',
    ])
  })
})

describe('date filters with unknown modification time', () => {
  test('after: excludes a chunk with no recorded modifiedAt', () => {
    expect(__test__.localChunkMatchesOptions(undatedNote, { after: BOUNDARY })).toBe(false)
  })

  test('before: excludes a chunk with no recorded modifiedAt', () => {
    expect(__test__.localChunkMatchesOptions(undatedNote, { before: BOUNDARY })).toBe(false)
  })

  test('a chunk with a known modifiedAt still passes both directions', () => {
    expect(__test__.localChunkMatchesOptions(deprecatedNote, { before: BOUNDARY })).toBe(true)
    expect(__test__.localChunkMatchesOptions(protocolNote, { after: BOUNDARY })).toBe(true)
  })

  test('an undated chunk is not returned by a date-filtered search', () => {
    __test__.setKnowledgeIndex([{ ...protocolNote }, { ...undatedNote }])
    expect(names(__test__.searchKnowledge('model context protocol before:2025-01-01', 10))).toEqual([])
    expect(names(__test__.searchKnowledge('model context protocol after:2025-01-01', 10))).toEqual([
      'model-context-protocol.md',
    ])
  })
})

describe('token-bounded exclusion and path-isolated phrase semantics (KIX-08)', () => {
  test('-term does not exclude a chunk that contains the term as a substring of other words', () => {
    const emailChunk = chunk(
      '/home/synthetic/vault/notes/daily-update.md',
      'Please send an email with the daily implementation details as said in the standup meeting.',
      { sourceKind: 'note', extension: '.md' }
    )
    __test__.setKnowledgeIndex([emailChunk])
    const results = __test__.searchKnowledge('implementation details -ai', 10)
    expect(results).toHaveLength(1)
    expect(results[0].fileName).toBe('daily-update.md')
  })

  test('-term does not exclude a chunk whose directory path contains the term', () => {
    const noteInTestDir = chunk(
      '/home/synthetic/vault/test-fixtures/architecture.md',
      'Architecture overview of the local indexing engine and pipeline design.',
      { sourceKind: 'note', extension: '.md' }
    )
    __test__.setKnowledgeIndex([noteInTestDir])
    const results = __test__.searchKnowledge('indexing engine -test', 10)
    expect(results).toHaveLength(1)
    expect(results[0].fileName).toBe('architecture.md')
  })

  test('quoted phrase matches across markdown line wraps with collapsed whitespace', () => {
    const wrappedNote = chunk(
      '/home/synthetic/vault/notes/wrap.md',
      'This document covers machine\nlearning algorithms for offline semantic retrieval.',
      { sourceKind: 'note', extension: '.md' }
    )
    __test__.setKnowledgeIndex([wrappedNote])
    const results = __test__.searchKnowledge('"machine learning algorithms"', 10)
    expect(results).toHaveLength(1)
    expect(results[0].fileName).toBe('wrap.md')
  })

  test('quoted phrase does not match directory path segments', () => {
    const note = chunk(
      '/home/synthetic/vault/user-guides/offline-search.md',
      'Comprehensive documentation for private search indexing.',
      { sourceKind: 'note', extension: '.md' }
    )
    __test__.setKnowledgeIndex([note])
    const results = __test__.searchKnowledge('"user guides"', 10)
    expect(results).toHaveLength(0)
  })

  test('searchKnowledgeAcrossQueries invokes searchKnowledgeCore directly without re-parsing operators (KIX-09)', () => {
    const note = chunk(
      '/home/synthetic/vault/notes/operator-query.md',
      'Discussion about tag:protocol syntax and -negation operator behaviors in search queries.',
      { sourceKind: 'note', extension: '.md' }
    )
    __test__.setKnowledgeIndex([note])

    // Under searchKnowledge, "tag:protocol" would be parsed away into an options filter and query becomes empty
    const directResults = __test__.searchKnowledgeCore('tag:protocol', 10)
    expect(directResults).toHaveLength(1)
    expect(directResults[0].fileName).toBe('operator-query.md')

    const acrossResults = __test__.searchKnowledgeAcrossQueries(['tag:protocol', 'syntax'], 10)
    expect(acrossResults).toHaveLength(1)
    expect(acrossResults[0].fileName).toBe('operator-query.md')
  })
})

