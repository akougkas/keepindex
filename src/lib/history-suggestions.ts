/**
 * Keeps the server's frequency/recency ordering inside each relevance tier.
 * Prefix matches are more useful while typing than arbitrary substring hits,
 * but both are preferable to hiding history until the input is empty.
 */
export function rankHistorySuggestions(
  history: string[],
  input: string,
  limit = 8
): string[] {
  const needle = input.trim().toLocaleLowerCase()
  if (!needle) return history.slice(0, limit)

  const prefixes: string[] = []
  const substrings: string[] = []
  for (const query of history) {
    const normalized = query.toLocaleLowerCase()
    if (normalized.startsWith(needle)) prefixes.push(query)
    else if (normalized.includes(needle)) substrings.push(query)
  }
  return [...prefixes, ...substrings].slice(0, limit)
}
