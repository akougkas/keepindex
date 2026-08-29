const MAX_RETRIEVAL_QUERY_CHARS = 1000

function normalizePart(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Extends a standalone retrieval signal across follow-up turns while keeping
 * both the original subject (the head) and the newest question (the tail).
 */
export function extendRetrievalContext(current: string, followUp: string): string {
  const base = normalizePart(current)
  const next = normalizePart(followUp)
  if (!base) return next.slice(0, MAX_RETRIEVAL_QUERY_CHARS)
  if (!next) return base.slice(0, MAX_RETRIEVAL_QUERY_CHARS)
  if (base.toLocaleLowerCase().includes(next.toLocaleLowerCase())) {
    return base.slice(0, MAX_RETRIEVAL_QUERY_CHARS)
  }

  const tail = next.slice(0, MAX_RETRIEVAL_QUERY_CHARS)
  const headBudget = Math.max(0, MAX_RETRIEVAL_QUERY_CHARS - tail.length - 1)
  return `${base.slice(0, headBudget).trimEnd()} ${tail}`.trim()
}
