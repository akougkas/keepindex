import { afterEach, describe, expect, test } from 'bun:test'
import { __test__, type KnowledgeChunk } from './index'

function chunk(id: string, filePath: string, content: string, metadata: KnowledgeChunk['metadata']): KnowledgeChunk {
  return {
    id,
    filePath,
    fileName: filePath.split('/').at(-1) ?? filePath,
    content,
    startLine: 1,
    endLine: content.split('\n').length,
    metadata,
  }
}

afterEach(() => __test__.setKnowledgeIndex([]))

describe('local search operators', () => {
  test('parses source, extension, path, tag, date, phrase, and exclusion filters', () => {
    const parsed = __test__.parseLocalSearchQuery('"search fabric" type:note ext:md path:"projects/keepindex" tag:retrieval after:2025-01-01 before:2027-01-01 -deprecated')
    expect(parsed.query).toBe('search fabric')
    expect(parsed.options).toMatchObject({
      target: 'vault',
      sourceKinds: ['note'],
      extensions: ['.md'],
      pathContains: 'projects/keepindex',
      tags: ['retrieval'],
      phrases: ['search fabric'],
      excludedTerms: ['deprecated'],
      after: Date.parse('2025-01-01T00:00:00Z'),
      before: Date.parse('2027-01-01T00:00:00Z'),
    })
  })

  test('applies structured filters before BM25 ranking', () => {
    __test__.setKnowledgeIndex([
      chunk('note', '/home/user/vault/projects/keepindex/design.md', 'The search fabric combines private retrieval sources.', {
        sourceKind: 'note', extension: '.md', tags: ['retrieval'], modifiedAt: Date.parse('2026-04-01T00:00:00Z'),
      }),
      chunk('wrong-tag', '/home/user/vault/projects/keepindex/deprecated.md', 'The search fabric is a deprecated design.', {
        sourceKind: 'note', extension: '.md', tags: ['archive'], modifiedAt: Date.parse('2026-04-01T00:00:00Z'),
      }),
      chunk('document', '/home/user/docs/search.pdf', 'The search fabric report covers retrieval.', {
        sourceKind: 'document', extension: '.pdf', tags: ['retrieval'], modifiedAt: Date.parse('2026-04-01T00:00:00Z'),
      }),
    ])

    const matches = __test__.searchKnowledge('"search fabric" type:note path:projects/keepindex tag:retrieval -deprecated', 10)
    expect(matches.map((result) => result.fileName)).toEqual(['design.md'])
    expect(matches[0]).toMatchObject({ sourceKind: 'note', extension: '.md', tags: ['retrieval'] })
  })
})
