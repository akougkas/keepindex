import { describe, expect, it } from 'bun:test'
import { __test__ } from './index'

describe('path normalization and safety', () => {
  it('converts Windows drive paths to WSL paths', () => {
    expect(__test__.toWslPath('C:\\Users\\localuser\\Documents\\vault')).toBe(
      '/mnt/c/Users/localuser/Documents/vault'
    )
    expect(__test__.toWslPath('D:/data/notes')).toBe('/mnt/d/data/notes')
  })

  it('converts WSL UNC paths', () => {
    expect(__test__.toWslPath('\\\\wsl$\\Ubuntu\\home\\user\\vault')).toBe('/home/user/vault')
  })

  it('allows only subpaths under /home or /mnt', () => {
    expect(__test__.isAllowedKnowledgePath('/home')).toBe(false)
    expect(__test__.isAllowedKnowledgePath('/mnt')).toBe(false)
    expect(__test__.isAllowedKnowledgePath('/etc')).toBe(false)
    expect(__test__.isAllowedKnowledgePath('/home/user/vault')).toBe(true)
    expect(__test__.isAllowedKnowledgePath('/mnt/c/Users/localuser/Documents')).toBe(true)
  })
})

describe('prompt context formatting', () => {
  it('wraps journey context with explicit delimiters', () => {
    const formatted = __test__.formatJourneyContext('prior answer and sources')
    expect(formatted).toContain('<<<JOURNEY_CONTEXT>>>')
    expect(formatted).toContain('<<<END_JOURNEY_CONTEXT>>>')
  })

  it('removes stale citation identifiers from journey-memory answers', () => {
    const formatted = __test__.formatJourneyContext(
      'Earlier node: concurrency improved [3], with local caveats [L2] and grouped support [1, L4].'
    )
    expect(formatted).not.toContain('[3]')
    expect(formatted).not.toContain('[L2]')
    expect(formatted).not.toContain('[1, L4]')
    expect(formatted).toContain('Earlier node: concurrency improved')
  })

  it('wraps handoff context with explicit delimiters', () => {
    const formatted = __test__.formatHandoffContext('chat handoff summary')
    expect(formatted).toContain('<<<HANDOFF_CONTEXT>>>')
    expect(formatted).toContain('<<<END_HANDOFF_CONTEXT>>>')
  })

  it('removes stale citation identifiers from prior-turn handoff prose', () => {
    const formatted = __test__.formatHandoffContext(
      'Prior evidence said one thing [3] and another [L2]. Grouped support was [1, 4, L5].'
    )
    expect(formatted).not.toContain('[3]')
    expect(formatted).not.toContain('[L2]')
    expect(formatted).not.toContain('[1, 4, L5]')
    expect(formatted).toContain('Prior evidence said one thing')
  })
})

describe('model and streaming guarantees', () => {
  it('preserves any llama-server model id while removing control characters', () => {
    expect(__test__.normalizeModel('local-model-30b-omni')).toBe('local-model-30b-omni')
    expect(__test__.normalizeModel('  custom/model\u0000-v2  ')).toBe('custom/model-v2')
  })

  it('extracts reasoning_content and answer content independently', () => {
    expect(__test__.extractLlmDelta({
      choices: [{ delta: { reasoning_content: 'checking', content: 'answer' } }],
    })).toEqual({ reasoning: 'checking', content: 'answer' })
  })

  it('scores valid citations and rejects out-of-range citation ids', () => {
    const strong = __test__.assessGrounding(
      'SQLite WAL allows readers and writers to proceed concurrently in many workloads [1].',
      1,
      0
    )
    expect(strong.status).toBe('strong')
    expect(strong.invalidCitations).toEqual([])

    const weak = __test__.assessGrounding(
      'SQLite WAL allows readers and writers to proceed concurrently in many workloads [9].',
      1,
      0
    )
    expect(weak.status).toBe('weak')
    expect(weak.invalidCitations).toEqual(['9'])
  })

  it('accepts structured research plans and rejects planner reasoning prose', () => {
    expect(__test__.parseResearchPlan(
      '```json\n{"subQuestions":["What is verified?","What remains open?"]}\n```',
      'topic'
    )).toEqual(['What is verified?', 'What remains open?'])
    expect(__test__.parseResearchPlan(null, 'resilient retrieval')).toHaveLength(3)
    const fallback = __test__.parseResearchPlan(
      'The user wants me to break this topic down. Let me analyze the request carefully.',
      'resilient retrieval'
    )
    expect(fallback).toHaveLength(3)
    expect(fallback.join(' ')).not.toContain('The user wants me')
  })
})

describe('helper parsing and formatting', () => {
  it('never hydrates private-history evidence or any source on a private target', async () => {
    const originalFetch = globalThis.fetch
    let fetchCalls = 0
    globalThis.fetch = (async () => {
      fetchCalls += 1
      return new Response('<html><body>should not be fetched</body></html>', {
        headers: { 'Content-Type': 'text/html' },
      })
    }) as typeof fetch

    const base = {
      title: 'Visited public page',
      url: 'https://www.anthropic.com/engineering/building-effective-agents',
      snippet: 'Private history metadata only.',
      canonicalUrl: 'https://anthropic.com/engineering/building-effective-agents',
      relevanceScore: 1,
      mergedCount: 1,
    }
    try {
      const privateResults = await __test__.hydratePublicWebEvidence([
        { ...base, sourceType: 'history' as const, engines: ['browser-history-fts5'] },
        { ...base, sourceType: 'web' as const, engines: ['searxng', 'browser-history-fts5'] },
      ], 'private history query', {}, true)
      const privateTargetResults = await __test__.hydratePublicWebEvidence([
        { ...base, sourceType: 'web' as const, engines: ['searxng'] },
      ], 'private target query', {}, false)

      expect(fetchCalls).toBe(0)
      expect(privateResults.every((source) => source.snippet === base.snippet)).toBe(true)
      expect(privateResults.some((source) => Object.hasOwn(source, 'hydration'))).toBe(false)
      expect(privateTargetResults[0]?.snippet).toBe(base.snippet)
      expect(Object.hasOwn(privateTargetResults[0] ?? {}, 'hydration')).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('derives one saved-domain preference vote per collection', () => {
    const preferences = __test__.deriveCollectionHostPreferences([
      {
        id: 'one',
        query: 'q',
        answer: 'a',
        mode: 'ai',
        createdAt: 1,
        sources: [
          { url: 'https://docs.example.com/a' },
          { url: 'https://docs.example.com/b' },
          { url: 'https://other.example.com/c' },
        ],
      },
      {
        id: 'two',
        query: 'q2',
        answer: 'a2',
        mode: 'research',
        createdAt: 2,
        sources: [{ url: 'https://docs.example.com/d' }],
      },
    ])
    expect(preferences.get('docs.example.com')).toBe(2)
    expect(preferences.get('other.example.com')).toBe(1)
  })

  it('keeps chunk line ranges aligned with source text', () => {
    const text = Array.from({ length: 12 }, (_, index) => `line ${index + 1} ${'x'.repeat(20)}`).join('\n')
    const chunks = __test__.chunkText(text, 90, 20)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      const expected = text.split('\n').slice(chunk.startLine - 1, chunk.endLine).join('\n')
      expect(chunk.content).toBe(expected)
    }
  })

  it('allows only HTTP(S) source URLs', () => {
    expect(__test__.isSafeHttpUrl('https://example.com/source')).toBe(true)
    expect(__test__.isSafeHttpUrl('javascript:alert(1)')).toBe(false)
    expect(__test__.isSafeHttpUrl('file:///home/user/.ssh/id_rsa')).toBe(false)
  })

  it('extracts compact file path', () => {
    expect(__test__.compactFilePath('/a/b/c/d/e.md')).toBe('c/d/e.md')
  })

  it('parses json object from fenced output', () => {
    const parsed = __test__.parseJsonObject('```json\n{"gaps":["a"],"summary":"ok"}\n```')
    expect(parsed).not.toBeNull()
    expect((parsed as { summary?: string }).summary).toBe('ok')
  })

  it('normalizes and trims incoming query length', () => {
    const long = `   ${'x'.repeat(1300)}   `
    const normalized = __test__.normalizeIncomingQuery(long)
    expect(normalized.length).toBe(1003)
    expect(normalized.endsWith('...')).toBe(true)
    expect(normalized.startsWith('x')).toBe(true)
  })

  it('sanitizes conversation messages safely', () => {
    const messages = __test__.sanitizeConversationMessages([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: ' '.repeat(10) },
      { role: 'assistant', content: 'x'.repeat(2500) },
    ])
    expect(messages.length).toBe(2)
    expect(messages[0]?.content).toBe('hello')
    expect(messages[1]?.content.length).toBeLessThanOrEqual(2003)
  })
})
