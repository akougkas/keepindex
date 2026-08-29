import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBrowserHistorySource } from './browser-history'
import { createDatabaseService, type BrowserHistoryEntry, type DatabaseService } from './database'
import { canonicalizeUrl } from './retrieval'

const FROZEN_NOW = 1_767_225_600_000
const VISITED_AT = FROZEN_NOW - 5 * 86_400_000

const services: DatabaseService[] = []
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close().catch(() => undefined)))
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

function frozenService(): DatabaseService {
  const service = createDatabaseService({ path: ':memory:', now: () => FROZEN_NOW })
  services.push(service)
  return service
}

function visit(key: string, url: string, title: string): BrowserHistoryEntry {
  return {
    sourceKey: key,
    browser: 'chrome',
    profile: 'Default',
    url,
    title,
    visitCount: 4,
    typedCount: 1,
    lastVisitedAt: VISITED_AT,
  }
}

describe('browser history lexical ranking', () => {
  test('ranks the verbatim-title row first when every behavioural signal is identical', async () => {
    const service = frozenService()
    const rows = [
      visit('h-exact', 'https://notes.example.org/a', 'sqlite wal checkpoint tuning'),
      visit('h-espresso', 'https://notes.example.org/b', 'espresso grinder tuning for baristas'),
      visit('h-guitar', 'https://notes.example.org/c', 'guitar string tuning by ear'),
      visit('h-engine', 'https://notes.example.org/d', 'engine tuning on a mountain road'),
      visit('h-radio', 'https://notes.example.org/e', 'radio dial tuning in the desert'),
      visit('h-piano', 'https://notes.example.org/f', 'piano tuning fork history'),
    ]
    await service.upsertBrowserHistory(rows)

    for (const row of rows) {
      expect(row.visitCount).toBe(rows[0]!.visitCount)
      expect(row.typedCount).toBe(rows[0]!.typedCount)
      expect(row.lastVisitedAt).toBe(rows[0]!.lastVisitedAt)
    }

    const results = await service.searchBrowserHistory('sqlite wal checkpoint tuning', 6)

    expect(results).toHaveLength(6)
    expect(results[0]?.title).toBe('sqlite wal checkpoint tuning')
    expect(results[0]?.url).toBe('https://notes.example.org/a')
    const exact = results.find((result) => result.url === 'https://notes.example.org/a')
    const weakest = results.filter((result) => result.url !== 'https://notes.example.org/a')
    for (const other of weakest) {
      expect(exact!.score).toBeGreaterThan(other.score)
    }
  })

  test('does not let a flood of weak single-token rows truncate the strong multi-token matches', async () => {
    const service = frozenService()
    const strong = [
      visit('h-strong-1', 'https://notes.example.org/s1', 'sqlite wal checkpoint tuning'),
      visit('h-strong-2', 'https://notes.example.org/s2', 'checkpoint tuning for sqlite wal'),
      visit('h-strong-3', 'https://notes.example.org/s3', 'wal checkpoint tuning inside sqlite'),
    ]
    const weak: BrowserHistoryEntry[] = []
    for (let index = 0; index < 60; index += 1) {
      weak.push(
        visit(`h-weak-${index}`, `https://notes.example.org/w${index}`, `weekly tuning digest number ${index}`)
      )
    }
    await service.upsertBrowserHistory([...strong, ...weak])

    const results = await service.searchBrowserHistory('sqlite wal checkpoint tuning', 5)

    expect(results.length).toBeGreaterThanOrEqual(3)
    expect(results.slice(0, 3).map((result) => result.url).sort()).toEqual(
      strong.map((row) => row.url).sort()
    )
  })

  test('adding a common short word does not displace the precise query results', async () => {
    const service = frozenService()
    const relevant = [
      visit('h-k1', 'https://cluster.example.org/k1', 'kubernetes ingress controller rollout'),
      visit('h-k2', 'https://cluster.example.org/k2', 'debugging the kubernetes ingress controller'),
      visit('h-k3', 'https://cluster.example.org/k3', 'kubernetes ingress controller tls'),
    ]
    const filler = ['bread baking', 'tide tables', 'violin repair', 'paper airplanes', 'lunar phases']
    const noise: BrowserHistoryEntry[] = []
    for (let index = 0; index < 30; index += 1) {
      noise.push(
        visit(`h-noise-${index}`, `https://misc.example.org/f${index}`, `${filler[index % filler.length]} volume ${index}`)
      )
    }
    await service.upsertBrowserHistory([...relevant, ...noise])

    const precise = await service.searchBrowserHistory('kubernetes ingress controller', 5)
    expect(precise.map((result) => result.url).sort()).toEqual(relevant.map((row) => row.url).sort())

    const withStopword = await service.searchBrowserHistory('kubernetes ingress controller or the', 5)
    const returned = new Set(withStopword.map((result) => result.url))
    for (const result of precise) {
      expect(returned.has(result.url)).toBe(true)
    }
  })

  test('collapses canonical duplicate urls into a single ranked row', async () => {
    const service = frozenService()
    const urls = [
      'http://docs.example.org/guide/rrf',
      'https://docs.example.org/guide/rrf',
      'https://www.docs.example.org/guide/rrf',
      'https://docs.example.org/guide/rrf/',
      'https://docs.example.org/guide/rrf?utm_source=newsletter',
    ]
    expect(new Set(urls.map(canonicalizeUrl)).size).toBe(1)
    await service.upsertBrowserHistory(
      urls.map((url, index) => visit(`h-dupe-${index}`, url, 'reciprocal rank fusion guide'))
    )

    const results = await service.searchBrowserHistory('reciprocal rank fusion', 10)

    expect(results).toHaveLength(1)
    expect(canonicalizeUrl(results[0]!.url)).toBe('docs.example.org/guide/rrf')
  })
})

describe('browser history ranking guard rails', () => {
  test('never returns a row that matches none of the query terms', async () => {
    const service = frozenService()
    await service.upsertBrowserHistory([
      visit('h-match', 'https://notes.example.org/aa', 'sqlite wal checkpoint tuning'),
      visit('h-miss', 'https://notes.example.org/bb', 'espresso grinder maintenance'),
    ])

    const results = await service.searchBrowserHistory('sqlite wal checkpoint', 10)

    expect(results.map((result) => result.url)).toEqual(['https://notes.example.org/aa'])
  })

  test('breaks a lexical tie with typed count, visit count, and recency', async () => {
    const service = frozenService()
    await service.upsertBrowserHistory([
      {
        ...visit('h-cold', 'https://notes.example.org/aa', 'sqlite wal checkpoint tuning'),
        visitCount: 1,
        typedCount: 0,
        lastVisitedAt: FROZEN_NOW - 300 * 86_400_000,
      },
      {
        ...visit('h-hot', 'https://notes.example.org/bb', 'sqlite wal checkpoint tuning'),
        visitCount: 40,
        typedCount: 9,
        lastVisitedAt: FROZEN_NOW - 86_400_000,
      },
    ])

    const results = await service.searchBrowserHistory('sqlite wal checkpoint tuning', 10)

    expect(results).toHaveLength(2)
    expect(results[0]?.url).toBe('https://notes.example.org/bb')
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score)
  })
})

describe('browser history credential hygiene', () => {
  test('never imports usernames, passwords, or token-bearing query and fragment material', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'keepindex-history-credential-test-'))
    temporaryDirectories.push(directory)
    const historyPath = join(directory, 'History')
    const db = new Database(historyPath)
    db.exec(`
      CREATE TABLE urls (
        id INTEGER PRIMARY KEY,
        url TEXT,
        title TEXT,
        visit_count INTEGER,
        typed_count INTEGER,
        last_visit_time INTEGER
      );
    `)
    const chromeTime = (VISITED_AT + 11_644_473_600_000) * 1000
    const insert = db.prepare(
      'INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time) VALUES (?, ?, ?, ?, ?)'
    )
    const wrapRedirect = (value: string, level: number): string =>
      `https://hop-${level}.example.test/next?next=${encodeURIComponent(value)}`
    const nestedCredentialRedirect = [1, 2, 3, 4].reduce(
      (value, level) => wrapRedirect(value, level),
      'https://dest.example.test/cb?access_token=FAKE_FOUR_HOP_TOKEN'
    )
    const nestedBenignRedirect = [1, 2, 3, 4].reduce(
      (value, level) => wrapRedirect(value, level),
      'https://docs.example.test/handbook?section=security'
    )
    const nestedCredentialHistoryUrl = `https://app.example.test/p?next=${encodeURIComponent(nestedCredentialRedirect)}`
    const nestedBenignHistoryUrl = `https://docs.example.test/nested?next=${encodeURIComponent(nestedBenignRedirect)}`
    insert.run('https://user:FAKEPASS_xyz789@intranet.example.test/runbook', 'Intranet runbook', 5, 1, chromeTime)
    insert.run('https://app.example.test/cb#access_token=FAKE_TOKEN_abc123', 'Callback', 4, 1, chromeTime)
    insert.run('https://app.example.test/x?token=FAKE_TOKEN_abc123', 'Report export', 3, 1, chromeTime)
    insert.run('https://app.example.test/a?accessToken=FAKE_ACCESS_CAMEL', 'Access callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/b?refreshToken=FAKE_REFRESH_CAMEL', 'Refresh callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/c?clientSecret=FAKE_CLIENT_CAMEL', 'Client callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/d?sessionId=FAKE_SESSION_CAMEL', 'Session callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/e#authCode=FAKE_AUTH_CAMEL', 'Authorization callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/f?ACCESSTOKEN=FAKE_ACCESS_COLLAPSED', 'Collapsed token', 3, 1, chromeTime)
    insert.run('https://app.example.test/g?token2=FAKE_NUMBERED_TOKEN', 'Numbered token', 3, 1, chromeTime)
    insert.run('https://app.example.test/h#accessToken%3DFAKE_ENCODED_FRAGMENT', 'Encoded callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/i?access%2554oken=FAKE_DOUBLE_ENCODED_KEY', 'Encoded key', 3, 1, chromeTime)
    insert.run('https://app.example.test/j?SAMLResponse=FAKE_SAML_ASSERTION', 'SSO callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/k?ticket=FAKE_CAS_TICKET', 'CAS callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/l?oobCode=FAKE_FIREBASE_CODE', 'Account action', 3, 1, chromeTime)
    insert.run('https://app.example.test/m?access%2525252525252554oken=FAKE_DEEP_KEY', 'Deep encoded key', 3, 1, chromeTime)
    insert.run('https://app.example.test/n?redirect=https%3A%2F%2Fdest.example.test%2Fcb%3Faccess_token%3DFAKE_NESTED_TOKEN', 'Nested callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/o?continue=https%253A%252F%252Fdest.example.test%252Fcb%253Faccess_token%253DFAKE_DOUBLE_NESTED_TOKEN', 'Double nested callback', 3, 1, chromeTime)
    insert.run(nestedCredentialHistoryUrl, 'Four hop callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/q?redirect=https%3A%5C%5Cnested-user%3AFAKE_NESTED_USERINFO%40dest.example%2Fpath', 'Backslash callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/r?redirect=https%3Anested-user%3AFAKE_ZERO_SEPARATOR_USERINFO%40dest.example%2Fpath', 'Zero separator callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/s?redirect=https%3A%2Fnested-user%3AFAKE_SINGLE_SLASH_USERINFO%40dest.example%2Fpath', 'Single slash callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/t?redirect=https%3A%5Cnested-user%3AFAKE_SINGLE_BACKSLASH_USERINFO%40dest.example%2Fpath', 'Single backslash callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/u?redirect=ftp%3A%2F%2Fnested-user%3AFAKE_FTP_USERINFO%40files.example%2Fpath', 'FTP callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/v?redirect=postgres%3A%2F%2Fdb-user%3AFAKE_DATABASE_USERINFO%40db.internal%2Fdatabase', 'Database callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/w?redirect=git%2Bhttps%3A%2F%2Fgit-user%3AFAKE_GIT_USERINFO%40git.example%2Frepo', 'Git callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/x?redirect=h%0Attps%3A%2F%2Fnested-user%3AFAKE_NEWLINE_SCHEME_USERINFO%40dest.example%2Fpath', 'Newline scheme callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/y?redirect=ht%09tps%3A%2F%2Fnested-user%3AFAKE_TAB_SCHEME_USERINFO%40dest.example%2Fpath', 'Tab scheme callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/z?redirect=https%0D%3A%2F%2Fnested-user%3AFAKE_CR_SCHEME_USERINFO%40dest.example%2Fpath', 'Carriage return scheme callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/c0?redirect=%00https%3A%2F%2Fnested-user%3AFAKE_NUL_PREFIX_USERINFO%40dest.example%2Fpath', 'NUL prefix callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/c1?redirect=%01https%3A%2F%2Fnested-user%3AFAKE_SOH_PREFIX_USERINFO%40dest.example%2Fpath', 'SOH prefix callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/c8?redirect=%08https%3A%2F%2Fnested-user%3AFAKE_BACKSPACE_PREFIX_USERINFO%40dest.example%2Fpath', 'Backspace prefix callback', 3, 1, chromeTime)
    insert.run('https://app.example.test/c31?redirect=%1Fhttps%3A%2F%2Fnested-user%3AFAKE_UNIT_SEPARATOR_PREFIX_USERINFO%40dest.example%2Fpath', 'Unit separator prefix callback', 3, 1, chromeTime)
    insert.run('https://docs.example.test/terms?monkey=capuchin&tokenizer=wordpiece&countryCode=US&sourceCode=docs&encryptionKey=public-id&sessionView=summary#section=read', 'Benign parameters', 2, 0, chromeTime)
    insert.run('https://docs.example.test/go?continue=https%3A%2F%2Fdocs.example.test%2Fhandbook%3Fsection%3Dsecurity&query=access_token%20documentation', 'Benign redirect', 2, 0, chromeTime)
    insert.run(nestedBenignHistoryUrl, 'Benign four hop redirect', 2, 0, chromeTime)
    insert.run('https://docs.example.test/handbook', 'Handbook', 2, 0, chromeTime)
    db.close()

    const visits = await readBrowserHistorySource({
      path: historyPath,
      browser: 'chrome',
      profile: 'Default',
      platform: 'linux',
    })

    const serialized = JSON.stringify(visits)
    expect(serialized).not.toContain('FAKEPASS_xyz789')
    expect(serialized).not.toContain('FAKE_TOKEN_abc123')
    for (const secret of [
      'FAKE_ACCESS_CAMEL',
      'FAKE_REFRESH_CAMEL',
      'FAKE_CLIENT_CAMEL',
      'FAKE_SESSION_CAMEL',
      'FAKE_AUTH_CAMEL',
      'FAKE_ACCESS_COLLAPSED',
      'FAKE_NUMBERED_TOKEN',
      'FAKE_ENCODED_FRAGMENT',
      'FAKE_DOUBLE_ENCODED_KEY',
      'FAKE_SAML_ASSERTION',
      'FAKE_CAS_TICKET',
      'FAKE_FIREBASE_CODE',
      'FAKE_DEEP_KEY',
      'FAKE_NESTED_TOKEN',
      'FAKE_DOUBLE_NESTED_TOKEN',
      'FAKE_FOUR_HOP_TOKEN',
      'FAKE_NESTED_USERINFO',
      'FAKE_ZERO_SEPARATOR_USERINFO',
      'FAKE_SINGLE_SLASH_USERINFO',
      'FAKE_SINGLE_BACKSLASH_USERINFO',
      'FAKE_FTP_USERINFO',
      'FAKE_DATABASE_USERINFO',
      'FAKE_GIT_USERINFO',
      'FAKE_NEWLINE_SCHEME_USERINFO',
      'FAKE_TAB_SCHEME_USERINFO',
      'FAKE_CR_SCHEME_USERINFO',
      'FAKE_NUL_PREFIX_USERINFO',
      'FAKE_SOH_PREFIX_USERINFO',
      'FAKE_BACKSPACE_PREFIX_USERINFO',
      'FAKE_UNIT_SEPARATOR_PREFIX_USERINFO',
    ]) {
      expect(serialized).not.toContain(secret)
    }
    expect(serialized).not.toContain('user:')

    for (const entry of visits) {
      const url = new URL(entry.url)
      expect(url.username).toBe('')
      expect(url.password).toBe('')
    }

    expect(visits.some((entry) => entry.url === 'https://docs.example.test/handbook')).toBe(true)
    expect(visits.some((entry) => entry.url === 'https://docs.example.test/terms?monkey=capuchin&tokenizer=wordpiece&countryCode=US&sourceCode=docs&encryptionKey=public-id&sessionView=summary#section=read')).toBe(true)
    expect(visits.some((entry) => entry.url === 'https://docs.example.test/go?continue=https%3A%2F%2Fdocs.example.test%2Fhandbook%3Fsection%3Dsecurity&query=access_token%20documentation')).toBe(true)
    expect(visits.some((entry) => entry.url === nestedBenignHistoryUrl)).toBe(true)
  })
})
