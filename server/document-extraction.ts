import { execFile } from 'node:child_process'
import { extname } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type IndexedSourceKind = 'note' | 'document' | 'code' | 'file'

export type ExtractedFileMetadata = {
  extension: string
  sourceKind: IndexedSourceKind
  mimeType: string
  extractor: 'text' | 'pdftotext' | 'pandoc' | 'metadata'
  metadataOnly: boolean
  aliases: string[]
  tags: string[]
  outgoingLinks: string[]
}

export type ExtractedFile = {
  text: string
  metadata: ExtractedFileMetadata
}

export const DOCUMENT_EXTENSIONS = new Set([
  '.pdf', '.docx', '.odt', '.rtf', '.epub',
])

export const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java',
  '.c', '.cc', '.cpp', '.h', '.hpp', '.cs', '.php', '.rb', '.swift', '.kt',
  '.sql', '.prisma', '.graphql', '.sh', '.bash', '.zsh', '.fish', '.ps1',
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.vue', '.svelte',
])

export const TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.org', '.rst', '.adoc', '.tex',
  '.json', '.jsonl', '.yaml', '.yml', '.toml', '.csv', '.tsv', '.log',
  '.ini', '.conf', '.cfg', '.xml', '.properties', '.env.example',
  ...CODE_EXTENSIONS,
])

const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.rtf': 'application/rtf',
  '.epub': 'application/epub+zip',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
}

function unique(values: string[], limit = 80): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of values) {
    const normalized = value.replace(/^['"]|['"]$/g, '').replace(/^#/, '').trim()
    const key = normalized.toLocaleLowerCase()
    if (!normalized || seen.has(key)) continue
    seen.add(key)
    output.push(normalized.slice(0, 160))
    if (output.length >= limit) break
  }
  return output
}

function parseFrontmatterList(frontmatter: string, key: string): string[] {
  const block = new RegExp(`^${key}:\\s*(.*(?:\\n(?:[ \\t]+|-[ \\t]+).*)*)`, 'im').exec(frontmatter)?.[1]
  if (!block) return []
  const inline = block.trim()
  if (inline.startsWith('[') && inline.endsWith(']')) {
    return unique(inline.slice(1, -1).split(',').map((value) => value.trim()))
  }
  const rows = inline.split('\n')
    .map((value) => value.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean)
  return unique(rows.flatMap((value) => value.includes(',') ? value.split(',') : [value]))
}

export function extractObsidianMetadata(text: string): Pick<ExtractedFileMetadata, 'aliases' | 'tags' | 'outgoingLinks'> {
  const frontmatter = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(text)?.[1] ?? ''
  const inlineTags = Array.from(text.matchAll(/(?:^|\s)#([\p{L}\d][\p{L}\d_/-]*)/gu), (match) => match[1] ?? '')
  const links = Array.from(text.matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g), (match) => match[1] ?? '')
  return {
    aliases: parseFrontmatterList(frontmatter, 'aliases?'),
    tags: unique([...parseFrontmatterList(frontmatter, 'tags?'), ...inlineTags]),
    outgoingLinks: unique(links),
  }
}

export function classifySourceKind(fileName: string, obsidianRoot: boolean): IndexedSourceKind {
  const extension = extname(fileName).toLowerCase()
  if (obsidianRoot && (extension === '.md' || extension === '.markdown' || extension === '.canvas')) return 'note'
  if (DOCUMENT_EXTENSIONS.has(extension)) return 'document'
  if (CODE_EXTENSIONS.has(extension)) return 'code'
  return 'file'
}

function pdfWithPageMarkers(value: string): string {
  return value
    .split('\f')
    .map((page, index) => page.trim() ? `[Page ${index + 1}]\n${page.trim()}` : '')
    .filter(Boolean)
    .join('\n\n')
}

async function extractWithCommand(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 40 * 1024 * 1024,
    windowsHide: true,
  })
  return stdout.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim()
}

export async function extractIndexableFile(input: {
  path: string
  fileName: string
  size: number
  modifiedAt: number
  obsidianRoot: boolean
  readText: () => Promise<string>
}): Promise<ExtractedFile> {
  const extension = extname(input.fileName).toLowerCase()
  const sourceKind = classifySourceKind(input.fileName, input.obsidianRoot)
  const baseMetadata: ExtractedFileMetadata = {
    extension,
    sourceKind,
    mimeType: MIME_TYPES[extension] ?? (TEXT_EXTENSIONS.has(extension) ? 'text/plain' : 'application/octet-stream'),
    extractor: 'metadata',
    metadataOnly: false,
    aliases: [],
    tags: [],
    outgoingLinks: [],
  }

  if (TEXT_EXTENSIONS.has(extension) || (input.obsidianRoot && extension === '.canvas')) {
    let text = await input.readText()
    if (extension === '.json' || extension === '.canvas') {
      try {
        text = JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        // Keep malformed or JSONL content searchable as plain text.
      }
    }
    const obsidian = input.obsidianRoot && (extension === '.md' || extension === '.markdown')
      ? extractObsidianMetadata(text)
      : { aliases: [], tags: [], outgoingLinks: [] }
    return {
      text,
      metadata: { ...baseMetadata, extractor: 'text', ...obsidian },
    }
  }

  if (extension === '.pdf') {
    try {
      const text = pdfWithPageMarkers(await extractWithCommand('pdftotext', ['-layout', '-enc', 'UTF-8', input.path, '-']))
      if (text) return { text, metadata: { ...baseMetadata, extractor: 'pdftotext' } }
    } catch {
      // A malformed/encrypted PDF or missing helper still remains discoverable
      // by safe filesystem metadata below.
    }
  }

  if (DOCUMENT_EXTENSIONS.has(extension)) {
    try {
      const text = await extractWithCommand('pandoc', [input.path, '--to=plain', '--wrap=none'])
      if (text) return { text, metadata: { ...baseMetadata, extractor: 'pandoc' } }
    } catch {
      // Preserve document discovery even when conversion is unsupported.
    }
  }

  const modified = Number.isFinite(input.modifiedAt) ? new Date(input.modifiedAt).toISOString() : 'unknown'
  return {
    text: [
      '[File metadata]',
      `Name: ${input.fileName}`,
      `Extension: ${extension || '(none)'}`,
      `Path: ${input.path}`,
      `Size: ${input.size} bytes`,
      `Modified: ${modified}`,
    ].join('\n'),
    metadata: { ...baseMetadata, metadataOnly: true },
  }
}
