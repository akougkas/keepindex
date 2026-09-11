import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { __test__ } from './index'

const { SENSITIVE_FILE_PATTERN, DEFAULT_EXCLUDED_DIRECTORIES, indexDirectory } = __test__

const MUST_SKIP = [
  'pypi token zulipchat-mcp.md',
  'test token zulipchat-mcp-test.md',
  'PyPI-Recovery-Codes-user-2025-09-14.txt',
  'fredaccount.stlouisfed apikey.md',
  'api-key.txt',
  'openai_api_key.md',
  'backup codes.md',
  'recovery codes.md',
  'API KEY anthropic.md',
  'OPENAI_API_KEY.txt',
  'huggingface access token.md',
  'github personal access token.md',
  'stripe secret key.md',
  'ssh passphrase.md',
  'my-token.md',
  '.env',
  '.env.local',
  'aws_credentials.json',
  'server.pem',
  'id_rsa',
  'id_ed25519',
  'passwd',
  'deploy.key',
  'bundle.p12',
  'client.pfx',
  'secrets.yaml',
  'private_key.txt',
]

const MUST_INDEX = [
  'tokenizer.md',
  'tokenization-benchmarks.md',
  'keyboard-shortcuts.md',
  'keynote-2025-outline.md',
  'secretary-notes.md',
  'credentialing-policy.md',
  'passwordless-ssh-guide.md',
  'api-design-notes.md',
  'apiary-blueprint.md',
  'recovery-plan.md',
  'postal-codes-lookup.md',
  'codebase-tour.md',
  'private-equity-notes.md',
  'monkey-patch-notes.md',
]

describe('SENSITIVE_FILE_PATTERN credential shapes', () => {
  for (const fileName of MUST_SKIP) {
    it(`skips ${fileName}`, () => {
      expect(SENSITIVE_FILE_PATTERN.test(fileName)).toBe(true)
    })
  }

  it('skips every credential shape when evaluated as a table', () => {
    const indexed = MUST_SKIP.filter((fileName) => !SENSITIVE_FILE_PATTERN.test(fileName))
    expect(indexed).toEqual([])
  })
})

describe('SENSITIVE_FILE_PATTERN ordinary notes', () => {
  for (const fileName of MUST_INDEX) {
    it(`indexes ${fileName}`, () => {
      expect(SENSITIVE_FILE_PATTERN.test(fileName)).toBe(false)
    })
  }

  it('indexes every ordinary note when evaluated as a table', () => {
    const skipped = MUST_INDEX.filter((fileName) => SENSITIVE_FILE_PATTERN.test(fileName))
    expect(skipped).toEqual([])
  })
})

describe('SENSITIVE_FILE_PATTERN evaluation is stateless', () => {
  it('is not a global regex, so repeated tests on one name are stable', () => {
    expect(SENSITIVE_FILE_PATTERN.global).toBe(false)
    expect(SENSITIVE_FILE_PATTERN.sticky).toBe(false)
    expect(SENSITIVE_FILE_PATTERN.flags).toContain('i')
  })

  it('returns the same verdict across a directory-sized sweep', () => {
    const sweep = [...MUST_SKIP, ...MUST_INDEX, ...MUST_SKIP, ...MUST_INDEX]
    const verdicts = new Map<string, boolean>()
    for (const fileName of sweep) {
      const verdict = SENSITIVE_FILE_PATTERN.test(fileName)
      const seen = verdicts.get(fileName)
      if (seen === undefined) verdicts.set(fileName, verdict)
      else expect(verdict).toBe(seen)
    }
    expect(SENSITIVE_FILE_PATTERN.lastIndex).toBe(0)
  })
})

describe('DEFAULT_EXCLUDED_DIRECTORIES and custom exclude patterns (KIX-23)', () => {
  it('includes common build, bundle, and experiment directories by default', () => {
    const requiredExclusions = [
      '.git',
      'node_modules',
      'repomix-output',
      '__NUKED',
      'experiment-results',
      '.turbo',
      'turbo',
      '.next',
      'next',
      '.nuxt',
      'nuxt',
      '.output',
      'output',
      'target',
      'bin',
      'obj',
      '.pytest_cache',
      '.mypy_cache',
      '.ruff_cache',
      'tmp',
      'temp',
    ]
    for (const dirName of requiredExclusions) {
      expect(DEFAULT_EXCLUDED_DIRECTORIES.has(dirName)).toBe(true)
    }
  })

  it('indexDirectory skips default excluded folders and custom exclude patterns', async () => {
    const root = await mkdtemp(join(tmpdir(), 'keepindex-exclude-test-'))
    try {
      await mkdir(join(root, 'notes'), { recursive: true })
      await mkdir(join(root, 'repomix-output'), { recursive: true })
      await mkdir(join(root, '__NUKED'), { recursive: true })
      await mkdir(join(root, 'custom-archive'), { recursive: true })

      await writeFile(join(root, 'notes', 'valid-note.md'), '# Valid Note\nContent here.', 'utf-8')
      await writeFile(join(root, 'repomix-output', 'dump.md'), '# Dump\nShould be skipped.', 'utf-8')
      await writeFile(join(root, '__NUKED', 'old.md'), '# Old\nShould be skipped.', 'utf-8')
      await writeFile(join(root, 'custom-archive', 'ignored.md'), '# Archive\nCustom ignored.', 'utf-8')
      await writeFile(join(root, 'notes', 'draft-secret.md'), '# Draft\nCustom ignored by file pattern.', 'utf-8')

      const result = await indexDirectory(root, undefined, undefined, ['custom-archive', 'draft-secret.md'])
      const indexedFileNames = result.chunks.map((c) => c.fileName)

      expect(indexedFileNames).toContain('valid-note.md')
      expect(indexedFileNames).not.toContain('dump.md')
      expect(indexedFileNames).not.toContain('old.md')
      expect(indexedFileNames).not.toContain('ignored.md')
      expect(indexedFileNames).not.toContain('draft-secret.md')
      expect(result.fileCount).toBe(1)
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => {})
    }
  })
})
