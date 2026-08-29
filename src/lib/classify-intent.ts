export type Intent = 'search' | 'ai' | 'chat' | 'research'

const RESEARCH_PHRASES = [
  'research',
  'deep dive',
  'investigate',
  'comprehensive',
  'analyze in depth',
  'tell me everything about',
  'comparative study',
  'systematic review',
]

const CHAT_OPENERS = [
  'hi',
  'hello',
  'hey',
  'thanks',
  'thank you',
  'ok',
  'okay',
  'sure',
  'yes',
  'no',
  'bye',
  'cool',
  'nice',
  'lol',
  'haha',
  'good morning',
  'good evening',
]

const CHAT_CONTEXT_PHRASES = [
  'you said',
  'you mentioned',
  'earlier',
  'what about',
  'and also',
  'follow up',
  'can you also',
  'explain further',
]

const AI_QUESTION_WORDS = [
  'what',
  'why',
  'how',
  'explain',
  'describe',
  'summarize',
  'compare',
  'analyze',
  'tell me about',
  'what is',
  'who is',
  'when did',
  'how to',
]

const AI_REQUEST_STARTERS = [
  'write',
  'create',
  'generate',
  'make',
  'help me',
  'give me',
  'list',
  'suggest',
  'build',
  'implement',
  'code',
]

const SEARCH_OPERATORS = ['site:', 'filetype:', 'inurl:', 'intitle:', 'author:']

function looksLikeUrlOrDomain(q: string): boolean {
  if (/^https?:\/\//i.test(q)) return true
  if (/^[a-z0-9][a-z0-9-]*\.[a-z]{2,}(\/.*)?$/i.test(q)) return true
  if (/^[a-z0-9-]+\.[a-z0-9-]+(\.[a-z]{2,})?$/i.test(q)) return true
  return false
}

function hasSearchOperator(q: string): boolean {
  const lower = q.toLowerCase()
  return SEARCH_OPERATORS.some((op) => lower.includes(op))
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

function looksLikeSearchTerm(q: string): boolean {
  const words = wordCount(q)
  return words >= 1 && words <= 4 && !q.includes('?')
}

export function tryEvaluateMathExpression(query: string): { expr: string; result: string } | null {
  const trimmed = query.trim()
  if (!trimmed || trimmed.length < 2) return null

  // Percentage pattern: "15% of 80"
  const percentMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)$/i)
  if (percentMatch) {
    const p = parseFloat(percentMatch[1])
    const total = parseFloat(percentMatch[2])
    const res = (p / 100) * total
    return { expr: `${p}% of ${total}`, result: Number.isInteger(res) ? res.toString() : res.toFixed(4).replace(/\.?0+$/, '') }
  }

  // Math expression: numbers, +, -, *, /, ^, %, (, ), sqrt, sin, cos, tan, pi, e
  const sanitized = trimmed
    .toLowerCase()
    .replace(/\bsqrt\b/g, 'Math.sqrt')
    .replace(/\babs\b/g, 'Math.abs')
    .replace(/\bround\b/g, 'Math.round')
    .replace(/\bfloor\b/g, 'Math.floor')
    .replace(/\bceil\b/g, 'Math.ceil')
    .replace(/\bpi\b/g, `${Math.PI}`)
    .replace(/\be\b/g, `${Math.E}`)
    .replace(/\^/g, '**')

  // Check if string contains only safe mathematical characters and functions
  if (!/^[0-9+\-*/().,% Math.sqrt|Math.abs|Math.round|Math.floor|Math.ceil]+$/.test(sanitized)) {
    return null
  }

  // Must contain at least one math operator or function
  if (!/[+\-*/^%]|Math\./.test(sanitized)) {
    return null
  }

  try {
    // Safe evaluation using Function with no globals
    const fn = new Function(`"use strict"; return (${sanitized})`)
    const val = fn()
    if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
      const formatted = Number.isInteger(val)
        ? val.toLocaleString()
        : Math.abs(val) < 0.0001
          ? val.toExponential(4)
          : parseFloat(val.toFixed(6)).toString()
      return { expr: trimmed, result: formatted }
    }
  } catch {
    return null
  }

  return null
}

export function parseSlashCommand(query: string): { mode: Intent | null; cleanQuery: string } {
  const trimmed = query.trim()
  if (trimmed.startsWith('/ai ') || trimmed === '/ai') {
    return { mode: 'ai', cleanQuery: trimmed.slice(4).trim() }
  }
  if (trimmed.startsWith('/s ') || trimmed.startsWith('/search ') || trimmed === '/s' || trimmed === '/search') {
    const offset = trimmed.startsWith('/search') ? 8 : 3
    return { mode: 'search', cleanQuery: trimmed.slice(offset).trim() }
  }
  if (trimmed.startsWith('/chat ') || trimmed.startsWith('/c ') || trimmed === '/chat' || trimmed === '/c') {
    const offset = trimmed.startsWith('/chat') ? 6 : 3
    return { mode: 'chat', cleanQuery: trimmed.slice(offset).trim() }
  }
  if (trimmed.startsWith('/research ') || trimmed.startsWith('/r ') || trimmed === '/research' || trimmed === '/r') {
    const offset = trimmed.startsWith('/research') ? 10 : 3
    return { mode: 'research', cleanQuery: trimmed.slice(offset).trim() }
  }
  return { mode: null, cleanQuery: trimmed }
}

export function classifyIntent(query: string): Intent {
  const { mode: slashMode } = parseSlashCommand(query)
  if (slashMode) return slashMode

  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return 'search'

  // If pure math expression, default to AI mode for instant calculation / math breakdown
  if (tryEvaluateMathExpression(trimmed)) {
    return 'ai'
  }

  const words = wordCount(trimmed)

  // Research: explicit research phrases
  if (RESEARCH_PHRASES.some((p) => trimmed.startsWith(p) || trimmed.includes(p))) {
    return 'research'
  }

  // Chat: conversational openers
  if (CHAT_OPENERS.some((op) => trimmed === op || trimmed.startsWith(op + ' '))) {
    return 'chat'
  }

  // Chat: references prior context
  if (CHAT_CONTEXT_PHRASES.some((p) => trimmed.includes(p))) {
    return 'chat'
  }

  // Chat: very short, no question mark, doesn't look like search
  if (words <= 3 && !trimmed.includes('?') && !looksLikeSearchTerm(trimmed)) {
    return 'chat'
  }

  // Search: URL or domain
  if (looksLikeUrlOrDomain(trimmed)) return 'search'

  // Search: operators
  if (hasSearchOperator(trimmed)) return 'search'

  // AI: question words
  if (AI_QUESTION_WORDS.some((w) => trimmed.includes(w))) {
    return 'ai'
  }

  // AI: request starters
  if (AI_REQUEST_STARTERS.some((s) => trimmed.startsWith(s))) {
    return 'ai'
  }

  // AI: long query (likely needs synthesis)
  if (words > 8) return 'ai'

  // Search: short noun phrase
  if (looksLikeSearchTerm(trimmed)) return 'search'

  // Default
  return 'search'
}
