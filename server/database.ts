import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { readKeepIndexEnvironment, type Environment } from './environment'
import { canonicalizeUrl, tokenizeQuery } from './retrieval'

export type KnowledgeChunkMetadata = {
  extension?: string
  sourceKind?: 'note' | 'document' | 'code' | 'file'
  mimeType?: string
  extractor?: 'text' | 'pdftotext' | 'pandoc' | 'metadata'
  metadataOnly?: boolean
  aliases?: string[]
  tags?: string[]
  outgoingLinks?: string[]
  modifiedAt?: number
}

export type PersistedKnowledgeChunk = {
  id: string
  filePath: string
  fileName: string
  content: string
  startLine: number
  endLine: number
  metadata?: KnowledgeChunkMetadata
}

export type PersistedKnowledgeResource = {
  id: string
  path: string
  label: string
  kind?: 'obsidian' | 'folder'
  indexedAt: number
  latestModifiedAt: number
  fileCount: number
  chunkCount: number
  indexedBytes: number
  noteCount?: number
  documentCount?: number
  codeFileCount?: number
  metadataFileCount?: number
  formatCounts?: Record<string, number>
  capped: boolean
  skippedLargeFiles: number
  skippedSensitiveFiles: number
  skippedUnreadableFiles: number
}

export type BrowserHistoryEntry = {
  sourceKey: string
  browser: string
  profile: string
  url: string
  title: string
  visitCount: number
  typedCount: number
  lastVisitedAt: number
}

export type BrowserHistorySearchResult = BrowserHistoryEntry & {
  score: number
}

export type PersistedCollection = {
  id: string
  query: string
  answer: string
  sources: unknown[]
  localSources?: unknown[]
  researchPlan?: string[]
  mode: 'ai' | 'search' | 'research'
  createdAt: number
}

export type SharedSession = {
  lastQuery: string
  lastMode: 'search' | 'ai' | 'chat' | 'research'
  lastFocusMode: string
  lastAnswer: string
  lastSources: unknown[]
  lastLocalSources: unknown[]
}

export type SharedSessionRecord = {
  session: SharedSession | null
  revision: number
  updatedAt: number | null
  deleted: boolean
}

export type SharedSessionMutationResult =
  | { ok: true; record: SharedSessionRecord }
  | { ok: false; conflict: true; record: SharedSessionRecord }

export type TelemetryEvent = {
  kind: 'search' | 'ask' | 'chat' | 'research' | 'knowledge_query'
  requestId?: string
  query: string
  focus?: string
  resultCount?: number
  sourceCount?: number
  latencyMs: number
  success: boolean
  error?: string
  metadata?: Record<string, unknown>
}

export type QueryRecordMode = 'search' | 'ai' | 'chat' | 'research'
export type QueryRecordOutcome =
  | 'running'
  | 'succeeded'
  | 'no_evidence'
  | 'failed'
  | 'aborted'
  | 'interrupted'

export type QuerySourcePack = {
  web: unknown[]
  local: unknown[]
}

export type QueryTokenMetrics = {
  promptTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  tokenCountsEstimated: boolean | null
}

export type QueryTimings = {
  generationMs: number | null
  timeToFirstTokenMs: number | null
  tokensPerSecond: number | null
  endToEndMs: number | null
}

/**
 * One measured phase in a query execution. Offsets make concurrent phases
 * visible instead of implying that every duration is additive.
 */
export type QueryExecutionPhase = {
  name: string
  startedOffsetMs: number
  durationMs: number
  status: 'ok' | 'error' | 'aborted' | 'skipped'
  detail: Record<string, string | number | boolean | null>
}

export type RetrievalOutcomeState =
  | 'ok'
  | 'no-results'
  | 'partial'
  | 'rate-limited'
  | 'unreachable'
  | 'timeout'
  | 'error'
  | 'skipped'

export type RetrievalSourceOutcome = {
  provider: string
  state: RetrievalOutcomeState
  attempted: boolean
  rawCandidateCount: number
  usableCandidateCount: number
  selectedCount: number
  latencyMs: number | null
  detail: string | null
}

/**
 * Query-level provenance for the retrieval path. Candidate and selection
 * counts are kept separate so a healthy provider cannot be mistaken for a
 * source that contributed evidence to the final prompt.
 */
export type QueryRetrievalDiagnostics = {
  strategy: string
  web: RetrievalSourceOutcome
  local: RetrievalSourceOutcome
  liveEngines: string[]
  failedEngines: Array<{ engine: string; reason: string }>
  engineCoveragePct: number | null
  fallbackAttempted: boolean
  fallbackReason: string | null
}

export type QueryRecord = {
  requestId: string
  endpoint: string
  query: string
  mode: QueryRecordMode
  focus: string
  requestedModel: string | null
  actualModel: string | null
  answerText: string
  sourcePack: QuerySourcePack
  citationIds: string[]
  grounding: unknown | null
  metrics: QueryTokenMetrics
  timings: QueryTimings
  executionTrace: QueryExecutionPhase[]
  retrievalDiagnostics: QueryRetrievalDiagnostics | null
  sourceCount: number
  candidateSourceCount: number | null
  degraded: boolean
  outcome: QueryRecordOutcome
  error: string | null
  startedAt: number
  completedAt: number | null
  updatedAt: number
}

export type QueryRecordSummary = Omit<
  QueryRecord,
  'answerText' | 'sourcePack' | 'citationIds' | 'grounding'
>

export type BeginQueryRecordInput = {
  requestId?: string
  endpoint?: string
  query: string
  mode: QueryRecordMode
  focus?: string
  requestedModel?: string | null
  startedAt?: number
}

export type CompleteQueryRecordInput = {
  outcome: Exclude<QueryRecordOutcome, 'running'>
  actualModel?: string | null
  answerText?: string
  sourcePack?: QuerySourcePack
  citationIds?: string[]
  grounding?: unknown | null
  metrics?: Partial<QueryTokenMetrics> | null
  timings?: Partial<QueryTimings> | null
  executionTrace?: QueryExecutionPhase[]
  retrievalDiagnostics?: QueryRetrievalDiagnostics | null
  sourceCount?: number
  candidateSourceCount?: number | null
  degraded?: boolean
  error?: string | null
  completedAt?: number
}

export type QueryRecordListOptions = {
  limit?: number
  before?: number
  mode?: QueryRecordMode
}

export type DatabaseIntegrityDiagnostics = {
  kind: 'quick' | 'full'
  status: 'ok' | 'failed' | 'unknown'
  messages: string[]
  checkedAt: number | null
  durationMs: number | null
}

export type DatabaseCheckpointDiagnostics = {
  mode: 'PASSIVE' | 'RESTART' | 'TRUNCATE'
  busy: number
  logFrames: number
  checkpointedFrames: number
  checkedAt: number
}

export type DatabaseDiagnostics = {
  path: string
  reachable: boolean
  lastPingAt: number | null
  schemaVersion: number
  expectedSchemaVersion: number
  journalMode: string
  walAutoCheckpointPages: number
  journalSizeLimitBytes: number
  integrity: DatabaseIntegrityDiagnostics
  checkpoint: DatabaseCheckpointDiagnostics | null
  maintenance: {
    lastRunAt: number | null
    lastOptimizeAt: number | null
    deletedTelemetryRows: number
    deletedQueryRows: number
    deletedHistoryRows: number
  }
}

export type DatabaseRetentionOptions = {
  telemetryMaxRows?: number
  telemetryMaxAgeMs?: number | null
  queryRecordMaxRows?: number
  queryRecordMaxAgeMs?: number | null
  searchHistoryMaxRows?: number
  maxDeleteRowsPerTable?: number
}

export type DatabaseServiceOptions = {
  path?: string
  now?: () => number
  walAutoCheckpointPages?: number
  journalSizeLimitBytes?: number
  retention?: DatabaseRetentionOptions
}

export type DatabaseMaintenanceOptions = {
  integrityCheck?: 'none' | 'quick' | 'full'
  checkpointMode?: 'PASSIVE' | 'RESTART' | 'TRUNCATE'
  optimize?: boolean
}

type SqlValue = string | number | bigint | null | Uint8Array

type SqliteRunResult = {
  changes?: number | bigint
  lastInsertRowid?: number | bigint
}

type SqliteStatement = {
  run: (...values: SqlValue[]) => SqliteRunResult | unknown
  all: (...values: SqlValue[]) => unknown[]
  get: (...values: SqlValue[]) => unknown
}

type SqliteDatabase = {
  exec: (sql: string) => unknown
  prepare?: (sql: string) => SqliteStatement
  query?: (sql: string) => SqliteStatement
  close?: () => unknown
}

type Row = Record<string, unknown>

export type ResolveDatabasePathOptions = {
  environment?: Environment
  projectRoot?: string
}

/**
 * Resolves the production database path. A configured path wins; otherwise an
 * existing or fresh installation uses the canonical KeepIndex filename.
 */
export function resolveDatabasePath(options: ResolveDatabasePathOptions = {}): string {
  const environment = options.environment ?? process.env
  const configuredPath = readKeepIndexEnvironment('DB_PATH', environment)
  if (configuredPath) return configuredPath

  const projectRoot = options.projectRoot ?? process.cwd()
  return resolve(projectRoot, 'server', 'keepindex.sqlite')
}

// Unit tests use an isolated in-memory default. Explicit database variables
// still take precedence so configuration behavior can be exercised directly.
const CONFIGURED_DATABASE_PATH = readKeepIndexEnvironment('DB_PATH')
const DEFAULT_DATABASE_PATH = CONFIGURED_DATABASE_PATH
  ?? (process.env.NODE_ENV === 'test' ? ':memory:' : resolveDatabasePath())
const DEFAULT_WAL_AUTOCHECKPOINT_PAGES = 1000
const DEFAULT_JOURNAL_SIZE_LIMIT_BYTES = 64 * 1024 * 1024
const DEFAULT_RETENTION_DAYS_MS = 180 * 24 * 60 * 60_000
const DEFAULT_SOURCE_PACK: QuerySourcePack = { web: [], local: [] }

export const LATEST_SCHEMA_VERSION = 6

const dynamicImport = Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<Record<string, unknown>>

function prepare(db: SqliteDatabase, sql: string): SqliteStatement {
  const statement = db.prepare?.(sql) ?? db.query?.(sql)
  if (!statement) throw new Error('SQLite runtime does not support prepared statements')
  return statement
}

function asRows(value: unknown[]): Row[] {
  return value.filter((row): row is Row => typeof row === 'object' && row !== null)
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function firstValue(row: Row | undefined): unknown {
  if (!row) return undefined
  return Object.values(row)[0]
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value)
}

function changedRows(result: unknown): number {
  if (!result || typeof result !== 'object') return 0
  return Number((result as SqliteRunResult).changes ?? 0)
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value as number)) : fallback
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value as number)) : fallback
}

function hasColumn(db: SqliteDatabase, table: string, column: string): boolean {
  return asRows(prepare(db, `PRAGMA table_info(${table})`).all())
    .some((row) => String(row.name ?? '') === column)
}

function pragmaNumber(db: SqliteDatabase, name: string): number {
  return Number(firstValue(prepare(db, `PRAGMA ${name}`).get() as Row | undefined) ?? 0)
}

function pragmaString(db: SqliteDatabase, name: string): string {
  return String(firstValue(prepare(db, `PRAGMA ${name}`).get() as Row | undefined) ?? '')
}

const migrations: Array<{ version: number; up: (db: SqliteDatabase) => void }> = [
  {
    version: 1,
    up(db) {
      // Version 1 deliberately matches the original unversioned schema. Running
      // these statements adopts an existing database without rewriting data.
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS knowledge_chunks (
          id TEXT PRIMARY KEY,
          file_path TEXT NOT NULL,
          file_name TEXT NOT NULL,
          content TEXT NOT NULL,
          start_line INTEGER NOT NULL,
          end_line INTEGER NOT NULL,
          indexed_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_file_path ON knowledge_chunks(file_path);

        CREATE TABLE IF NOT EXISTS search_history (
          query TEXT PRIMARY KEY COLLATE NOCASE,
          mode TEXT NOT NULL,
          focus TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_search_history_created_at ON search_history(created_at DESC);

        CREATE TABLE IF NOT EXISTS collections (
          id TEXT PRIMARY KEY,
          query TEXT NOT NULL,
          answer TEXT NOT NULL,
          sources_json TEXT NOT NULL,
          local_sources_json TEXT,
          research_plan_json TEXT,
          mode TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_collections_created_at ON collections(created_at DESC);

        CREATE TABLE IF NOT EXISTS shared_sessions (
          id TEXT PRIMARY KEY,
          data_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS search_telemetry (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,
          query TEXT NOT NULL,
          focus TEXT,
          result_count INTEGER NOT NULL DEFAULT 0,
          source_count INTEGER NOT NULL DEFAULT 0,
          latency_ms INTEGER NOT NULL,
          success INTEGER NOT NULL,
          error TEXT,
          metadata_json TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_telemetry_created_at ON search_telemetry(created_at DESC);
      `)
    },
  },
  {
    version: 2,
    up(db) {
      if (!hasColumn(db, 'search_history', 'hit_count')) {
        db.exec('ALTER TABLE search_history ADD COLUMN hit_count INTEGER NOT NULL DEFAULT 1;')
      }
      if (!hasColumn(db, 'shared_sessions', 'revision')) {
        db.exec('ALTER TABLE shared_sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;')
      }
      if (!hasColumn(db, 'shared_sessions', 'deleted')) {
        db.exec('ALTER TABLE shared_sessions ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;')
      }
      if (!hasColumn(db, 'search_telemetry', 'request_id')) {
        db.exec('ALTER TABLE search_telemetry ADD COLUMN request_id TEXT;')
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_search_history_rank
          ON search_history(hit_count DESC, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_telemetry_request_id
          ON search_telemetry(request_id);

        CREATE TABLE IF NOT EXISTS query_records (
          request_id TEXT PRIMARY KEY,
          endpoint TEXT NOT NULL,
          query TEXT NOT NULL,
          mode TEXT NOT NULL CHECK (mode IN ('search', 'ai', 'chat', 'research')),
          focus TEXT NOT NULL,
          requested_model TEXT,
          actual_model TEXT,
          answer_text TEXT NOT NULL DEFAULT '',
          source_pack_json TEXT NOT NULL DEFAULT '{"web":[],"local":[]}',
          citation_ids_json TEXT NOT NULL DEFAULT '[]',
          grounding_json TEXT,
          prompt_tokens INTEGER,
          output_tokens INTEGER,
          total_tokens INTEGER,
          token_counts_estimated INTEGER,
          generation_ms INTEGER,
          time_to_first_token_ms INTEGER,
          tokens_per_second REAL,
          end_to_end_ms INTEGER,
          source_count INTEGER NOT NULL DEFAULT 0,
          candidate_source_count INTEGER,
          degraded INTEGER NOT NULL DEFAULT 0,
          outcome TEXT NOT NULL CHECK (
            outcome IN ('running', 'succeeded', 'no_evidence', 'failed', 'aborted', 'interrupted')
          ),
          error TEXT,
          started_at INTEGER NOT NULL,
          completed_at INTEGER,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_query_records_started_at
          ON query_records(started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_query_records_mode_started_at
          ON query_records(mode, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_query_records_outcome_started_at
          ON query_records(outcome, started_at DESC);
      `)
    },
  },
  {
    version: 3,
    up(db) {
      if (!hasColumn(db, 'query_records', 'retrieval_diagnostics_json')) {
        db.exec('ALTER TABLE query_records ADD COLUMN retrieval_diagnostics_json TEXT;')
      }
    },
  },
  {
    version: 4,
    up(db) {
      if (!hasColumn(db, 'knowledge_chunks', 'metadata_json')) {
        db.exec("ALTER TABLE knowledge_chunks ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';")
      }
    },
  },
  {
    version: 5,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS browser_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_key TEXT NOT NULL UNIQUE,
          browser TEXT NOT NULL,
          profile TEXT NOT NULL,
          url TEXT NOT NULL,
          title TEXT NOT NULL,
          visit_count INTEGER NOT NULL DEFAULT 0,
          typed_count INTEGER NOT NULL DEFAULT 0,
          last_visited_at INTEGER NOT NULL DEFAULT 0,
          imported_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_browser_history_last_visited
          ON browser_history(last_visited_at DESC);
        CREATE INDEX IF NOT EXISTS idx_browser_history_url
          ON browser_history(url);

        CREATE VIRTUAL TABLE IF NOT EXISTS browser_history_fts USING fts5(
          title, url, content='browser_history', content_rowid='id',
          tokenize='unicode61 remove_diacritics 2'
        );
        CREATE TRIGGER IF NOT EXISTS browser_history_ai AFTER INSERT ON browser_history BEGIN
          INSERT INTO browser_history_fts(rowid, title, url) VALUES (new.id, new.title, new.url);
        END;
        CREATE TRIGGER IF NOT EXISTS browser_history_ad AFTER DELETE ON browser_history BEGIN
          INSERT INTO browser_history_fts(browser_history_fts, rowid, title, url)
          VALUES ('delete', old.id, old.title, old.url);
        END;
        CREATE TRIGGER IF NOT EXISTS browser_history_au AFTER UPDATE ON browser_history BEGIN
          INSERT INTO browser_history_fts(browser_history_fts, rowid, title, url)
          VALUES ('delete', old.id, old.title, old.url);
          INSERT INTO browser_history_fts(rowid, title, url) VALUES (new.id, new.title, new.url);
        END;
        INSERT INTO browser_history_fts(browser_history_fts) VALUES ('rebuild');
      `)
    },
  },
  {
    version: 6,
    up(db) {
      if (!hasColumn(db, 'query_records', 'execution_trace_json')) {
        db.exec("ALTER TABLE query_records ADD COLUMN execution_trace_json TEXT NOT NULL DEFAULT '[]';")
      }
    },
  },
]

const requiredSchemaColumns: Record<string, string[]> = {
  app_meta: ['key', 'value', 'updated_at'],
  knowledge_chunks: ['id', 'file_path', 'file_name', 'content', 'start_line', 'end_line', 'indexed_at', 'metadata_json'],
  search_history: ['query', 'mode', 'focus', 'created_at', 'hit_count'],
  collections: ['id', 'query', 'answer', 'sources_json', 'mode', 'created_at'],
  shared_sessions: ['id', 'data_json', 'updated_at', 'revision', 'deleted'],
  search_telemetry: ['id', 'kind', 'query', 'latency_ms', 'success', 'created_at', 'request_id'],
  browser_history: ['id', 'source_key', 'browser', 'profile', 'url', 'title', 'last_visited_at'],
  query_records: [
    'request_id',
    'query',
    'mode',
    'source_pack_json',
    'retrieval_diagnostics_json',
    'execution_trace_json',
    'outcome',
    'started_at',
    'updated_at',
  ],
}

function validateSchema(db: SqliteDatabase): void {
  for (const [table, requiredColumns] of Object.entries(requiredSchemaColumns)) {
    const actualColumns = new Set(
      asRows(prepare(db, `PRAGMA table_info(${table})`).all()).map((row) => String(row.name ?? ''))
    )
    for (const column of requiredColumns) {
      if (!actualColumns.has(column)) {
        throw new Error(`SQLite schema is incompatible: ${table}.${column} is missing`)
      }
    }
  }
}

function applyMigrations(db: SqliteDatabase): number {
  const currentVersion = pragmaNumber(db, 'user_version')
  if (currentVersion > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `SQLite schema version ${currentVersion} is newer than supported version ${LATEST_SCHEMA_VERSION}`
    )
  }
  if (currentVersion === LATEST_SCHEMA_VERSION) {
    validateSchema(db)
    return currentVersion
  }

  db.exec('BEGIN IMMEDIATE;')
  try {
    for (const migration of migrations) {
      if (migration.version <= currentVersion) continue
      migration.up(db)
      db.exec(`PRAGMA user_version = ${migration.version};`)
    }
    validateSchema(db)
    db.exec('COMMIT;')
  } catch (error) {
    db.exec('ROLLBACK;')
    throw error
  }
  return pragmaNumber(db, 'user_version')
}

function mapQueryRecord(row: Row): QueryRecord {
  const citations = parseJson<unknown[]>(row.citation_ids_json, [])
    .filter((value): value is string => typeof value === 'string')
  const sourcePack = parseJson<QuerySourcePack>(row.source_pack_json, DEFAULT_SOURCE_PACK)
  return {
    requestId: String(row.request_id ?? ''),
    endpoint: String(row.endpoint ?? ''),
    query: String(row.query ?? ''),
    mode: String(row.mode ?? 'ai') as QueryRecordMode,
    focus: String(row.focus ?? 'all'),
    requestedModel: row.requested_model == null ? null : String(row.requested_model),
    actualModel: row.actual_model == null ? null : String(row.actual_model),
    answerText: String(row.answer_text ?? ''),
    sourcePack: {
      web: Array.isArray(sourcePack?.web) ? sourcePack.web : [],
      local: Array.isArray(sourcePack?.local) ? sourcePack.local : [],
    },
    citationIds: citations,
    grounding: parseJson<unknown | null>(row.grounding_json, null),
    metrics: {
      promptTokens: nullableNumber(row.prompt_tokens),
      outputTokens: nullableNumber(row.output_tokens),
      totalTokens: nullableNumber(row.total_tokens),
      tokenCountsEstimated:
        row.token_counts_estimated == null ? null : Number(row.token_counts_estimated) === 1,
    },
    timings: {
      generationMs: nullableNumber(row.generation_ms),
      timeToFirstTokenMs: nullableNumber(row.time_to_first_token_ms),
      tokensPerSecond: nullableNumber(row.tokens_per_second),
      endToEndMs: nullableNumber(row.end_to_end_ms),
    },
    executionTrace: parseJson<QueryExecutionPhase[]>(row.execution_trace_json, []),
    retrievalDiagnostics: parseJson<QueryRetrievalDiagnostics | null>(
      row.retrieval_diagnostics_json,
      null
    ),
    sourceCount: Number(row.source_count ?? 0),
    candidateSourceCount: nullableNumber(row.candidate_source_count),
    degraded: Number(row.degraded ?? 0) === 1,
    outcome: String(row.outcome ?? 'failed') as QueryRecordOutcome,
    error: row.error == null ? null : String(row.error),
    startedAt: Number(row.started_at ?? 0),
    completedAt: nullableNumber(row.completed_at),
    updatedAt: Number(row.updated_at ?? 0),
  }
}

function toQuerySummary(record: QueryRecord): QueryRecordSummary {
  const { answerText: _answerText, sourcePack: _sourcePack, citationIds: _citationIds, grounding: _grounding, ...summary } = record
  return summary
}

export function createDatabaseService(options: DatabaseServiceOptions = {}) {
  const path = options.path ?? DEFAULT_DATABASE_PATH
  const now = options.now ?? Date.now
  const walAutoCheckpointPages = positiveInteger(
    options.walAutoCheckpointPages,
    DEFAULT_WAL_AUTOCHECKPOINT_PAGES
  )
  const journalSizeLimitBytes = positiveInteger(
    options.journalSizeLimitBytes,
    DEFAULT_JOURNAL_SIZE_LIMIT_BYTES
  )
  const retention = {
    telemetryMaxRows: nonNegativeInteger(options.retention?.telemetryMaxRows, 100_000),
    telemetryMaxAgeMs:
      options.retention?.telemetryMaxAgeMs === null
        ? null
        : nonNegativeInteger(options.retention?.telemetryMaxAgeMs, DEFAULT_RETENTION_DAYS_MS),
    queryRecordMaxRows: nonNegativeInteger(options.retention?.queryRecordMaxRows, 10_000),
    queryRecordMaxAgeMs:
      options.retention?.queryRecordMaxAgeMs === null
        ? null
        : nonNegativeInteger(options.retention?.queryRecordMaxAgeMs, DEFAULT_RETENTION_DAYS_MS),
    searchHistoryMaxRows: nonNegativeInteger(options.retention?.searchHistoryMaxRows, 200),
    maxDeleteRowsPerTable: positiveInteger(options.retention?.maxDeleteRowsPerTable, 10_000),
  }

  let databasePromise: Promise<SqliteDatabase> | null = null
  let diagnostics: DatabaseDiagnostics = {
    path,
    reachable: false,
    lastPingAt: null,
    schemaVersion: 0,
    expectedSchemaVersion: LATEST_SCHEMA_VERSION,
    journalMode: '',
    walAutoCheckpointPages,
    journalSizeLimitBytes,
    integrity: {
      kind: 'quick',
      status: 'unknown',
      messages: [],
      checkedAt: null,
      durationMs: null,
    },
    checkpoint: null,
    maintenance: {
      lastRunAt: null,
      lastOptimizeAt: null,
      deletedTelemetryRows: 0,
      deletedQueryRows: 0,
      deletedHistoryRows: 0,
    },
  }

  function refreshPragmaDiagnostics(db: SqliteDatabase): void {
    diagnostics = {
      ...diagnostics,
      reachable: true,
      schemaVersion: pragmaNumber(db, 'user_version'),
      journalMode: pragmaString(db, 'journal_mode'),
      walAutoCheckpointPages: pragmaNumber(db, 'wal_autocheckpoint'),
      journalSizeLimitBytes: pragmaNumber(db, 'journal_size_limit'),
    }
  }

  function runIntegrityCheckRaw(
    db: SqliteDatabase,
    kind: 'quick' | 'full'
  ): DatabaseIntegrityDiagnostics {
    const startedAt = now()
    const pragma = kind === 'full' ? 'integrity_check' : 'quick_check(1)'
    const messages = asRows(prepare(db, `PRAGMA ${pragma}`).all())
      .map((row) => String(firstValue(row) ?? ''))
      .filter(Boolean)
    const foreignKeyRows = asRows(prepare(db, 'PRAGMA foreign_key_check').all())
    if (foreignKeyRows.length > 0) {
      messages.push(...foreignKeyRows.map((row) => `foreign key violation: ${JSON.stringify(row)}`))
    }
    const status = messages.length > 0 && messages.every((message) => message.toLowerCase() === 'ok')
      ? 'ok'
      : 'failed'
    return {
      kind,
      status,
      messages,
      checkedAt: now(),
      durationMs: Math.max(0, now() - startedAt),
    }
  }

  async function openDatabase(): Promise<SqliteDatabase> {
    if (path !== ':memory:') await mkdir(dirname(path), { recursive: true })

    let db: SqliteDatabase
    if ('Bun' in globalThis) {
      const sqliteModule = await dynamicImport('bun:sqlite') as {
        Database?: new (
          path: string,
          options?: { create?: boolean; strict?: boolean }
        ) => SqliteDatabase
      }
      if (!sqliteModule.Database) throw new Error('bun:sqlite Database export unavailable')
      db = new sqliteModule.Database(path, { create: true, strict: true })
    } else {
      const sqliteModule = await dynamicImport('node:sqlite') as {
        DatabaseSync?: new (path: string) => SqliteDatabase
      }
      if (!sqliteModule.DatabaseSync) throw new Error('node:sqlite DatabaseSync export unavailable')
      db = new sqliteModule.DatabaseSync(path)
    }

    try {
      db.exec('PRAGMA journal_mode = WAL;')
      db.exec('PRAGMA synchronous = NORMAL;')
      db.exec('PRAGMA foreign_keys = ON;')
      db.exec('PRAGMA busy_timeout = 5000;')
      db.exec(`PRAGMA wal_autocheckpoint = ${walAutoCheckpointPages};`)
      db.exec(`PRAGMA journal_size_limit = ${journalSizeLimitBytes};`)
      applyMigrations(db)

      const startupAt = now()
      prepare(
        db,
        `UPDATE query_records
         SET outcome = 'interrupted',
             error = COALESCE(error, 'Server restarted before completion'),
             completed_at = ?, updated_at = ?
         WHERE outcome = 'running'`
      ).run(startupAt, startupAt)

      db.exec('PRAGMA optimize=0x10002;')
      refreshPragmaDiagnostics(db)
      diagnostics.integrity = runIntegrityCheckRaw(db, 'quick')
      diagnostics.maintenance.lastOptimizeAt = now()
      return db
    } catch (error) {
      db.close?.()
      throw error
    }
  }

  async function getDatabase(): Promise<SqliteDatabase> {
    if (!databasePromise) {
      databasePromise = openDatabase().catch((error) => {
        databasePromise = null
        diagnostics = { ...diagnostics, reachable: false }
        throw error
      })
    }
    return databasePromise
  }

  async function close(): Promise<void> {
    if (!databasePromise) return
    const db = await databasePromise
    db.close?.()
    databasePromise = null
    diagnostics = { ...diagnostics, reachable: false }
  }

  async function loadKnowledgeSnapshot(): Promise<{
    path: string | null
    resources: PersistedKnowledgeResource[]
    chunks: PersistedKnowledgeChunk[]
  }> {
    const db = await getDatabase()
    const pathRow = prepare(db, "SELECT value, updated_at FROM app_meta WHERE key = 'knowledge_path'").get() as Row | undefined
    const resourcesRow = prepare(db, "SELECT value FROM app_meta WHERE key = 'knowledge_resources'").get() as Row | undefined
    const rows = asRows(
      prepare(
        db,
        'SELECT id, file_path, file_name, content, start_line, end_line, metadata_json FROM knowledge_chunks ORDER BY rowid'
      ).all()
    )
    const knowledgePath = typeof pathRow?.value === 'string' ? pathRow.value : null
    const chunks = rows.map((row) => ({
      id: String(row.id ?? ''),
      filePath: String(row.file_path ?? ''),
      fileName: String(row.file_name ?? ''),
      content: String(row.content ?? ''),
      startLine: Number(row.start_line ?? 1),
      endLine: Number(row.end_line ?? row.start_line ?? 1),
      metadata: parseJson<KnowledgeChunkMetadata>(row.metadata_json, {}),
    }))
    const storedResources = parseJson<PersistedKnowledgeResource[]>(resourcesRow?.value, [])
    const resources = storedResources.length > 0
      ? storedResources
      : knowledgePath
        ? [{
            id: 'imported-primary',
            path: knowledgePath,
            label: knowledgePath.split('/').filter(Boolean).pop() ?? 'Primary vault',
            kind: 'folder' as const,
            indexedAt: Number(pathRow?.updated_at ?? 0),
            latestModifiedAt: 0,
            fileCount: new Set(chunks.map((chunk) => chunk.filePath)).size,
            chunkCount: chunks.length,
            indexedBytes: chunks.reduce((total, chunk) => total + chunk.content.length, 0),
            noteCount: new Set(chunks.filter((chunk) => chunk.metadata?.sourceKind === 'note').map((chunk) => chunk.filePath)).size,
            documentCount: new Set(chunks.filter((chunk) => chunk.metadata?.sourceKind === 'document').map((chunk) => chunk.filePath)).size,
            codeFileCount: new Set(chunks.filter((chunk) => chunk.metadata?.sourceKind === 'code').map((chunk) => chunk.filePath)).size,
            metadataFileCount: new Set(chunks.filter((chunk) => chunk.metadata?.metadataOnly).map((chunk) => chunk.filePath)).size,
            formatCounts: {},
            capped: false,
            skippedLargeFiles: 0,
            skippedSensitiveFiles: 0,
            skippedUnreadableFiles: 0,
          }]
        : []
    return { path: knowledgePath, resources, chunks }
  }

  async function replaceKnowledgeSnapshot(
    knowledgePath: string | null,
    chunks: PersistedKnowledgeChunk[],
    resources: PersistedKnowledgeResource[]
  ): Promise<void> {
    const db = await getDatabase()
    const timestamp = now()
    db.exec('BEGIN IMMEDIATE;')
    try {
      db.exec('DELETE FROM knowledge_chunks;')
      const insert = prepare(
        db,
        `INSERT INTO knowledge_chunks
         (id, file_path, file_name, content, start_line, end_line, indexed_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      for (const chunk of chunks) {
        insert.run(
          chunk.id,
          chunk.filePath,
          chunk.fileName,
          chunk.content,
          chunk.startLine,
          chunk.endLine,
          timestamp,
          JSON.stringify(chunk.metadata ?? {})
        )
      }
      prepare(
        db,
        `INSERT INTO app_meta (key, value, updated_at) VALUES ('knowledge_resources', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(JSON.stringify(resources), timestamp)
      if (knowledgePath) {
        prepare(
          db,
          `INSERT INTO app_meta (key, value, updated_at) VALUES ('knowledge_path', ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        ).run(knowledgePath, timestamp)
      } else {
        prepare(db, "DELETE FROM app_meta WHERE key = 'knowledge_path'").run()
      }
      db.exec('COMMIT;')
    } catch (error) {
      db.exec('ROLLBACK;')
      throw error
    }
  }

  async function clearKnowledgeSnapshot(): Promise<void> {
    const db = await getDatabase()
    db.exec('BEGIN IMMEDIATE;')
    try {
      db.exec('DELETE FROM knowledge_chunks;')
      prepare(db, "DELETE FROM app_meta WHERE key IN ('knowledge_path', 'knowledge_resources')").run()
      db.exec('COMMIT;')
    } catch (error) {
      db.exec('ROLLBACK;')
      throw error
    }
  }

  async function listSearchHistory(limit = 50): Promise<Array<{
    query: string
    mode: string
    focus: string
    createdAt: number
    hitCount: number
  }>> {
    const db = await getDatabase()
    const safeLimit = Math.min(200, Math.max(1, Math.trunc(limit)))
    const rows = asRows(
      prepare(
        db,
        `SELECT query, mode, focus, created_at, hit_count
         FROM search_history
         ORDER BY hit_count DESC, created_at DESC
         LIMIT ?`
      ).all(safeLimit)
    )
    return rows.map((row) => ({
      query: String(row.query ?? ''),
      mode: String(row.mode ?? 'ai'),
      focus: String(row.focus ?? 'all'),
      createdAt: Number(row.created_at ?? 0),
      hitCount: Number(row.hit_count ?? 1),
    }))
  }

  async function upsertSearchHistory(query: string, mode = 'ai', focus = 'all'): Promise<void> {
    const db = await getDatabase()
    prepare(
      db,
      `INSERT INTO search_history (query, mode, focus, created_at, hit_count)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(query) DO UPDATE SET
         mode = excluded.mode,
         focus = excluded.focus,
         created_at = excluded.created_at,
         hit_count = search_history.hit_count + 1`
    ).run(query, mode, focus, now())
  }

  async function deleteSearchHistory(query: string): Promise<void> {
    const db = await getDatabase()
    prepare(db, 'DELETE FROM search_history WHERE query = ?').run(query)
  }

  async function clearSearchHistory(): Promise<void> {
    const db = await getDatabase()
    db.exec('DELETE FROM search_history;')
  }

  async function listCollections(): Promise<PersistedCollection[]> {
    const db = await getDatabase()
    const rows = asRows(
      prepare(
        db,
        `SELECT id, query, answer, sources_json, local_sources_json,
                research_plan_json, mode, created_at
         FROM collections ORDER BY created_at DESC`
      ).all()
    )
    return rows.map((row) => ({
      id: String(row.id ?? ''),
      query: String(row.query ?? ''),
      answer: String(row.answer ?? ''),
      sources: parseJson<unknown[]>(row.sources_json, []),
      localSources: parseJson<unknown[] | undefined>(row.local_sources_json, undefined),
      researchPlan: parseJson<string[] | undefined>(row.research_plan_json, undefined),
      mode: row.mode === 'search' || row.mode === 'research' ? row.mode : 'ai',
      createdAt: Number(row.created_at ?? 0),
    }))
  }

  async function upsertCollection(item: PersistedCollection): Promise<void> {
    const db = await getDatabase()
    prepare(
      db,
      `INSERT INTO collections
        (id, query, answer, sources_json, local_sources_json, research_plan_json, mode, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         query = excluded.query,
         answer = excluded.answer,
         sources_json = excluded.sources_json,
         local_sources_json = excluded.local_sources_json,
         research_plan_json = excluded.research_plan_json,
         mode = excluded.mode,
         created_at = excluded.created_at`
    ).run(
      item.id,
      item.query,
      item.answer,
      JSON.stringify(item.sources),
      item.localSources ? JSON.stringify(item.localSources) : null,
      item.researchPlan ? JSON.stringify(item.researchPlan) : null,
      item.mode,
      item.createdAt
    )
  }

  async function deleteCollection(id: string): Promise<void> {
    const db = await getDatabase()
    prepare(db, 'DELETE FROM collections WHERE id = ?').run(id)
  }

  async function clearCollections(): Promise<void> {
    const db = await getDatabase()
    db.exec('DELETE FROM collections;')
  }

  function readSharedSessionRecord(db: SqliteDatabase): SharedSessionRecord {
    const row = prepare(
      db,
      "SELECT data_json, updated_at, revision, deleted FROM shared_sessions WHERE id = 'shared'"
    ).get() as Row | undefined
    if (!row) return { session: null, revision: 0, updatedAt: null, deleted: false }
    const deleted = Number(row.deleted ?? 0) === 1
    const session = deleted ? null : parseJson<SharedSession | null>(row.data_json, null)
    return {
      session,
      revision: Number(row.revision ?? 0),
      updatedAt: nullableNumber(row.updated_at),
      deleted: deleted || session == null,
    }
  }

  async function getSharedSessionRecord(): Promise<SharedSessionRecord> {
    return readSharedSessionRecord(await getDatabase())
  }

  async function getSharedSession(): Promise<SharedSession | null> {
    return (await getSharedSessionRecord()).session
  }

  async function mutateSharedSession(
    session: SharedSession | null,
    expectedRevision?: number
  ): Promise<SharedSessionMutationResult> {
    const db = await getDatabase()
    db.exec('BEGIN IMMEDIATE;')
    try {
      const current = readSharedSessionRecord(db)
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        db.exec('COMMIT;')
        return { ok: false, conflict: true, record: current }
      }
      const timestamp = now()
      const nextRevision = current.revision + 1
      prepare(
        db,
        `INSERT INTO shared_sessions (id, data_json, updated_at, revision, deleted)
         VALUES ('shared', ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           data_json = excluded.data_json,
           updated_at = excluded.updated_at,
           revision = excluded.revision,
           deleted = excluded.deleted`
      ).run(JSON.stringify(session), timestamp, nextRevision, session == null ? 1 : 0)
      const record = readSharedSessionRecord(db)
      db.exec('COMMIT;')
      return { ok: true, record }
    } catch (error) {
      db.exec('ROLLBACK;')
      throw error
    }
  }

  async function compareAndSwapSharedSession(
    session: SharedSession | null,
    expectedRevision: number
  ): Promise<SharedSessionMutationResult> {
    return mutateSharedSession(session, Math.max(0, Math.trunc(expectedRevision)))
  }

  async function saveSharedSessionIfRevision(
    session: SharedSession,
    expectedRevision: number
  ): Promise<SharedSessionMutationResult> {
    return compareAndSwapSharedSession(session, expectedRevision)
  }

  async function clearSharedSessionIfRevision(
    expectedRevision: number
  ): Promise<SharedSessionMutationResult> {
    return compareAndSwapSharedSession(null, expectedRevision)
  }

  async function saveSharedSession(session: SharedSession): Promise<void> {
    await mutateSharedSession(session)
  }

  async function clearSharedSession(): Promise<void> {
    await mutateSharedSession(null)
  }

  async function beginQueryRecord(input: BeginQueryRecordInput): Promise<QueryRecord> {
    const db = await getDatabase()
    const requestId = input.requestId?.trim() || crypto.randomUUID()
    const startedAt = input.startedAt ?? now()
    prepare(
      db,
      `INSERT INTO query_records
        (request_id, endpoint, query, mode, focus, requested_model,
         source_pack_json, citation_ids_json, outcome, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 'running', ?, ?)`
    ).run(
      requestId,
      input.endpoint?.trim() || `/api/${input.mode}`,
      input.query,
      input.mode,
      input.focus ?? 'all',
      input.requestedModel ?? null,
      JSON.stringify(DEFAULT_SOURCE_PACK),
      startedAt,
      startedAt
    )
    const record = await getQueryRecord(requestId)
    if (!record) throw new Error('Failed to create query record')
    return record
  }

  async function getQueryRecord(requestId: string): Promise<QueryRecord | null> {
    const db = await getDatabase()
    const row = prepare(db, 'SELECT * FROM query_records WHERE request_id = ?').get(requestId) as Row | undefined
    return row ? mapQueryRecord(row) : null
  }

  async function completeQueryRecord(
    requestId: string,
    input: CompleteQueryRecordInput
  ): Promise<QueryRecord | null> {
    const db = await getDatabase()
    const existingRow = prepare(db, 'SELECT * FROM query_records WHERE request_id = ?').get(requestId) as Row | undefined
    if (!existingRow) return null
    const existing = mapQueryRecord(existingRow)
    const completedAt = input.completedAt ?? now()
    const metrics = input.metrics === undefined || input.metrics === null
      ? existing.metrics
      : { ...existing.metrics, ...input.metrics }
    const timings = input.timings === undefined || input.timings === null
      ? existing.timings
      : { ...existing.timings, ...input.timings }
    const sourcePack = input.sourcePack ?? existing.sourcePack
    const citationIds = input.citationIds ?? existing.citationIds
    const grounding = Object.prototype.hasOwnProperty.call(input, 'grounding')
      ? input.grounding ?? null
      : existing.grounding
    const retrievalDiagnostics = Object.prototype.hasOwnProperty.call(input, 'retrievalDiagnostics')
      ? input.retrievalDiagnostics ?? null
      : existing.retrievalDiagnostics

    prepare(
      db,
      `UPDATE query_records SET
         actual_model = ?, answer_text = ?, source_pack_json = ?, citation_ids_json = ?,
         grounding_json = ?, execution_trace_json = ?, prompt_tokens = ?, output_tokens = ?, total_tokens = ?,
         token_counts_estimated = ?, generation_ms = ?, time_to_first_token_ms = ?,
         tokens_per_second = ?, end_to_end_ms = ?, source_count = ?,
         candidate_source_count = ?, retrieval_diagnostics_json = ?, degraded = ?, outcome = ?, error = ?,
         completed_at = ?, updated_at = ?
       WHERE request_id = ?`
    ).run(
      input.actualModel === undefined ? existing.actualModel : input.actualModel,
      input.answerText ?? existing.answerText,
      JSON.stringify(sourcePack),
      JSON.stringify(citationIds),
      grounding == null ? null : JSON.stringify(grounding),
      JSON.stringify(input.executionTrace ?? existing.executionTrace),
      metrics.promptTokens ?? null,
      metrics.outputTokens ?? null,
      metrics.totalTokens ?? null,
      metrics.tokenCountsEstimated == null ? null : metrics.tokenCountsEstimated ? 1 : 0,
      timings.generationMs ?? null,
      timings.timeToFirstTokenMs ?? null,
      timings.tokensPerSecond ?? null,
      timings.endToEndMs ?? Math.max(0, completedAt - existing.startedAt),
      input.sourceCount ?? existing.sourceCount,
      input.candidateSourceCount === undefined
        ? existing.candidateSourceCount
        : input.candidateSourceCount,
      retrievalDiagnostics == null ? null : JSON.stringify(retrievalDiagnostics),
      input.degraded === undefined ? (existing.degraded ? 1 : 0) : input.degraded ? 1 : 0,
      input.outcome,
      input.error === undefined ? existing.error : input.error,
      completedAt,
      completedAt,
      requestId
    )
    return getQueryRecord(requestId)
  }

  async function listQueryRecords(
    optionsOrLimit: QueryRecordListOptions | number = {}
  ): Promise<QueryRecordSummary[]> {
    const db = await getDatabase()
    const options = typeof optionsOrLimit === 'number' ? { limit: optionsOrLimit } : optionsOrLimit
    const limit = Math.min(200, Math.max(1, Math.trunc(options.limit ?? 50)))
    const conditions: string[] = []
    const values: SqlValue[] = []
    if (options.before != null && Number.isFinite(options.before)) {
      conditions.push('started_at < ?')
      values.push(Math.trunc(options.before))
    }
    if (options.mode) {
      conditions.push('mode = ?')
      values.push(options.mode)
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = asRows(
      prepare(
        db,
        `SELECT request_id, endpoint, query, mode, focus, requested_model, actual_model,
                prompt_tokens, output_tokens, total_tokens, token_counts_estimated,
                generation_ms, time_to_first_token_ms, tokens_per_second, end_to_end_ms,
                source_count, candidate_source_count, retrieval_diagnostics_json,
                execution_trace_json, degraded, outcome, error,
                started_at, completed_at, updated_at,
                '' AS answer_text, '{"web":[],"local":[]}' AS source_pack_json,
                '[]' AS citation_ids_json, NULL AS grounding_json
         FROM query_records ${where} ORDER BY started_at DESC LIMIT ?`
      )
        .all(...values, limit)
    )
    return rows.map((row) => toQuerySummary(mapQueryRecord(row)))
  }

  async function clearQueryRecords(): Promise<void> {
    const db = await getDatabase()
    db.exec('DELETE FROM query_records;')
  }

  async function upsertBrowserHistory(entries: BrowserHistoryEntry[]): Promise<{ imported: number; total: number }> {
    const db = await getDatabase()
    const timestamp = now()
    const upsert = prepare(
      db,
      `INSERT INTO browser_history
        (source_key, browser, profile, url, title, visit_count, typed_count, last_visited_at, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_key) DO UPDATE SET
         browser = excluded.browser,
         profile = excluded.profile,
         url = excluded.url,
         title = excluded.title,
         visit_count = excluded.visit_count,
         typed_count = excluded.typed_count,
         last_visited_at = excluded.last_visited_at,
         imported_at = excluded.imported_at`
    )
    let imported = 0
    db.exec('BEGIN IMMEDIATE;')
    try {
      for (const entry of entries) {
        const url = entry.url.trim()
        if (!url || !/^https?:\/\//i.test(url)) continue
        upsert.run(
          entry.sourceKey.slice(0, 5000),
          entry.browser.slice(0, 60),
          entry.profile.slice(0, 160),
          url.slice(0, 5000),
          (entry.title.trim() || url).slice(0, 1000),
          Math.max(0, Math.trunc(entry.visitCount)),
          Math.max(0, Math.trunc(entry.typedCount)),
          Math.max(0, Math.trunc(entry.lastVisitedAt)),
          timestamp
        )
        imported += 1
      }
      db.exec('COMMIT;')
    } catch (error) {
      db.exec('ROLLBACK;')
      throw error
    }
    const totalRow = prepare(db, 'SELECT COUNT(*) AS count FROM browser_history').get() as Row | undefined
    return { imported, total: Number(totalRow?.count ?? 0) }
  }

  async function searchBrowserHistory(query: string, limit = 10): Promise<BrowserHistorySearchResult[]> {
    const db = await getDatabase()
    const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)))
    const terms = Array.from(
      new Set(Array.from(query.toLowerCase().matchAll(/[\p{L}\p{N}_-]+/gu), (match) => match[0]))
    ).filter((term) => term.length >= 2)
    if (terms.length === 0) return []
    // A bare prefix term for a function word ("or", "in", "to") OR-matches
    // nearly every row and swamps the selective terms. tokenizeQuery carries the
    // shared stopword policy; it only reads ASCII, so other scripts are kept.
    const selective = terms.filter((term) => !/^[a-z0-9_]+$/.test(term) || tokenizeQuery(term).length > 0)
    // A query made entirely of function words still searches for what it has.
    const searchTerms = (selective.length > 0 ? selective : terms).slice(0, 12)
    const ftsQuery = searchTerms.map((term) => `"${term.replace(/"/g, '""')}"*`).join(' OR ')
    const rows = asRows(
      prepare(
        db,
        `SELECT b.source_key, b.browser, b.profile, b.url, b.title,
                b.visit_count, b.typed_count, b.last_visited_at,
                bm25(browser_history_fts, 8.0, 2.0) AS lexical_rank
         FROM browser_history_fts
         JOIN browser_history b ON b.id = browser_history_fts.rowid
         WHERE browser_history_fts MATCH ?
         ORDER BY lexical_rank ASC, b.typed_count DESC, b.visit_count DESC, b.last_visited_at DESC
         LIMIT ?`
      ).all(ftsQuery, Math.min(500, safeLimit * 8))
    )

    const byUrl = new Map<string, BrowserHistorySearchResult>()
    for (const row of rows) {
      const url = String(row.url ?? '')
      // FTS5 bm25 is negative and more negative means a better match. Map its
      // magnitude onto an increasing 0..1 scale so the strongest lexical match
      // contributes most while staying commensurate with the signals below.
      const lexicalStrength = Math.max(0, -Number(row.lexical_rank ?? 0))
      const lexical = lexicalStrength / (1 + lexicalStrength)
      const lastVisitedAt = Number(row.last_visited_at ?? 0)
      const ageDays = Math.max(0, (now() - lastVisitedAt) / 86_400_000)
      const freshness = Math.exp(-Math.LN2 * ageDays / 365)
      const popularity = Math.min(1, Math.log1p(Number(row.visit_count ?? 0)) / Math.log(50))
      const typed = Math.min(1, Math.log1p(Number(row.typed_count ?? 0)) / Math.log(12))
      const result: BrowserHistorySearchResult = {
        sourceKey: String(row.source_key ?? ''),
        browser: String(row.browser ?? ''),
        profile: String(row.profile ?? ''),
        url,
        title: String(row.title ?? url),
        visitCount: Number(row.visit_count ?? 0),
        typedCount: Number(row.typed_count ?? 0),
        lastVisitedAt,
        score: Number((lexical + freshness * 0.28 + popularity * 0.2 + typed * 0.14).toFixed(6)),
      }
      // Dedupe on the key the fusion layer uses, so http/https, www, trailing
      // slash and tracking-parameter spellings of one page cannot each take a
      // rank and stack their contributions. The winner keeps its display URL.
      const key = canonicalizeUrl(url)
      const existing = byUrl.get(key)
      if (!existing || result.score > existing.score) byUrl.set(key, result)
    }
    return Array.from(byUrl.values())
      .sort((a, b) => b.score - a.score || b.lastVisitedAt - a.lastVisitedAt || a.url.localeCompare(b.url))
      .slice(0, safeLimit)
  }

  async function getBrowserHistoryStatus(): Promise<{
    indexed: boolean
    entryCount: number
    latestVisitedAt: number | null
    lastImportedAt: number | null
    sources: Array<{ browser: string; profile: string; entryCount: number; lastImportedAt: number }>
  }> {
    const db = await getDatabase()
    const aggregate = prepare(
      db,
      `SELECT COUNT(*) AS count, MAX(last_visited_at) AS latest_visited_at,
              MAX(imported_at) AS last_imported_at FROM browser_history`
    ).get() as Row | undefined
    const sourceRows = asRows(prepare(
      db,
      `SELECT browser, profile, COUNT(*) AS count, MAX(imported_at) AS last_imported_at
       FROM browser_history GROUP BY browser, profile ORDER BY browser, profile`
    ).all())
    const entryCount = Number(aggregate?.count ?? 0)
    return {
      indexed: entryCount > 0,
      entryCount,
      latestVisitedAt: nullableNumber(aggregate?.latest_visited_at),
      lastImportedAt: nullableNumber(aggregate?.last_imported_at),
      sources: sourceRows.map((row) => ({
        browser: String(row.browser ?? ''),
        profile: String(row.profile ?? ''),
        entryCount: Number(row.count ?? 0),
        lastImportedAt: Number(row.last_imported_at ?? 0),
      })),
    }
  }

  async function clearBrowserHistory(): Promise<void> {
    const db = await getDatabase()
    db.exec('DELETE FROM browser_history;')
  }

  async function recordTelemetry(event: TelemetryEvent): Promise<void> {
    const db = await getDatabase()
    prepare(
      db,
      `INSERT INTO search_telemetry
        (kind, request_id, query, focus, result_count, source_count, latency_ms,
         success, error, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      event.kind,
      event.requestId ?? null,
      event.query,
      event.focus ?? null,
      event.resultCount ?? 0,
      event.sourceCount ?? 0,
      Math.max(0, Math.trunc(event.latencyMs)),
      event.success ? 1 : 0,
      event.error ?? null,
      event.metadata ? JSON.stringify(event.metadata) : null,
      now()
    )
  }

  async function clearTelemetry(): Promise<void> {
    const db = await getDatabase()
    db.exec('DELETE FROM search_telemetry;')
  }

  async function getTelemetrySummary(): Promise<{
    totalRequests: number
    successfulRequests: number
    averageLatencyMs: number
    latestAt: number | null
    byKind: Array<{ kind: string; count: number; averageLatencyMs: number }>
  }> {
    const db = await getDatabase()
    const aggregate = prepare(
      db,
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(success), 0) AS successful,
              COALESCE(AVG(latency_ms), 0) AS average_latency,
              MAX(created_at) AS latest_at
       FROM search_telemetry`
    ).get() as Row | undefined
    const byKindRows = asRows(
      prepare(
        db,
        `SELECT kind, COUNT(*) AS count, COALESCE(AVG(latency_ms), 0) AS average_latency
         FROM search_telemetry GROUP BY kind ORDER BY count DESC`
      ).all()
    )
    return {
      totalRequests: Number(aggregate?.total ?? 0),
      successfulRequests: Number(aggregate?.successful ?? 0),
      averageLatencyMs: Math.round(Number(aggregate?.average_latency ?? 0)),
      latestAt: aggregate?.latest_at == null ? null : Number(aggregate.latest_at),
      byKind: byKindRows.map((row) => ({
        kind: String(row.kind ?? ''),
        count: Number(row.count ?? 0),
        averageLatencyMs: Math.round(Number(row.average_latency ?? 0)),
      })),
    }
  }

  function deleteTelemetryRows(db: SqliteDatabase): number {
    let deleted = 0
    let remainingBudget = retention.maxDeleteRowsPerTable
    if (retention.telemetryMaxAgeMs !== null && remainingBudget > 0) {
      const cutoff = now() - retention.telemetryMaxAgeMs
      deleted += changedRows(prepare(
        db,
        `DELETE FROM search_telemetry WHERE id IN (
           SELECT id FROM search_telemetry WHERE created_at < ? ORDER BY id ASC LIMIT ?
         )`
      ).run(cutoff, remainingBudget))
      remainingBudget = Math.max(0, remainingBudget - deleted)
    }
    if (remainingBudget > 0) {
      const countRow = prepare(db, 'SELECT COUNT(*) AS count FROM search_telemetry').get() as Row | undefined
      const excess = Math.max(0, Number(countRow?.count ?? 0) - retention.telemetryMaxRows)
      const toDelete = Math.min(excess, remainingBudget)
      if (toDelete > 0) {
        deleted += changedRows(prepare(
          db,
          `DELETE FROM search_telemetry WHERE id IN (
             SELECT id FROM search_telemetry ORDER BY id ASC LIMIT ?
           )`
        ).run(toDelete))
      }
    }
    return deleted
  }

  function deleteQueryRows(db: SqliteDatabase): number {
    let deleted = 0
    let remainingBudget = retention.maxDeleteRowsPerTable
    if (retention.queryRecordMaxAgeMs !== null && remainingBudget > 0) {
      const cutoff = now() - retention.queryRecordMaxAgeMs
      deleted += changedRows(prepare(
        db,
        `DELETE FROM query_records WHERE request_id IN (
           SELECT request_id FROM query_records
           WHERE outcome <> 'running' AND COALESCE(completed_at, started_at) < ?
           ORDER BY started_at ASC LIMIT ?
         )`
      ).run(cutoff, remainingBudget))
      remainingBudget = Math.max(0, remainingBudget - deleted)
    }
    if (remainingBudget > 0) {
      const countRow = prepare(
        db,
        "SELECT COUNT(*) AS count FROM query_records WHERE outcome <> 'running'"
      ).get() as Row | undefined
      const excess = Math.max(0, Number(countRow?.count ?? 0) - retention.queryRecordMaxRows)
      const toDelete = Math.min(excess, remainingBudget)
      if (toDelete > 0) {
        deleted += changedRows(prepare(
          db,
          `DELETE FROM query_records WHERE request_id IN (
             SELECT request_id FROM query_records WHERE outcome <> 'running'
             ORDER BY started_at ASC LIMIT ?
           )`
        ).run(toDelete))
      }
    }
    return deleted
  }

  function deleteHistoryRows(db: SqliteDatabase): number {
    const countRow = prepare(db, 'SELECT COUNT(*) AS count FROM search_history').get() as Row | undefined
    const excess = Math.max(0, Number(countRow?.count ?? 0) - retention.searchHistoryMaxRows)
    const toDelete = Math.min(excess, retention.maxDeleteRowsPerTable)
    if (toDelete === 0) return 0
    return changedRows(prepare(
      db,
      `DELETE FROM search_history WHERE query IN (
         SELECT query FROM search_history
         ORDER BY hit_count ASC, created_at ASC LIMIT ?
       )`
    ).run(toDelete))
  }

  async function pingDatabase(): Promise<boolean> {
    try {
      const db = await getDatabase()
      prepare(db, 'SELECT 1 AS ok').get()
      diagnostics = { ...diagnostics, reachable: true, lastPingAt: now() }
      return true
    } catch {
      diagnostics = { ...diagnostics, reachable: false, lastPingAt: now() }
      return false
    }
  }

  function cloneDiagnostics(): DatabaseDiagnostics {
    return {
      ...diagnostics,
      integrity: { ...diagnostics.integrity, messages: [...diagnostics.integrity.messages] },
      checkpoint: diagnostics.checkpoint ? { ...diagnostics.checkpoint } : null,
      maintenance: { ...diagnostics.maintenance },
    }
  }

  async function getDatabaseDiagnostics(): Promise<DatabaseDiagnostics> {
    await getDatabase()
    return cloneDiagnostics()
  }

  async function runDatabaseMaintenance(
    maintenanceOptions: DatabaseMaintenanceOptions = {}
  ): Promise<DatabaseDiagnostics> {
    const db = await getDatabase()
    let deletedTelemetryRows = 0
    let deletedQueryRows = 0
    let deletedHistoryRows = 0

    db.exec('BEGIN IMMEDIATE;')
    try {
      deletedTelemetryRows = deleteTelemetryRows(db)
      deletedQueryRows = deleteQueryRows(db)
      deletedHistoryRows = deleteHistoryRows(db)
      db.exec('COMMIT;')
    } catch (error) {
      db.exec('ROLLBACK;')
      throw error
    }

    const shouldOptimize = maintenanceOptions.optimize ?? true
    if (shouldOptimize) db.exec('PRAGMA optimize;')

    const checkpointMode = maintenanceOptions.checkpointMode ?? 'PASSIVE'
    const checkpointRow = prepare(db, `PRAGMA wal_checkpoint(${checkpointMode})`).get() as Row | undefined
    diagnostics.checkpoint = {
      mode: checkpointMode,
      busy: Number(checkpointRow?.busy ?? 0),
      logFrames: Number(checkpointRow?.log ?? 0),
      checkpointedFrames: Number(checkpointRow?.checkpointed ?? 0),
      checkedAt: now(),
    }

    const integrityCheck = maintenanceOptions.integrityCheck ?? 'quick'
    if (integrityCheck !== 'none') diagnostics.integrity = runIntegrityCheckRaw(db, integrityCheck)

    diagnostics.maintenance = {
      lastRunAt: now(),
      lastOptimizeAt: shouldOptimize ? now() : diagnostics.maintenance.lastOptimizeAt,
      deletedTelemetryRows,
      deletedQueryRows,
      deletedHistoryRows,
    }
    diagnostics.lastPingAt = now()
    diagnostics.reachable = true
    refreshPragmaDiagnostics(db)
    return cloneDiagnostics()
  }

  return {
    path,
    close,
    loadKnowledgeSnapshot,
    replaceKnowledgeSnapshot,
    clearKnowledgeSnapshot,
    listSearchHistory,
    upsertSearchHistory,
    deleteSearchHistory,
    clearSearchHistory,
    listCollections,
    upsertCollection,
    deleteCollection,
    clearCollections,
    getSharedSession,
    getSharedSessionRecord,
    compareAndSwapSharedSession,
    saveSharedSessionIfRevision,
    clearSharedSessionIfRevision,
    saveSharedSession,
    clearSharedSession,
    beginQueryRecord,
    completeQueryRecord,
    getQueryRecord,
    listQueryRecords,
    clearQueryRecords,
    upsertBrowserHistory,
    searchBrowserHistory,
    getBrowserHistoryStatus,
    clearBrowserHistory,
    recordTelemetry,
    clearTelemetry,
    getTelemetrySummary,
    pingDatabase,
    getDatabaseDiagnostics,
    runDatabaseMaintenance,
  }
}

export type DatabaseService = ReturnType<typeof createDatabaseService>

const defaultDatabaseService = createDatabaseService({ path: DEFAULT_DATABASE_PATH })

export const loadKnowledgeSnapshot = defaultDatabaseService.loadKnowledgeSnapshot
export const replaceKnowledgeSnapshot = defaultDatabaseService.replaceKnowledgeSnapshot
export const clearKnowledgeSnapshot = defaultDatabaseService.clearKnowledgeSnapshot
export const listSearchHistory = defaultDatabaseService.listSearchHistory
export const upsertSearchHistory = defaultDatabaseService.upsertSearchHistory
export const deleteSearchHistory = defaultDatabaseService.deleteSearchHistory
export const clearSearchHistory = defaultDatabaseService.clearSearchHistory
export const listCollections = defaultDatabaseService.listCollections
export const upsertCollection = defaultDatabaseService.upsertCollection
export const deleteCollection = defaultDatabaseService.deleteCollection
export const clearCollections = defaultDatabaseService.clearCollections
export const getSharedSession = defaultDatabaseService.getSharedSession
export const getSharedSessionRecord = defaultDatabaseService.getSharedSessionRecord
export const compareAndSwapSharedSession = defaultDatabaseService.compareAndSwapSharedSession
export const saveSharedSessionIfRevision = defaultDatabaseService.saveSharedSessionIfRevision
export const clearSharedSessionIfRevision = defaultDatabaseService.clearSharedSessionIfRevision
export const saveSharedSession = defaultDatabaseService.saveSharedSession
export const clearSharedSession = defaultDatabaseService.clearSharedSession
export const beginQueryRecord = defaultDatabaseService.beginQueryRecord
export const completeQueryRecord = defaultDatabaseService.completeQueryRecord
export const getQueryRecord = defaultDatabaseService.getQueryRecord
export const listQueryRecords = defaultDatabaseService.listQueryRecords
export const clearQueryRecords = defaultDatabaseService.clearQueryRecords
export const upsertBrowserHistory = defaultDatabaseService.upsertBrowserHistory
export const searchBrowserHistory = defaultDatabaseService.searchBrowserHistory
export const getBrowserHistoryStatus = defaultDatabaseService.getBrowserHistoryStatus
export const clearBrowserHistory = defaultDatabaseService.clearBrowserHistory
export const recordTelemetry = defaultDatabaseService.recordTelemetry
export const clearTelemetry = defaultDatabaseService.clearTelemetry
export const getTelemetrySummary = defaultDatabaseService.getTelemetrySummary
export const pingDatabase = defaultDatabaseService.pingDatabase
export const getDatabaseDiagnostics = defaultDatabaseService.getDatabaseDiagnostics
export const runDatabaseMaintenance = defaultDatabaseService.runDatabaseMaintenance

export const databasePath = DEFAULT_DATABASE_PATH
