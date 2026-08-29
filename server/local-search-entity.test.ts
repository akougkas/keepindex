/**
 * Local-retrieval recall regressions. Every chunk here is invented; no real
 * vault path, person, or credential appears in this file.
 *
 * These tests assert the behavior local search must have. Several fail today.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { __test__, type KnowledgeChunk } from './index'

const { searchKnowledge, setKnowledgeIndex, getLocalRetrievalDiagnostics, shortEntityQuery } = __test__

const MODIFIED_AT = Date.parse('2026-05-01T00:00:00Z')

function note(
  filePath: string,
  content: string,
  metadata: KnowledgeChunk['metadata'] = {}
): KnowledgeChunk {
  return {
    id: filePath,
    filePath,
    fileName: filePath.split('/').at(-1) ?? filePath,
    content,
    startLine: 1,
    endLine: content.split('\n').length,
    metadata: { sourceKind: 'note', extension: '.md', modifiedAt: MODIFIED_AT, ...metadata },
  }
}

function paths(results: ReadonlyArray<{ filePath: string }>): string[] {
  return results.map((result) => result.filePath).sort()
}

const CONTEXT_GUIDE = '/home/u/vault/notes/context-engineering-guide.md'
const PROMPT_BUDGET = '/home/u/vault/notes/prompt-context-budgeting.md'
const VECTOR_DESIGN = '/home/u/vault/notes/local-vector-index-design.md'

function technicalNoteIndex(): KnowledgeChunk[] {
  return [
    note(
      CONTEXT_GUIDE,
      [
        'Context engineering guide',
        'This note collects prompt patterns for retrieval-augmented answering.',
        'Budget the context window, order retrieved passages by score, and keep the system prompt stable across turns.',
        'Context engineering is the practice of shaping what the model sees.',
      ].join('\n')
    ),
    note(
      PROMPT_BUDGET,
      [
        'Prompt context budgeting',
        'Trim retrieved passages before the context window overflows the model limit.',
        'The engineering guide recommends dropping the lowest-scoring passage first.',
      ].join('\n')
    ),
    note(
      VECTOR_DESIGN,
      [
        'Local vector index design',
        'The index stores one embedding per chunk and rebuilds the posting list after every write.',
        'Recall stays flat until the shard count passes eight, then the vector design needs a rebalance.',
      ].join('\n')
    ),
    note(
      '/home/u/vault/notes/backup-retention.md',
      'Backup retention keeps nightly snapshots for fourteen days and weekly snapshots for a year.'
    ),
    note(
      '/home/u/vault/notes/mesh-routing.md',
      'Mesh routing tables converge after the third gossip round on a quiet link.'
    ),
    note(
      '/home/u/vault/notes/invoice-parsing.md',
      'Invoice parsing splits the totals table before the line items are reconciled.'
    ),
  ]
}

afterEach(() => setKnowledgeIndex([]))

describe('capitalization must not gate local recall', () => {
  it('does not treat an ordinary Title Case technical phrase as an entity lookup', () => {
    expect(shortEntityQuery('Context Engineering', ['context', 'engineering'])).toBe(false)
    expect(shortEntityQuery('Context Engineering Guide', ['context', 'engineering', 'guide'])).toBe(false)
    expect(shortEntityQuery('Local Vector Index Design', ['local', 'vector', 'index', 'design'])).toBe(false)
  })

  it('returns the same results for a two-token query in Title Case and lowercase', () => {
    setKnowledgeIndex(technicalNoteIndex())

    const lower = searchKnowledge('context engineering', 10)
    const title = searchKnowledge('Context Engineering', 10)

    expect(paths(lower)).toContain(CONTEXT_GUIDE)
    expect(paths(title)).toEqual(paths(lower))
    expect(getLocalRetrievalDiagnostics(title)?.entityCoverageRequired).toBe(false)
  })

  it('returns the same results for a three-token query in Title Case and lowercase', () => {
    setKnowledgeIndex(technicalNoteIndex())

    const lower = searchKnowledge('context engineering guide', 10)
    const title = searchKnowledge('Context Engineering Guide', 10)

    expect(paths(lower)).toContain(CONTEXT_GUIDE)
    expect(paths(lower)).toContain(PROMPT_BUDGET)
    expect(paths(title)).toEqual(paths(lower))
    expect(getLocalRetrievalDiagnostics(title)?.entityCoverageRequired).toBe(false)
  })

  it('returns the same results for a four-token query in Title Case and lowercase', () => {
    setKnowledgeIndex(technicalNoteIndex())

    const lower = searchKnowledge('local vector index design', 10)
    const title = searchKnowledge('Local Vector Index Design', 10)

    expect(paths(lower)).toContain(VECTOR_DESIGN)
    expect(paths(title)).toEqual(paths(lower))
    expect(getLocalRetrievalDiagnostics(title)?.entityCoverageRequired).toBe(false)
  })

  it('still requires descriptive entity context for an explicit person lookup', () => {
    const profile = '/home/u/vault/people/marisol-venn.md'
    const passingMention = '/home/u/vault/reading/week-four.md'
    setKnowledgeIndex([
      note(profile, 'Marisol Venn is a research scientist studying distributed storage schedulers.'),
      note(passingMention, 'Marisol Venn sits in the week four reading list next to two other names.'),
      ...technicalNoteIndex(),
    ])

    expect(shortEntityQuery('Who is Marisol Venn', ['marisol', 'venn'])).toBe(true)

    const results = searchKnowledge('Who is Marisol Venn', 10)
    expect(getLocalRetrievalDiagnostics(results)?.entityCoverageRequired).toBe(true)
    expect(paths(results)).toEqual([profile])
  })
})

describe('version tokens must not zero out local search', () => {
  const TARGET = '/home/u/vault/dev/react-upgrade-pin.md'

  function reactIndex(): KnowledgeChunk[] {
    const topics = [
      'The hooks rules require a stable call order in every react component render.',
      'A react effect hooks into the commit phase and cleans up before the next run.',
      'Memoized hooks keep a react render cheap when the dependency array is stable.',
      'React context hooks read from the nearest provider without a prop drill.',
      'Custom hooks compose smaller react primitives behind one named function.',
      'Suspense changes when react hooks resume after a thrown promise settles.',
      'Server components cannot use state hooks, so react splits the boundary explicitly.',
      'Concurrent react defers a transition, and hooks observe the deferred value.',
      'Testing hooks in react needs an act wrapper around every state update.',
    ]
    return [
      ...topics.map((content, index) => note(`/home/u/vault/dev/react-topic-${index}.md`, content)),
      note(
        TARGET,
        [
          'We pinned react 18.3.1 for the hooks migration.',
          'The 18.3.1 release only adds deprecation warnings ahead of the next major.',
        ].join('\n')
      ),
    ]
  }

  it('retrieves the note that pins an exact semantic version', () => {
    setKnowledgeIndex(reactIndex())

    const results = searchKnowledge('react 18.3.1 hooks', 10)
    expect(paths(results)).toContain(TARGET)
    expect(results[0]?.filePath).toBe(TARGET)
  })

  it('retrieves the pinned version note from the bare version query', () => {
    setKnowledgeIndex(reactIndex())

    const results = searchKnowledge('react 18.3.1', 10)
    expect(paths(results)).toContain(TARGET)
  })

  it('still retrieves the same corpus when the version token is absent', () => {
    setKnowledgeIndex(reactIndex())

    expect(searchKnowledge('react hooks', 10).length).toBeGreaterThan(0)
  })
})

describe('queries with no indexable token must not return arbitrary recent files', () => {
  function multilingualIndex(): KnowledgeChunk[] {
    return [
      note('/home/u/vault/notes/newest.md', 'Newest note about shard rebalancing.', {
        modifiedAt: Date.parse('2026-06-01T00:00:00Z'),
      }),
      note('/home/u/vault/notes/middle.md', 'Middle note about queue backpressure.', {
        modifiedAt: Date.parse('2026-03-01T00:00:00Z'),
      }),
      note('/home/u/vault/notes/oldest.md', 'Oldest note about cache eviction.', {
        modifiedAt: Date.parse('2025-11-01T00:00:00Z'),
      }),
    ]
  }

  for (const query of ['Πληροφορική ανάκτηση', '検索エンジンの設計', '???!!!', '…—…']) {
    it(`returns nothing for the untokenizable query ${JSON.stringify(query)}`, () => {
      setKnowledgeIndex(multilingualIndex())

      const results = searchKnowledge(query, 10)
      const diagnostics = getLocalRetrievalDiagnostics(results)

      expect(diagnostics?.queryTerms).toEqual([])
      expect(paths(results)).toEqual([])
      expect(results.filter((result) => result.queryCoverage === 1 && result.queryTermCount === 0)).toEqual([])
    })
  }

  it('still answers a tokenizable query against the same index', () => {
    setKnowledgeIndex(multilingualIndex())

    expect(paths(searchKnowledge('shard rebalancing', 10))).toEqual(['/home/u/vault/notes/newest.md'])
  })
})

describe('frontmatter aliases must be searchable as phrases', () => {
  const ALIASED = '/home/u/vault/notes/alpha-corpus-scoring.md'

  function aliasIndex(): KnowledgeChunk[] {
    return [
      note(
        ALIASED,
        [
          'The pipeline scores each shard of the alpha corpus independently.',
          'Shard scores are merged with a stable tie-break on the document id.',
        ].join('\n'),
        { aliases: ['Alpha Retrieval Guide', 'ARG'], tags: ['pipeline'] }
      ),
      ...technicalNoteIndex(),
    ]
  }

  it('retrieves a note by its verbatim alias phrase as written in the frontmatter', () => {
    setKnowledgeIndex(aliasIndex())

    expect(paths(searchKnowledge('Alpha Retrieval Guide', 10))).toContain(ALIASED)
  })

  it('retrieves a note by the lowercase form of the alias phrase', () => {
    setKnowledgeIndex(aliasIndex())

    expect(paths(searchKnowledge('alpha retrieval guide', 10))).toContain(ALIASED)
  })

  it('retrieves a note by a quoted alias phrase', () => {
    setKnowledgeIndex(aliasIndex())

    expect(paths(searchKnowledge('"Alpha Retrieval Guide"', 10))).toContain(ALIASED)
  })

  it('retrieves a note by its short alias token', () => {
    setKnowledgeIndex(aliasIndex())

    expect(paths(searchKnowledge('ARG', 10))).toContain(ALIASED)
  })
})
