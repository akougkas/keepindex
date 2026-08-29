import { describe, expect, it } from 'bun:test'
import {
  classifyIntent,
  parseSlashCommand,
  tryEvaluateMathExpression,
} from './classify-intent'

describe('classify-intent enhancements', () => {
  describe('tryEvaluateMathExpression', () => {
    it('evaluates basic arithmetic expressions', () => {
      const res = tryEvaluateMathExpression('24 * 1024')
      expect(res).not.toBeNull()
      expect(res?.result).toBe('24,576')
    })

    it('evaluates exponentiation and parentheses', () => {
      const res = tryEvaluateMathExpression('(100 - 25) / 5')
      expect(res).not.toBeNull()
      expect(res?.result).toBe('15')
    })

    it('evaluates percentage expressions', () => {
      const res = tryEvaluateMathExpression('15% of 80')
      expect(res).not.toBeNull()
      expect(res?.result).toBe('12')
    })

    it('evaluates math functions like sqrt', () => {
      const res = tryEvaluateMathExpression('sqrt(144)')
      expect(res).not.toBeNull()
      expect(res?.result).toBe('12')
    })

    it('returns null for non-math queries', () => {
      expect(tryEvaluateMathExpression('who was the 16th president')).toBeNull()
      expect(tryEvaluateMathExpression('bun vs nodejs')).toBeNull()
    })
  })

  describe('parseSlashCommand', () => {
    it('extracts /ai command and clean query', () => {
      const { mode, cleanQuery } = parseSlashCommand('/ai what is WebAssembly?')
      expect(mode).toBe('ai')
      expect(cleanQuery).toBe('what is WebAssembly?')
    })

    it('extracts /s and /search command', () => {
      const s1 = parseSlashCommand('/s rust compiler')
      expect(s1.mode).toBe('search')
      expect(s1.cleanQuery).toBe('rust compiler')

      const s2 = parseSlashCommand('/search linux kernel')
      expect(s2.mode).toBe('search')
      expect(s2.cleanQuery).toBe('linux kernel')
    })

    it('extracts /chat and /c command', () => {
      const c = parseSlashCommand('/c can you help me write a bash script?')
      expect(c.mode).toBe('chat')
      expect(c.cleanQuery).toBe('can you help me write a bash script?')
    })

    it('extracts /research and /r command', () => {
      const r = parseSlashCommand('/research quantum key distribution')
      expect(r.mode).toBe('research')
      expect(r.cleanQuery).toBe('quantum key distribution')
    })

    it('returns null mode for non-slash queries', () => {
      const res = parseSlashCommand('regular search query')
      expect(res.mode).toBeNull()
      expect(res.cleanQuery).toBe('regular search query')
    })
  })

  describe('classifyIntent', () => {
    it('routes math expressions to AI mode for breakdown', () => {
      expect(classifyIntent('24 * 1024')).toBe('ai')
      expect(classifyIntent('sqrt(256) + 40')).toBe('ai')
    })

    it('respects slash command overrides', () => {
      expect(classifyIntent('/s why is the sky blue')).toBe('search')
      expect(classifyIntent('/c hello there')).toBe('chat')
      expect(classifyIntent('/r comprehensive analysis of sqlite')).toBe('research')
    })
  })
})
