import { copyFile, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { readKeepIndexEnvironment, type Environment } from './environment'

export type BrowserHistorySource = {
  path: string
  browser: 'chrome' | 'edge' | 'brave' | 'chromium' | 'firefox'
  profile: string
  platform: 'linux' | 'windows'
}

export type ImportedBrowserVisit = {
  sourceKey: string
  browser: BrowserHistorySource['browser']
  profile: string
  url: string
  title: string
  visitCount: number
  typedCount: number
  lastVisitedAt: number
}

type SqlValue = string | number | bigint | null | Uint8Array
type SqliteStatement = { all: (...values: SqlValue[]) => unknown[] }
type SqliteDatabase = {
  prepare?: (sql: string) => SqliteStatement
  query?: (sql: string) => SqliteStatement
  close?: () => unknown
}
type Row = Record<string, unknown>

const dynamicImport = Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<Record<string, unknown>>

function prepare(db: SqliteDatabase, sql: string): SqliteStatement {
  const statement = db.prepare?.(sql) ?? db.query?.(sql)
  if (!statement) throw new Error('Browser history SQLite reader is unavailable')
  return statement
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function directoryNames(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

function chromiumProfile(name: string): boolean {
  return name === 'Default' || /^Profile \d+$/.test(name) || /^Guest Profile$/.test(name)
}

async function addChromiumSources(
  output: BrowserHistorySource[],
  root: string,
  browser: BrowserHistorySource['browser'],
  platform: BrowserHistorySource['platform']
): Promise<void> {
  for (const profile of (await directoryNames(root)).filter(chromiumProfile)) {
    const path = join(root, profile, 'History')
    if (await isFile(path)) output.push({ path, browser, profile, platform })
  }
}

async function addFirefoxSources(
  output: BrowserHistorySource[],
  root: string,
  platform: BrowserHistorySource['platform']
): Promise<void> {
  for (const profile of await directoryNames(root)) {
    const path = join(root, profile, 'places.sqlite')
    if (await isFile(path)) output.push({ path, browser: 'firefox', profile, platform })
  }
}

/**
 * Discovers only well-known browser profile directories. It deliberately does
 * not crawl the disk, keeping the privacy surface and WSL mount cost bounded.
 */
export async function discoverBrowserHistorySources(
  environment: Environment = process.env
): Promise<BrowserHistorySource[]> {
  const output: BrowserHistorySource[] = []
  const home = homedir()
  await Promise.all([
    addChromiumSources(output, join(home, '.config/google-chrome'), 'chrome', 'linux'),
    addChromiumSources(output, join(home, '.config/microsoft-edge'), 'edge', 'linux'),
    addChromiumSources(output, join(home, '.config/BraveSoftware/Brave-Browser'), 'brave', 'linux'),
    addChromiumSources(output, join(home, '.config/chromium'), 'chromium', 'linux'),
    addFirefoxSources(output, join(home, '.mozilla/firefox'), 'linux'),
  ])

  const windowsUsersRoot = '/mnt/c/Users'
  for (const user of await directoryNames(windowsUsersRoot)) {
    const userRoot = join(windowsUsersRoot, user)
    await Promise.all([
      addChromiumSources(output, join(userRoot, 'AppData/Local/Google/Chrome/User Data'), 'chrome', 'windows'),
      addChromiumSources(output, join(userRoot, 'AppData/Local/Microsoft/Edge/User Data'), 'edge', 'windows'),
      addChromiumSources(output, join(userRoot, 'AppData/Local/BraveSoftware/Brave-Browser/User Data'), 'brave', 'windows'),
      addChromiumSources(output, join(userRoot, 'AppData/Local/Chromium/User Data'), 'chromium', 'windows'),
      addFirefoxSources(output, join(userRoot, 'AppData/Roaming/Mozilla/Firefox/Profiles'), 'windows'),
    ])
  }

  const configured = (readKeepIndexEnvironment('BROWSER_HISTORY_PATHS', environment) ?? '')
    .split(/[;,\n]/)
    .map((path) => path.trim())
    .filter(Boolean)
  for (const rawPath of configured) {
    const path = resolve(rawPath)
    if (!(await isFile(path)) || output.some((source) => source.path === path)) continue
    const firefox = basename(path) === 'places.sqlite'
    output.push({
      path,
      browser: firefox ? 'firefox' : 'chromium',
      profile: basename(dirname(path)),
      platform: path.startsWith('/mnt/') ? 'windows' : 'linux',
    })
  }

  return output
    .filter((source, index, sources) => sources.findIndex((candidate) => candidate.path === source.path) === index)
    .sort((a, b) => a.browser.localeCompare(b.browser) || a.profile.localeCompare(b.profile) || a.path.localeCompare(b.path))
}

async function openReadOnlyDatabase(path: string): Promise<SqliteDatabase> {
  if ('Bun' in globalThis) {
    const sqlite = await dynamicImport('bun:sqlite') as {
      Database?: new (path: string, options?: { readonly?: boolean; strict?: boolean }) => SqliteDatabase
    }
    if (!sqlite.Database) throw new Error('bun:sqlite is unavailable')
    return new sqlite.Database(path, { readonly: true, strict: true })
  }
  const sqlite = await dynamicImport('node:sqlite') as {
    DatabaseSync?: new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase
  }
  if (!sqlite.DatabaseSync) throw new Error('node:sqlite is unavailable')
  return new sqlite.DatabaseSync(path, { readOnly: true })
}

function chromeTimeToUnixMs(value: unknown): number {
  const microseconds = Number(value)
  if (!Number.isFinite(microseconds) || microseconds <= 0) return 0
  return Math.max(0, Math.round(microseconds / 1000 - 11_644_473_600_000))
}

function firefoxTimeToUnixMs(value: unknown): number {
  const microseconds = Number(value)
  return Number.isFinite(microseconds) && microseconds > 0 ? Math.round(microseconds / 1000) : 0
}

const EXACT_CREDENTIAL_PARAM_PATTERN =
  /^(?:token\d*|secret|password|passwd|pwd|credentials?|apikey|auth|authorization|session|sessionid|sid|signature|sig|jwt|otp|nonce|code|key|assertion|ticket|serviceticket|casticket|saml(?:request|response|art)|relaystate|wresult|oobcode|codeverifier|devicecode|usercode|access(?:token|key|code)|refresh(?:token|key)|idtoken|bearertoken|authtoken|oauth(?:token|code|verifier)|client(?:secret|token)|api(?:token|secret|key)|session(?:token|key|secret)|auth(?:code|token|key|secret)|authorization(?:code|token)|resetcode|recoverycode|backupcode|verificationcode|verifycode|invitecode|magiccode|logincode|signincode|onetimecode|2facode|mfacode|privatekey|signingkey)$/

const STRONG_CREDENTIAL_SEGMENT_PATTERN =
  /^(?:token\d*|secret|password|passwd|pwd|credentials?|apikey|auth|authorization|sessionid|sid|signature|sig|jwt|otp|nonce)$/

function repeatedlyDecode(value: string): string {
  let decoded = value
  // A browser URL can contain an already encoded redirect URL, so one decode
  // is not always enough. The fixed budget prevents adversarial expansion.
  for (let pass = 0; pass < 6; pass += 1) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      break
    }
  }
  return decoded
}

const ENCODED_OCTET_PATTERN = /%[0-9a-f]{2}/i
const MAX_NESTED_CREDENTIAL_DEPTH = 8

function credentialParamName(key: string): boolean {
  // URLSearchParams decodes names for us. Split camelCase and acronym-to-word
  // transitions so access_token, access-token, accessToken, and ACCESSTOKEN
  // receive the same treatment. Generic `code`, `key`, and `session` segments
  // are accepted only as exact or high-confidence credential compounds; this
  // preserves ordinary countryCode, sourceCode, encryptionKey, and sessionView.
  const decoded = repeatedlyDecode(key)
  // A credential name encoded beyond the fixed decode budget is opaque by
  // construction. Fail closed instead of allowing one more encoding layer to
  // bypass the importer.
  if (ENCODED_OCTET_PATTERN.test(decoded)) return true
  const segmented = decoded
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
  const segments = segmented.split('_').filter(Boolean)
  const compact = segments.join('')
  if (EXACT_CREDENTIAL_PARAM_PATTERN.test(compact)) return true
  if (segments.some((segment) => STRONG_CREDENTIAL_SEGMENT_PATTERN.test(segment))) return true

  const includesAny = (values: readonly string[]): boolean => values.some((value) => segments.includes(value))
  if (segments.includes('session') && includesAny(['id', 'token', 'secret', 'key', 'auth'])) return true
  if (
    segments.includes('code') &&
    includesAny(['access', 'auth', 'authorization', 'oauth', 'reset', 'recovery', 'backup', 'verification', 'verify', 'invite', 'magic', 'login', 'signin', '2fa', 'mfa'])
  ) return true
  if (
    segments.includes('key') &&
    includesAny(['access', 'api', 'client', 'private', 'secret', 'signing'])
  ) return true
  return false
}

function queryStringCarriesCredential(value: string, depth: number): boolean {
  const query = value.replace(/^[?#]/, '')
  if (!query.includes('=')) return false
  const params = new URLSearchParams(query)
  for (const [key, nestedValue] of params.entries()) {
    if (credentialParamName(key)) return true
    if (credentialBearingNestedValue(nestedValue, depth + 1)) return true
  }
  return false
}

function credentialBearingNestedValue(value: string, depth = 0): boolean {
  // WHATWG URL parsing removes ASCII tab/LF/CR anywhere and leading/trailing
  // C0 controls plus space before interpreting a scheme. Mirror that exact
  // preprocessing so controls cannot make a credential URL look like plain
  // text to this classifier but valid HTTPS to the browser.
  const decoded = repeatedlyDecode(value)
    .replace(/[\t\n\r]/g, '')
    .replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '')
  if (!decoded) return false
  // Reaching the decode budget with valid encoded octets still present means
  // the value is deliberately opaque. Browser-history privacy takes priority
  // over preserving such an unusual outer parameter.
  if (ENCODED_OCTET_PATTERN.test(decoded)) return true

  const absoluteUri = /^[a-z][a-z0-9+.-]*:/i.test(decoded)
  const relativeUri = /^[\\/]/.test(decoded)
  const structurallyNested =
    absoluteUri ||
    relativeUri ||
    decoded.includes('?') ||
    decoded.includes('#') ||
    /^[^=&?#]+=/.test(decoded)
  // The recursion budget is a denial-of-service control, never an allow rule.
  // If more structured navigation data remains at the ceiling, remove the
  // outer parameter instead of giving an attacker a deterministic bypass.
  if (depth > MAX_NESTED_CREDENTIAL_DEPTH) return structurallyNested

  if (absoluteUri || relativeUri) {
    try {
      // Absolute special-scheme URLs must be parsed without a base. Supplying
      // a base changes WHATWG handling of forms such as `https:user:pass@host`
      // and can hide their userinfo. A base is reserved for relative paths.
      const nested = absoluteUri
        ? new URL(decoded)
        : new URL(decoded, 'https://keepindex.invalid')
      if (nested.username || nested.password) return true
      if (queryStringCarriesCredential(nested.search, depth)) return true
      if (credentialBearingFragment(nested.hash, depth)) return true
      return false
    } catch {
      // Fall through to query-shaped inspection.
    }
  }

  const queryStart = decoded.indexOf('?')
  if (queryStart >= 0 && queryStringCarriesCredential(decoded.slice(queryStart + 1), depth)) return true
  const fragmentStart = decoded.indexOf('#')
  if (fragmentStart >= 0 && credentialBearingFragment(decoded.slice(fragmentStart), depth)) return true
  return queryStringCarriesCredential(decoded, depth)
}

function stripCredentialParams(params: URLSearchParams): void {
  for (const key of Array.from(new Set(params.keys()))) {
    if (
      credentialParamName(key) ||
      params.getAll(key).some((value) => credentialBearingNestedValue(value))
    ) params.delete(key)
  }
}

function credentialBearingFragment(hash: string, depth = 0): boolean {
  const fragment = repeatedlyDecode(hash.replace(/^#/, ''))
  // If an unusually deep encoding still hides an equals sign after the decode
  // budget, fail closed rather than retaining an opaque credential fragment.
  if (ENCODED_OCTET_PATTERN.test(fragment)) return true
  if (!fragment.includes('=')) return false
  return queryStringCarriesCredential(fragment, depth)
}

function safeUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    // Mirrors sanitizedUrl in source-hydration.ts: userinfo never travels with a
    // URL we keep. An OAuth implicit-flow fragment or a magic-link token would
    // otherwise become searchable local text and could reach an LLM prompt.
    url.username = ''
    url.password = ''
    stripCredentialParams(url.searchParams)
    // The rest of a token fragment is only OAuth scaffolding, so drop it whole.
    // Ordinary query strings and anchors stay: they are often what identifies
    // the page a visit was actually on.
    if (credentialBearingFragment(url.hash)) url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

function sourceKey(source: BrowserHistorySource, url: string): string {
  // The same profile label can exist on Linux and Windows under WSL. Include
  // the discovered database identity so one device cannot overwrite another.
  return `${source.browser}\u0000${source.profile}\u0000${source.path}\u0000${url}`
}

export async function readBrowserHistorySource(
  source: BrowserHistorySource,
  limit = 250_000
): Promise<ImportedBrowserVisit[]> {
  // Chromium commonly holds a write lock. A private temporary copy gives us a
  // consistent read without asking the browser to close or touching its DB.
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'keepindex-history-'))
  const copyPath = join(temporaryDirectory, source.browser === 'firefox' ? 'places.sqlite' : 'History')
  try {
    await copyFile(source.path, copyPath)
    // Include WAL sidecars when present so visits that have not reached the
    // browser's main database are visible in the isolated snapshot.
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${source.path}${suffix}`
      if (await isFile(sidecar)) await copyFile(sidecar, `${copyPath}${suffix}`).catch(() => undefined)
    }
    const db = await openReadOnlyDatabase(copyPath)
    try {
      const safeLimit = Math.min(500_000, Math.max(1, Math.trunc(limit)))
      const rows = source.browser === 'firefox'
        ? prepare(db, `
            SELECT url, COALESCE(title, '') AS title,
                   COALESCE(visit_count, 0) AS visit_count,
                   0 AS typed_count,
                   COALESCE(last_visit_date, 0) AS last_visit_time
            FROM moz_places
            WHERE url LIKE 'http://%' OR url LIKE 'https://%'
            ORDER BY last_visit_date DESC
            LIMIT ?
          `).all(safeLimit)
        : prepare(db, `
            SELECT url, COALESCE(title, '') AS title,
                   COALESCE(visit_count, 0) AS visit_count,
                   COALESCE(typed_count, 0) AS typed_count,
                   COALESCE(last_visit_time, 0) AS last_visit_time
            FROM urls
            WHERE url LIKE 'http://%' OR url LIKE 'https://%'
            ORDER BY last_visit_time DESC
            LIMIT ?
          `).all(safeLimit)

      const visits: ImportedBrowserVisit[] = []
      for (const rawRow of rows) {
        if (!rawRow || typeof rawRow !== 'object') continue
        const row = rawRow as Row
        const url = safeUrl(row.url)
        if (!url) continue
        visits.push({
          sourceKey: sourceKey(source, url),
          browser: source.browser,
          profile: source.profile.slice(0, 160),
          url,
          title: (typeof row.title === 'string' && row.title.trim() ? row.title.trim() : url).slice(0, 1000),
          visitCount: Math.max(0, Math.trunc(Number(row.visit_count) || 0)),
          typedCount: Math.max(0, Math.trunc(Number(row.typed_count) || 0)),
          lastVisitedAt: source.browser === 'firefox'
            ? firefoxTimeToUnixMs(row.last_visit_time)
            : chromeTimeToUnixMs(row.last_visit_time),
        })
      }
      return visits
    } finally {
      db.close?.()
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}
