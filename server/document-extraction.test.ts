import { describe, expect, test } from 'bun:test'
import { classifySourceKind, extractIndexableFile, extractObsidianMetadata } from './document-extraction'

describe('document classification and Obsidian metadata', () => {
  test('classifies vault notes, documents, code, and ordinary files', () => {
    expect(classifySourceKind('idea.md', true)).toBe('note')
    expect(classifySourceKind('paper.pdf', false)).toBe('document')
    expect(classifySourceKind('search.ts', false)).toBe('code')
    expect(classifySourceKind('archive.bin', false)).toBe('file')
  })

  test('extracts aliases, tags, and wiki links without duplicates', () => {
    const metadata = extractObsidianMetadata(`---
aliases: [Search Fabric, "Private Search"]
tags:
  - retrieval
  - local/search
---
# Search architecture
#retrieval #privacy
Connect [[Browser Memory|history]] with [[Local Vault#Notes]].
`)
    expect(metadata.aliases).toEqual(['Search Fabric', 'Private Search'])
    expect(metadata.tags).toEqual(['retrieval', 'local/search', 'privacy'])
    expect(metadata.outgoingLinks).toEqual(['Browser Memory', 'Local Vault'])
  })

  test('normalizes JSON and marks Obsidian notes as text-extracted', async () => {
    const extracted = await extractIndexableFile({
      path: '/tmp/idea.md',
      fileName: 'idea.md',
      size: 30,
      modifiedAt: Date.now(),
      obsidianRoot: true,
      readText: async () => '---\ntags: [knowledge]\n---\nSee [[Index]].',
    })
    expect(extracted.metadata).toMatchObject({
      sourceKind: 'note',
      extractor: 'text',
      mimeType: 'text/markdown',
      tags: ['knowledge'],
      outgoingLinks: ['Index'],
    })
  })

  test('keeps unsupported files searchable through metadata', async () => {
    const extracted = await extractIndexableFile({
      path: '/tmp/diagram.sketch',
      fileName: 'diagram.sketch',
      size: 2048,
      modifiedAt: 1_700_000_000_000,
      obsidianRoot: false,
      readText: async () => { throw new Error('must not read binary') },
    })
    expect(extracted.metadata.metadataOnly).toBe(true)
    expect(extracted.text).toContain('Name: diagram.sketch')
    expect(extracted.text).toContain('Size: 2048 bytes')
  })
})
