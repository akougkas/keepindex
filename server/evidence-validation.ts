/** Deterministic checks complement citation coverage. They catch invented
 * versions, dates and code identifiers; they do not claim semantic entailment.
 */
export function unsupportedEvidenceLiterals(
  claims: readonly string[], web: readonly string[], local: readonly string[]
): string[] {
  const unsupported: string[] = []
  const normalize = (text: string) => text.toLowerCase().replace(/["'`]/g, '').replace(/\s+/g, ' ').trim()
  for (const claim of claims) {
    const ids = Array.from(claim.matchAll(/\[(L?\d+(?:\s*,\s*L?\d+)*)\]/g)).flatMap((match) => match[1].split(/\s*,\s*/))
    if (ids.length === 0) continue
    const cited = normalize(ids.map((id) => id.startsWith('L') ? local[Number(id.slice(1)) - 1] : web[Number(id) - 1]).filter(Boolean).join('\n'))
    const literals = [
      ...Array.from(claim.matchAll(/`([^`\n]{2,140})`/g), (match) => match[1]),
      ...Array.from(claim.matchAll(/\bv?(\d+\.\d+(?:\.\d+)+(?:-[a-z0-9.]+)?)\b/gi), (match) => match[1]),
      ...Array.from(claim.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g), (match) => match[0]),
    ]
    for (const literal of literals) {
      if (!cited.includes(normalize(literal))) unsupported.push(literal)
    }
  }
  return [...new Set(unsupported)]
}

export function liveReleaseMismatch(query: string, answer: string, sources: readonly { snippet: string }[]): string | null {
  if (!/\b(?:latest|current|newest)\b/i.test(query)) return null
  const records = sources.filter((source) => source.snippet.startsWith('Live GitHub release record'))
  if (records.length !== 1) return null
  const version = /tag_name: ([^;\n]+)/.exec(records[0].snippet)?.[1].replace(/^v/, '')
  if (version && !answer.includes(version)) return `The answer did not report the version in the current release record (${version}).`
  return null
}

/** A failed model must not hide useful current evidence. This fallback copies
 * source passages verbatim; the UI labels it as excerpts, not AI synthesis.
 */
export function releaseSourceExcerpts(
  web: readonly { snippet: string; hydration?: { status: string } }[],
  local: readonly { fileName: string; content: string }[]
): string | null {
  const parts: string[] = []
  const releaseIndex = web.findIndex((source) => source.hydration?.status === 'hydrated' && source.snippet.startsWith('Live GitHub release record'))
  if (releaseIndex >= 0) {
    const snippet = web[releaseIndex].snippet
    const name = /\nname: ([^;\n]+)/.exec(snippet)?.[1]
    const tag = /tag_name: ([^;\n]+)/.exec(snippet)?.[1]
    const date = /published_at: (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/.exec(snippet)?.[1]
    if (tag && date) parts.push(`The latest published release is **${(name ?? tag).replace(/[\[\]*<>]/g, '')}**, published **${date.slice(0, 10)} (UTC)**. [${releaseIndex + 1}]`)
  }
  const localIndex = local.findIndex((source) => /^changelog\.md$/i.test(source.fileName) && /^##\s+\[?v?\d+\.\d+/m.test(source.content))
  if (localIndex >= 0) {
    const content = local[localIndex].content
    const heading = /^##\s+(.+)$/m.exec(content)
    if (heading) {
      if (parts.length === 0) parts.push(`The local changelog lists **${heading[1].replace(/[\[\]*<>]/g, '')}**. [L${localIndex + 1}]\n\nUnknown: the latest published release has not been verified from these local files.`)
      const after = content.slice((heading.index ?? 0) + heading[0].length).trim()
      const paragraph = after.split(/\n\s*\n|\n#{1,6}\s/, 1)[0]?.trim()
      if (paragraph && paragraph.length > 40 && paragraph.length <= 900 && !paragraph.startsWith('#')) parts.push(`From the local changelog:\n\n> ${paragraph.replace(/\n/g, '\n> ')} [L${localIndex + 1}]`)
    }
  }
  if (parts.length > 0 && releaseIndex >= 0 && localIndex < 0) {
    const paragraph = web[releaseIndex].snippet.split('\n').slice(2).join('\n').trim().split(/\n\s*\n|\n#{1,6}\s/, 1)[0]
    if (paragraph && paragraph.length > 40 && paragraph.length <= 900) parts.push(`From the release notes:\n\n> ${paragraph.replace(/\n/g, '\n> ')} [${releaseIndex + 1}]`)
  }
  return parts.length ? parts.join('\n\n') : null
}
