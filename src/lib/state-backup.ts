import {
  CLIENT_STORAGE_KEYS,
  KEEPINDEX_STORAGE_KEYS,
  type ClientStorageKey,
} from './storage-contract'

export { CLIENT_STORAGE_KEYS } from './storage-contract'

const KEEPINDEX_BACKUP_SCHEMA = 'keepindex-state-backup' as const
const MAX_BACKUP_IMPORT_BYTES = 10_000_000
const MAX_CLIENT_STORAGE_VALUE_BYTES = 5_000_000

type BackupServerState = {
  collections: unknown[]
  history: unknown[]
  session: unknown | null
  knowledgeResources: Array<{ path: string; label?: string }>
}

export type KeepIndexBackup = {
  schema: typeof KEEPINDEX_BACKUP_SCHEMA
  version: 1
  exportedAt: string
  clientStorage: Partial<Record<ClientStorageKey, string>>
  server: BackupServerState
}

type BackupCandidate = Partial<KeepIndexBackup>

async function readJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Backup read failed for ${url}`)
  return response.json() as Promise<Record<string, unknown>>
}

export async function createStateBackup(): Promise<KeepIndexBackup> {
  const [collections, history, session, knowledge] = await Promise.all([
    readJson('/api/collections'),
    readJson('/api/history?limit=200'),
    readJson('/api/session'),
    readJson('/api/knowledge/status'),
  ])
  const clientStorage: KeepIndexBackup['clientStorage'] = {}
  for (const key of CLIENT_STORAGE_KEYS) {
    try {
      const value = localStorage.getItem(key)
      if (value != null) clientStorage[key] = value
    } catch {
      // A server-side backup remains useful if browser storage is unavailable.
    }
  }
  const resources = Array.isArray(knowledge.resources) ? knowledge.resources : []
  return {
    schema: KEEPINDEX_BACKUP_SCHEMA,
    version: 1,
    exportedAt: new Date().toISOString(),
    clientStorage,
    server: {
      collections: Array.isArray(collections.items) ? collections.items : [],
      history: Array.isArray(history.history) ? history.history : [],
      session: session.session ?? null,
      knowledgeResources: resources.flatMap((resource) => {
        if (!resource || typeof resource !== 'object') return []
        const record = resource as Record<string, unknown>
        return typeof record.path === 'string'
          ? [{ path: record.path, label: typeof record.label === 'string' ? record.label : undefined }]
          : []
      }),
    },
  }
}

export function stateBackupFileName(exportedAt: string): string {
  return `keepindex-backup-${exportedAt.slice(0, 19).replace(/[:T]/g, '-')}.json`
}

export function downloadStateBackup(backup: KeepIndexBackup): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = stateBackupFileName(backup.exportedAt)
  anchor.click()
  URL.revokeObjectURL(url)
}

async function sendJson(url: string, method: string, body?: unknown): Promise<void> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (url === '/api/session') headers['If-Match'] = '*'
  const response = await fetch(url, {
    method,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error ?? `Restore failed for ${url}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseServerState(value: unknown): BackupServerState {
  if (!isRecord(value)) throw new Error('This is not a supported KeepIndex backup.')
  const { collections, history, session, knowledgeResources } = value
  if (
    !Array.isArray(collections) || !collections.every(isRecord) ||
    !Array.isArray(history) || !history.every(isRecord) ||
    (session !== null && !isRecord(session)) ||
    !Array.isArray(knowledgeResources)
  ) {
    throw new Error('This is not a supported KeepIndex backup.')
  }

  const normalizedResources = knowledgeResources.map((resource) => {
    if (
      !isRecord(resource) ||
      typeof resource.path !== 'string' ||
      resource.path.trim().length === 0 ||
      (resource.label !== undefined && typeof resource.label !== 'string')
    ) {
      throw new Error('This is not a supported KeepIndex backup.')
    }
    return {
      path: resource.path,
      label: typeof resource.label === 'string' ? resource.label : undefined,
    }
  })

  return { collections, history, session, knowledgeResources: normalizedResources }
}

function isValidClientStorageValue(key: ClientStorageKey, value: string): boolean {
  if (value.length > MAX_CLIENT_STORAGE_VALUE_BYTES) return false
  if (key === KEEPINDEX_STORAGE_KEYS.theme) return value === 'dark' || value === 'light'
  try {
    JSON.parse(value)
    return true
  } catch {
    throw new Error(`Backup contains invalid browser state for ${key}.`)
  }
}

function normalizeClientStorage(source: unknown): KeepIndexBackup['clientStorage'] {
  if (!isRecord(source)) return {}
  const clientStorage: KeepIndexBackup['clientStorage'] = {}
  for (const key of CLIENT_STORAGE_KEYS) {
    const value = source[key]
    if (typeof value === 'string' && isValidClientStorageValue(key, value)) {
      clientStorage[key] = value
    }
  }
  return clientStorage
}

export function parseStateBackup(text: string): KeepIndexBackup {
  if (text.length > MAX_BACKUP_IMPORT_BYTES) throw new Error('Backup exceeds the 10 MB import limit.')
  const unknownParsed = JSON.parse(text) as unknown
  if (!isRecord(unknownParsed)) throw new Error('This is not a supported KeepIndex backup.')
  const parsed = unknownParsed as BackupCandidate
  if (parsed.schema !== KEEPINDEX_BACKUP_SCHEMA) {
    throw new Error('This is not a supported KeepIndex backup.')
  }
  if (
    parsed.version !== 1 ||
    !isRecord(parsed.clientStorage) ||
    typeof parsed.exportedAt !== 'string' ||
    !Number.isFinite(Date.parse(parsed.exportedAt))
  ) {
    throw new Error('This is not a supported KeepIndex backup.')
  }

  const server = parseServerState(parsed.server)

  return {
    schema: KEEPINDEX_BACKUP_SCHEMA,
    version: 1,
    exportedAt: parsed.exportedAt,
    clientStorage: normalizeClientStorage(parsed.clientStorage),
    server,
  }
}

export async function restoreStateBackup(
  backup: KeepIndexBackup,
  onProgress?: (message: string) => void
): Promise<void> {
  onProgress?.('Clearing current shared state…')
  await Promise.all([
    sendJson('/api/collections', 'DELETE'),
    sendJson('/api/history', 'DELETE'),
    sendJson('/api/session', 'DELETE'),
    sendJson('/api/knowledge/clear', 'POST'),
  ])

  onProgress?.('Restoring collections and history…')
  for (const item of backup.server.collections.slice(0, 500)) {
    await sendJson('/api/collections', 'POST', item)
  }
  for (const entry of backup.server.history.slice(0, 200).reverse()) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    await sendJson('/api/history', 'POST', {
      query: record.query,
      mode: record.mode,
      focus: record.focus,
    })
  }
  if (backup.server.session) await sendJson('/api/session', 'PUT', backup.server.session)

  for (const resource of backup.server.knowledgeResources.slice(0, 20)) {
    onProgress?.(`Re-indexing ${resource.label || resource.path}…`)
    await sendJson('/api/knowledge/index', 'POST', resource)
  }

  onProgress?.('Restoring browser state…')
  for (const key of CLIENT_STORAGE_KEYS) {
    const value = backup.clientStorage[key]
    if (typeof value !== 'string' || !isValidClientStorageValue(key, value)) continue
    localStorage.setItem(key, value)
  }
}
