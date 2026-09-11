import { constants } from 'node:fs'
import { open, readdir, realpath } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { projectReleaseSubject, tokenizeQuery } from './retrieval'

export type ProjectRoot = { id: string; path: string; label: string }
export type ProjectPassage = {
  filePath: string; fileName: string; content: string; startLine: number; endLine: number
  resourceId: string; resourceLabel: string; indexedAt: number; modifiedAt: number
  sourceKind: 'file'; extension: string; mimeType: string; extractor: 'text'
  score: number; normalizedScore: number; queryCoverage: number; queryTermCount: number
}

const inside = (root: string, path: string) => {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))
}
const identity = (value: string) => tokenizeQuery(value).join(' ')

/** Read only project documentation inside explicitly registered roots. No crawl,
 * external requests, command execution, or reads through directory symlinks.
 * Complements a capped/stale index with current, line-addressable evidence.
 */
export async function readCurrentProjectEvidence(query: string, roots: readonly ProjectRoot[], excludedDirectories: ReadonlySet<string> = new Set()): Promise<ProjectPassage[]> {
  const subject = projectReleaseSubject(query)
  if (!subject) return []
  const output: ProjectPassage[] = []
  let visited = 0
  const deadline = Date.now() + 1500
  for (const root of roots.slice(0, 24)) {
    let canonicalRoot: string
    try { canonicalRoot = await realpath(root.path) } catch { continue }
    const directories: string[] = []
    const visit = async (directory: string, depth: number): Promise<void> => {
      if (identity(basename(directory)) === identity(subject)) { directories.push(directory); return }
      if (depth === 0 || ++visited > 128 || Date.now() > deadline) return
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
      const bounded = entries.slice(0, 1000)
      for (const entry of bounded) {
        if (entry.isDirectory() && !excludedDirectories.has(entry.name) && !entry.name.startsWith('.') && identity(entry.name) === identity(subject)) directories.push(join(directory, entry.name))
      }
      if (directories.length > 0) return
      for (const entry of bounded) {
        if (!entry.isDirectory() || excludedDirectories.has(entry.name) || entry.name.startsWith('.') || /^(?:node_modules|vendor|dist|build|target|archive|archives)$/i.test(entry.name)) continue
        const child = join(directory, entry.name)
        // Search root children, and one grouping level (e.g. root/github/repo).
        if (identity(entry.name) === identity(subject)) directories.push(child)
        else if (depth > 1) await visit(child, depth - 1)
        if (directories.length >= 2) return
      }
    }
    await visit(canonicalRoot, 2)
    for (const directory of directories.slice(0, 2)) {
      for (const fileName of ['CHANGELOG.md', 'README.md']) {
        const filePath = join(directory, fileName)
        try {
          if (!inside(canonicalRoot, await realpath(filePath))) continue
          const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
          try {
            const metadata = await file.stat()
            if (!metadata.isFile() || metadata.size > 4 * 1024 * 1024) continue
            const buffer = Buffer.alloc(32 * 1024)
            const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
            const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n')
            // Preserve the document's lead and current release section in order.
            // Never score random installer/code fragments as release notes.
            const lead = fileName === 'README.md' ? Math.max(0, lines.findIndex((line) => /^#{1,2}\s|^[A-Z][a-z]+.*\bis\b/.test(line))) : 0
            const starts = [lead]
            const heading = lines.findIndex((line, index) => index > 5 && /^(?:#{1,3}\s+|\*\*)?(?:what.?s new|new in|latest|current)/i.test(line))
            if (heading > 0 && fileName === 'README.md') starts.splice(0, starts.length, heading)
            for (const start of starts) {
              let content = '', end = start
              while (end < lines.length && content.length + lines[end].length < 1700) {
                if (fileName === 'README.md' && end > start && /^#{1,3}\s/.test(lines[end])) break
                content += `${lines[end++]}\n`
              }
              if (!content.trim()) continue
              output.push({ filePath, fileName, content: content.trim(), startLine: start + 1, endLine: end,
                resourceId: root.id, resourceLabel: root.label, indexedAt: Date.now(), modifiedAt: metadata.mtimeMs,
                sourceKind: 'file', extension: '.md', mimeType: 'text/markdown', extractor: 'text',
                score: 100, normalizedScore: 1, queryCoverage: 1, queryTermCount: tokenizeQuery(subject).length,
              })
            }
          } finally { await file.close() }
        } catch { /* missing, unreadable, or unsafe document: keep existing evidence */ }
      }
    }
    if (output.length >= 6) break
  }
  return output.slice(0, 6)
}
