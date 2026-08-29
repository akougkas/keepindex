import { describe, expect, it } from 'bun:test'
import { CLIENT_STORAGE_KEYS, KEEPINDEX_STORAGE_KEYS } from './storage-contract'
import { parseStateBackup, stateBackupFileName } from './state-backup'

const SERVER_STATE = {
  collections: [],
  history: [],
  session: null,
  knowledgeResources: [],
}

function backupText(
  schema = 'keepindex-state-backup',
  clientStorage: Record<string, unknown> = Object.fromEntries(
    CLIENT_STORAGE_KEYS.map((key, index) => [
      key,
      key === KEEPINDEX_STORAGE_KEYS.theme ? 'dark' : JSON.stringify({ index }),
    ])
  )
): string {
  return JSON.stringify({
    schema,
    version: 1,
    exportedAt: '2026-08-29T12:34:56.000Z',
    clientStorage,
    server: SERVER_STATE,
  })
}

describe('KeepIndex state backups', () => {
  it('accepts the canonical schema and preserves canonical storage values', () => {
    const backup = parseStateBackup(backupText())

    expect(backup.schema).toBe('keepindex-state-backup')
    CLIENT_STORAGE_KEYS.forEach((key, index) => {
      const expected = key === KEEPINDEX_STORAGE_KEYS.theme ? 'dark' : JSON.stringify({ index })
      expect(backup.clientStorage[key]).toBe(expected)
    })
  })

  it('ignores storage fields outside the KeepIndex contract', () => {
    const backup = parseStateBackup(backupText('keepindex-state-backup', {
      [KEEPINDEX_STORAGE_KEYS.settings]: JSON.stringify({ state: { showThinking: true } }),
      'another-app': JSON.stringify({ private: true }),
    }))

    expect(backup.clientStorage).toEqual({
      [KEEPINDEX_STORAGE_KEYS.settings]: JSON.stringify({ state: { showThinking: true } }),
    })
  })

  it('rejects noncanonical schemas and oversized imports', () => {
    expect(() => parseStateBackup(backupText('other-state-backup'))).toThrow(
      'not a supported KeepIndex backup'
    )
    expect(() => parseStateBackup(' '.repeat(10_000_001))).toThrow('10 MB import limit')
  })

  it('rejects malformed server payloads and timestamps before restore', () => {
    const invalidCases = [
      { ...SERVER_STATE, collections: 'not-an-array' },
      { ...SERVER_STATE, history: [null] },
      { ...SERVER_STATE, session: 'not-an-object' },
      { ...SERVER_STATE, knowledgeResources: [{ path: '' }] },
      { ...SERVER_STATE, knowledgeResources: [{ path: '/mnt/notes', label: 42 }] },
    ]

    for (const server of invalidCases) {
      expect(() => parseStateBackup(JSON.stringify({
        schema: 'keepindex-state-backup',
        version: 1,
        exportedAt: '2026-08-29T12:34:56.000Z',
        clientStorage: {},
        server,
      }))).toThrow('not a supported KeepIndex backup')
    }

    expect(() => parseStateBackup(JSON.stringify({
      schema: 'keepindex-state-backup',
      version: 1,
      exportedAt: 'not-a-date',
      clientStorage: {},
      server: SERVER_STATE,
    }))).toThrow('not a supported KeepIndex backup')
  })

  it('rejects malformed JSON browser state', () => {
    expect(() => parseStateBackup(backupText('keepindex-state-backup', {
      [KEEPINDEX_STORAGE_KEYS.settings]: '{broken',
    }))).toThrow(`invalid browser state for ${KEEPINDEX_STORAGE_KEYS.settings}`)
  })

  it('drops invalid theme values', () => {
    const backup = parseStateBackup(backupText('keepindex-state-backup', {
      [KEEPINDEX_STORAGE_KEYS.theme]: 'sepia',
    }))

    expect(backup.clientStorage[KEEPINDEX_STORAGE_KEYS.theme]).toBeUndefined()
  })

  it('drops individual browser values above the 5 MB limit', () => {
    const backup = parseStateBackup(backupText('keepindex-state-backup', {
      [KEEPINDEX_STORAGE_KEYS.settings]: JSON.stringify('x'.repeat(5_000_000)),
    }))

    expect(backup.clientStorage[KEEPINDEX_STORAGE_KEYS.settings]).toBeUndefined()
  })

  it('uses the canonical deterministic download name', () => {
    expect(stateBackupFileName('2026-08-29T12:34:56.000Z')).toBe(
      'keepindex-backup-2026-08-29-12-34-56.json'
    )
  })
})
