import { afterEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LATEST_SCHEMA_VERSION,
  createDatabaseService,
  resolveDatabasePath,
  type DatabaseService,
  type SharedSession,
} from './database'

const services: DatabaseService[] = []
const temporaryDirectories: string[] = []

async function temporaryDatabasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'keepindex-database-test-'))
  temporaryDirectories.push(directory)
  return join(directory, 'keepindex.sqlite')
}

function track(service: DatabaseService): DatabaseService {
  services.push(service)
  return service
}

const session: SharedSession = {
  lastQuery: 'sqlite wal',
  lastMode: 'ai',
  lastFocusMode: 'all',
  lastAnswer: 'A grounded answer.',
  lastSources: [{ title: 'SQLite', url: 'https://sqlite.org/wal.html' }],
  lastLocalSources: [],
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close().catch(() => undefined)))
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

describe('default database path contract', () => {
  const projectRoot = '/opt/keepindex'
  const currentPath = join(projectRoot, 'server', 'keepindex.sqlite')

  it('uses the canonical configured path', () => {
    expect(resolveDatabasePath({
      projectRoot,
      environment: { KEEPINDEX_DB_PATH: '/data/keepindex.sqlite' },
    })).toBe('/data/keepindex.sqlite')
  })

  it('trims the canonical configured path', () => {
    expect(resolveDatabasePath({
      projectRoot,
      environment: { KEEPINDEX_DB_PATH: '  /data/keepindex.sqlite  ' },
    })).toBe('/data/keepindex.sqlite')
  })

  it('ignores unrelated database variables', () => {
    expect(resolveDatabasePath({
      projectRoot,
      environment: { APP_DB_PATH: '/data/app.sqlite' },
    })).toBe(currentPath)
  })

  it('reuses the canonical filename when the database already exists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'keepindex-path-test-'))
    temporaryDirectories.push(directory)
    await mkdir(join(directory, 'server'))
    const path = join(directory, 'server', 'keepindex.sqlite')
    const database = new Database(path, { create: true })
    database.close()

    expect(resolveDatabasePath({ projectRoot: directory, environment: {} })).toBe(path)
  })
})

describe('database schema migrations', () => {
  it('creates the latest version with WAL controls and a cached integrity result', async () => {
    const path = await temporaryDatabasePath()
    const service = track(createDatabaseService({
      path,
      walAutoCheckpointPages: 32,
      journalSizeLimitBytes: 2 * 1024 * 1024,
    }))

    const diagnostics = await service.getDatabaseDiagnostics()

    expect(diagnostics.schemaVersion).toBe(LATEST_SCHEMA_VERSION)
    expect(diagnostics.expectedSchemaVersion).toBe(LATEST_SCHEMA_VERSION)
    expect(diagnostics.journalMode).toBe('wal')
    expect(diagnostics.walAutoCheckpointPages).toBe(32)
    expect(diagnostics.journalSizeLimitBytes).toBe(2 * 1024 * 1024)
    expect(diagnostics.integrity.status).toBe('ok')
    expect(diagnostics.integrity.messages).toEqual(['ok'])
  })

  it('adopts a pre-versioned schema without losing rows', async () => {
    const path = await temporaryDatabasePath()
    const preVersioned = new Database(path, { create: true })
    preVersioned.exec(`
      CREATE TABLE search_history (
        query TEXT PRIMARY KEY COLLATE NOCASE,
        mode TEXT NOT NULL,
        focus TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE shared_sessions (
        id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      PRAGMA user_version = 0;
    `)
    preVersioned.query(
      'INSERT INTO search_history (query, mode, focus, created_at) VALUES (?, ?, ?, ?)'
    ).run('pre-versioned query', 'ai', 'all', 123)
    preVersioned.query(
      "INSERT INTO shared_sessions (id, data_json, updated_at) VALUES ('shared', ?, ?)"
    ).run(JSON.stringify(session), 456)
    preVersioned.close()

    const service = track(createDatabaseService({ path }))
    const diagnostics = await service.getDatabaseDiagnostics()
    const history = await service.listSearchHistory()
    const storedSession = await service.getSharedSessionRecord()

    expect(diagnostics.schemaVersion).toBe(LATEST_SCHEMA_VERSION)
    expect(history).toEqual([{
      query: 'pre-versioned query',
      mode: 'ai',
      focus: 'all',
      createdAt: 123,
      hitCount: 1,
    }])
    expect(storedSession).toEqual({
      session,
      revision: 1,
      updatedAt: 456,
      deleted: false,
    })

    const queryRecord = await service.beginQueryRecord({
      requestId: 'post-migration',
      endpoint: '/api/ask',
      query: 'migration check',
      mode: 'ai',
    })
    expect(queryRecord.outcome).toBe('running')
  })

  it('rolls back the version and migration changes when a pre-versioned table is incompatible', async () => {
    const path = await temporaryDatabasePath()
    const malformed = new Database(path, { create: true })
    malformed.exec(`
      CREATE TABLE search_history (
        query TEXT PRIMARY KEY COLLATE NOCASE,
        mode TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      INSERT INTO search_history (query, mode, created_at) VALUES ('keep me', 'ai', 99);
      PRAGMA user_version = 0;
    `)
    malformed.close()

    const service = track(createDatabaseService({ path }))
    await expect(service.getDatabaseDiagnostics()).rejects.toThrow('search_history.focus is missing')

    const reopened = new Database(path)
    const version = reopened.query('PRAGMA user_version').get() as { user_version: number }
    const columns = reopened.query('PRAGMA table_info(search_history)').all() as Array<{ name: string }>
    const row = reopened.query('SELECT query, mode, created_at FROM search_history').get()
    reopened.close()

    expect(version.user_version).toBe(0)
    expect(columns.map((column) => column.name)).not.toContain('hit_count')
    expect(row).toEqual({ query: 'keep me', mode: 'ai', created_at: 99 })
  })
})

describe('query records', () => {
  it('round-trips the answer, exact evidence pack, citations, assessment, metrics, and model', async () => {
    const path = await temporaryDatabasePath()
    let clock = 1_000
    const service = track(createDatabaseService({ path, now: () => clock }))

    await service.beginQueryRecord({
      requestId: 'request-1',
      endpoint: '/api/ask',
      query: 'How does WAL work?',
      mode: 'ai',
      focus: 'all',
      requestedModel: 'requested-model',
    })
    clock = 1_125
    await service.completeQueryRecord('request-1', {
      outcome: 'succeeded',
      actualModel: 'fallback-model',
      answerText: 'WAL appends changes before checkpointing [1].',
      executionTrace: [{
        name: 'local_retrieval',
        startedOffsetMs: 20,
        durationMs: 30,
        status: 'ok',
        detail: { candidates: 2 },
      }],
      sourcePack: {
        web: [{ title: 'Write-Ahead Logging', url: 'https://sqlite.org/wal.html', snippet: 'WAL.' }],
        local: [{ filePath: '/vault/sqlite.md', content: 'Checkpoint notes.', startLine: 4, endLine: 8 }],
      },
      citationIds: ['1'],
      grounding: { status: 'strong', score: 100, citationCoveragePct: 100 },
      metrics: {
        promptTokens: 20,
        outputTokens: 10,
        totalTokens: 30,
        tokenCountsEstimated: false,
      },
      timings: {
        generationMs: 100,
        timeToFirstTokenMs: 12,
        tokensPerSecond: 100,
        endToEndMs: 125,
      },
      retrievalDiagnostics: {
        strategy: 'weighted-rrf-v1',
        web: {
          provider: 'searxng',
          state: 'partial',
          attempted: true,
          rawCandidateCount: 7,
          usableCandidateCount: 5,
          selectedCount: 1,
          latencyMs: 23,
          detail: 'One engine timed out',
        },
        local: {
          provider: 'vault-bm25',
          state: 'ok',
          attempted: true,
          rawCandidateCount: 2,
          usableCandidateCount: 2,
          selectedCount: 1,
          latencyMs: 4,
          detail: null,
        },
        liveEngines: ['google'],
        failedEngines: [{ engine: 'mwmbl', reason: 'timeout' }],
        engineCoveragePct: 50,
        fallbackAttempted: false,
        fallbackReason: null,
      },
      sourceCount: 2,
      candidateSourceCount: 9,
      degraded: true,
    })

    const record = await service.getQueryRecord('request-1')
    expect(record).toMatchObject({
      requestId: 'request-1',
      endpoint: '/api/ask',
      requestedModel: 'requested-model',
      actualModel: 'fallback-model',
      answerText: 'WAL appends changes before checkpointing [1].',
      citationIds: ['1'],
      grounding: { status: 'strong', score: 100, citationCoveragePct: 100 },
      metrics: {
        promptTokens: 20,
        outputTokens: 10,
        totalTokens: 30,
        tokenCountsEstimated: false,
      },
      timings: {
        generationMs: 100,
        timeToFirstTokenMs: 12,
        tokensPerSecond: 100,
        endToEndMs: 125,
      },
      retrievalDiagnostics: {
        strategy: 'weighted-rrf-v1',
        web: {
          provider: 'searxng',
          state: 'partial',
          attempted: true,
          rawCandidateCount: 7,
          usableCandidateCount: 5,
          selectedCount: 1,
          latencyMs: 23,
          detail: 'One engine timed out',
        },
        local: {
          provider: 'vault-bm25',
          state: 'ok',
          attempted: true,
          rawCandidateCount: 2,
          usableCandidateCount: 2,
          selectedCount: 1,
          latencyMs: 4,
          detail: null,
        },
        liveEngines: ['google'],
        failedEngines: [{ engine: 'mwmbl', reason: 'timeout' }],
        engineCoveragePct: 50,
        fallbackAttempted: false,
        fallbackReason: null,
      },
      sourceCount: 2,
      candidateSourceCount: 9,
      degraded: true,
      outcome: 'succeeded',
      startedAt: 1_000,
      completedAt: 1_125,
    })
    expect(record?.sourcePack.web).toHaveLength(1)
    expect(record?.sourcePack.local).toHaveLength(1)
    expect(record?.executionTrace).toEqual([{
      name: 'local_retrieval',
      startedOffsetMs: 20,
      durationMs: 30,
      status: 'ok',
      detail: { candidates: 2 },
    }])

    const summaries = await service.listQueryRecords()
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).not.toHaveProperty('answerText')
    expect(summaries[0]).not.toHaveProperty('sourcePack')

    await service.close()
    services.splice(services.indexOf(service), 1)
    const reopened = track(createDatabaseService({ path, now: () => 2_000 }))
    expect((await reopened.getQueryRecord('request-1'))?.answerText)
      .toBe('WAL appends changes before checkpointing [1].')
  })

  it('marks a running record interrupted when a database is reopened', async () => {
    const path = await temporaryDatabasePath()
    const first = track(createDatabaseService({ path, now: () => 100 }))
    await first.beginQueryRecord({ requestId: 'orphan', query: 'unfinished', mode: 'research' })
    await first.close()
    services.splice(services.indexOf(first), 1)

    const reopened = track(createDatabaseService({ path, now: () => 200 }))
    const record = await reopened.getQueryRecord('orphan')

    expect(record?.outcome).toBe('interrupted')
    expect(record?.completedAt).toBe(200)
    expect(record?.error).toContain('restarted')
  })
})

describe('shared session revisions', () => {
  it('uses compare-and-swap revisions and keeps a monotonic tombstone', async () => {
    const path = await temporaryDatabasePath()
    let clock = 10
    const service = track(createDatabaseService({ path, now: () => ++clock }))

    expect(await service.getSharedSessionRecord()).toEqual({
      session: null,
      revision: 0,
      updatedAt: null,
      deleted: false,
    })

    const saved = await service.saveSharedSessionIfRevision(session, 0)
    expect(saved.ok).toBe(true)
    if (!saved.ok) throw new Error('expected session save to succeed')
    expect(saved.record.revision).toBe(1)

    const stale = await service.saveSharedSessionIfRevision({ ...session, lastQuery: 'stale' }, 0)
    expect(stale.ok).toBe(false)
    if (stale.ok) throw new Error('expected stale session save to conflict')
    expect(stale.record.session?.lastQuery).toBe('sqlite wal')

    const cleared = await service.clearSharedSessionIfRevision(1)
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) throw new Error('expected session clear to succeed')
    expect(cleared.record).toMatchObject({ session: null, revision: 2, deleted: true })
    expect(await service.getSharedSession()).toBeNull()

    const preDeleteRevision = await service.saveSharedSessionIfRevision(session, 1)
    expect(preDeleteRevision.ok).toBe(false)

    // The unconditional wrapper remains supported, but still advances
    // the revision so newer conditional clients cannot be silently clobbered.
    await service.saveSharedSession(session)
    expect((await service.getSharedSessionRecord()).revision).toBe(3)
  })
})

describe('bounded maintenance and diagnostics', () => {
  it('prunes only during explicit maintenance and preserves running records', async () => {
    const path = await temporaryDatabasePath()
    let clock = 1_000
    const service = track(createDatabaseService({
      path,
      now: () => ++clock,
      retention: {
        telemetryMaxRows: 2,
        telemetryMaxAgeMs: null,
        queryRecordMaxRows: 2,
        queryRecordMaxAgeMs: null,
        searchHistoryMaxRows: 2,
        maxDeleteRowsPerTable: 100,
      },
    }))

    for (let index = 0; index < 4; index += 1) {
      await service.recordTelemetry({
        kind: 'search',
        query: `telemetry-${index}`,
        latencyMs: index,
        success: true,
      })
      await service.beginQueryRecord({
        requestId: `query-${index}`,
        query: `query ${index}`,
        mode: 'search',
      })
      await service.completeQueryRecord(`query-${index}`, { outcome: 'succeeded' })
    }
    await service.beginQueryRecord({ requestId: 'still-running', query: 'active', mode: 'research' })

    await service.upsertSearchHistory('old-low', 'ai', 'all')
    await service.upsertSearchHistory('new-low', 'ai', 'all')
    await service.upsertSearchHistory('frequent', 'ai', 'all')
    await service.upsertSearchHistory('frequent', 'ai', 'all')

    // Inserts no longer execute retention deletes on their hot path.
    expect((await service.getTelemetrySummary()).totalRequests).toBe(4)
    expect(await service.listQueryRecords()).toHaveLength(5)
    expect(await service.listSearchHistory()).toHaveLength(3)

    const diagnostics = await service.runDatabaseMaintenance({
      integrityCheck: 'quick',
      checkpointMode: 'PASSIVE',
      optimize: false,
    })

    expect((await service.getTelemetrySummary()).totalRequests).toBe(2)
    expect(await service.getQueryRecord('query-0')).toBeNull()
    expect(await service.getQueryRecord('query-1')).toBeNull()
    expect((await service.getQueryRecord('still-running'))?.outcome).toBe('running')
    expect((await service.listQueryRecords()).map((record) => record.requestId).sort())
      .toEqual(['query-2', 'query-3', 'still-running'])
    expect((await service.listSearchHistory()).map((entry) => entry.query))
      .toEqual(['frequent', 'new-low'])

    expect(diagnostics.maintenance.deletedTelemetryRows).toBe(2)
    expect(diagnostics.maintenance.deletedQueryRows).toBe(2)
    expect(diagnostics.maintenance.deletedHistoryRows).toBe(1)
    expect(diagnostics.checkpoint).toMatchObject({ mode: 'PASSIVE', busy: 0 })
    expect(diagnostics.integrity.status).toBe('ok')
    expect(await service.pingDatabase()).toBe(true)
    expect((await service.getDatabaseDiagnostics()).lastPingAt).not.toBeNull()
  })
})
