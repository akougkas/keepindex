import { describe, expect, it } from 'bun:test'
import { __test__ } from './index'

const { SENSITIVE_FILE_PATTERN } = __test__

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
