import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, extname, parse as parsePath, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  inspectInferenceEndpoint,
  LOCAL_INFERENCE_REDIRECT_POLICY,
  resolveInferenceAdapter,
  type InferenceAdapter,
} from '../server/inference-endpoint-policy'

export const KEEPINDEX_VERSION = '1.1.0'
export const DEFAULT_KEEPINDEX_URL = 'http://localhost:5173'
export const DEFAULT_SEARXNG_URL = 'http://127.0.0.1:8888'
export const DEFAULT_LLM_URL = 'http://127.0.0.1:8080'

const COMMANDS = ['help', 'version', 'start', 'doctor', 'status', 'open'] as const
type Command = (typeof COMMANDS)[number]

export type ParsedCliArgs = {
  command: Command
  helpTarget?: Exclude<Command, 'help'>
  url?: string
  json: boolean
  detach: boolean
}

export type CommandResult = {
  ok: boolean
  detail?: string
}

export type PortState = 'available' | 'occupied' | 'unavailable'

export type KeepIndexStatus = {
  status: string
  url: string
  healthScore: number | null
  providers: {
    searxng: boolean
    localInference: boolean
  }
  database: {
    available: boolean
    path: string | null
    persistence: string | null
  }
  index: {
    resources: number
    unavailable: number
  }
  models: {
    active: string | null
    count: number
  }
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type CliDependencies = {
  env?: Readonly<Record<string, string | undefined>>
  cwd?: string
  platform?: NodeJS.Platform
  projectRoot?: string
  writeOut?: (text: string) => void
  writeErr?: (text: string) => void
  fetch?: FetchLike
  commandVersion?: (command: string, args: string[]) => CommandResult
  probeUrl?: (url: string, headers?: Record<string, string>, redirect?: RequestInit['redirect']) => Promise<boolean>
  probePort?: (port: number) => Promise<PortState>
  runCompose?: (projectRoot: string, detached: boolean) => Promise<number>
  openUrl?: (url: string, platform: NodeJS.Platform) => Promise<boolean>
}

class CliUsageError extends Error {}

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value)
}

function optionValue(argv: string[], index: number, option: string): { value: string; consumed: number } {
  const current = argv[index] ?? ''
  const inlinePrefix = `${option}=`
  if (current.startsWith(inlinePrefix)) {
    const value = current.slice(inlinePrefix.length)
    if (!value) throw new CliUsageError(`${option} requires a value`)
    return { value, consumed: 1 }
  }
  const value = argv[index + 1]
  if (!value || value.startsWith('-')) throw new CliUsageError(`${option} requires a value`)
  return { value, consumed: 2 }
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const positional: string[] = []
  let url: string | undefined
  let json = false
  let detach = false
  let help = false
  let version = false

  for (let index = 0; index < argv.length;) {
    const value = argv[index] ?? ''
    if (value === '--url' || value.startsWith('--url=')) {
      if (url !== undefined) throw new CliUsageError('--url may only be specified once')
      const parsed = optionValue(argv, index, '--url')
      url = parsed.value
      index += parsed.consumed
      continue
    }
    if (value === '--json') {
      json = true
      index += 1
      continue
    }
    if (value === '--detach' || value === '-d') {
      detach = true
      index += 1
      continue
    }
    if (value === '--help' || value === '-h') {
      help = true
      index += 1
      continue
    }
    if (value === '--version' || value === '-v') {
      version = true
      index += 1
      continue
    }
    if (value.startsWith('-')) throw new CliUsageError(`unknown option: ${value}`)
    positional.push(value)
    index += 1
  }

  if (version) {
    if (positional.length > 0 || json || detach || help) {
      throw new CliUsageError('--version cannot be combined with a command or other option')
    }
    return { command: 'version', url, json: false, detach: false }
  }

  if (positional.length === 0) {
    if (json || detach) throw new CliUsageError('--json and --detach require a command')
    return { command: 'help', url, json: false, detach: false }
  }

  const requested = positional[0] ?? ''
  if (!isCommand(requested)) throw new CliUsageError(`unknown command: ${requested}`)

  if (requested === 'help') {
    if (json || detach) throw new CliUsageError('help does not accept --json or --detach')
    if (positional.length > 2) throw new CliUsageError('help accepts at most one command name')
    const target = positional[1]
    if (target !== undefined && (!isCommand(target) || target === 'help')) {
      throw new CliUsageError(`unknown command: ${target}`)
    }
    return {
      command: 'help',
      helpTarget: target as Exclude<Command, 'help'> | undefined,
      url,
      json: false,
      detach: false,
    }
  }

  if (positional.length > 1) throw new CliUsageError(`${requested} does not accept positional arguments`)
  if (help) {
    return {
      command: 'help',
      helpTarget: requested,
      url,
      json: false,
      detach: false,
    }
  }
  if (json && requested !== 'status') throw new CliUsageError('--json is only valid with status')
  if (detach && requested !== 'start') throw new CliUsageError('--detach is only valid with start')
  return { command: requested, url, json, detach }
}

const MAIN_HELP = `keepidx — KeepIndex local operations

Search your world. Keep it yours.
Private, local-first federated search.

Usage:
  keepidx <command> [options]

Commands:
  start              Build and start KeepIndex plus SearXNG with Docker Compose
  doctor             Check local prerequisites, ports, paths, and providers
  status             Read concise application and provider health
  open               Open the configured local KeepIndex URL
  version            Print the keepidx version
  help [command]     Show this help or help for one command

Global options:
  --url <url>        Override the local application URL
  -h, --help         Show help
  -v, --version      Show the version

Run "keepidx help <command>" for command-specific help.
`

const COMMAND_HELP: Record<Exclude<Command, 'help'>, string> = {
  start: `Usage: keepidx start [--detach] [--url <url>]

Build and start the KeepIndex application and SearXNG with Docker Compose.
The default foreground mode streams logs and forwards termination signals.

Options:
  -d, --detach       Start containers in the background
  --url <url>        Application URL to display after startup
  -h, --help         Show this help
`,
  doctor: `Usage: keepidx doctor [--url <url>]

Check Bun, Docker, Docker Compose, endpoint safety, database path safety,
required ports, and local provider reachability. Native Ollama and
OpenAI-compatible local servers are supported. No secrets are printed.

Options:
  --url <url>        Override the local application URL
  -h, --help         Show this help
`,
  status: `Usage: keepidx status [--json] [--url <url>]

Read /api/health and report provider, database, model, and local-index status.

Options:
  --json             Emit one deterministic JSON object
  --url <url>        Override the local application URL
  -h, --help         Show this help
`,
  open: `Usage: keepidx open [--url <url>]

Open KeepIndex with the platform URL handler. When no safe handler is
available, print the URL so it can be opened manually.

Options:
  --url <url>        Override the local application URL
  -h, --help         Show this help
`,
  version: `Usage: keepidx version

Print the installed keepidx version.
`,
}

export function helpText(target?: Exclude<Command, 'help'>): string {
  return target ? COMMAND_HELP[target] : MAIN_HELP
}

function configuredValue(
  env: Readonly<Record<string, string | undefined>>,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim()
    if (value) return value
  }
  return undefined
}

export function normalizeHttpUrl(value: string, label = 'URL'): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new CliUsageError(`${label} must be a valid http:// or https:// URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CliUsageError(`${label} must use http:// or https://`)
  }
  if (parsed.username || parsed.password) {
    throw new CliUsageError(`${label} must not contain embedded credentials`)
  }
  if (parsed.search || parsed.hash) {
    throw new CliUsageError(`${label} must not contain a query string or fragment`)
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
  return parsed.toString().replace(/\/$/, '')
}

export function resolveKeepIndexUrl(
  explicitUrl: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const configuredUrl = env.KEEPINDEX_URL?.trim() || undefined
  const value = explicitUrl ?? configuredUrl
  return normalizeHttpUrl(value ?? DEFAULT_KEEPINDEX_URL, 'KeepIndex URL')
}

export function resolveProviderUrl(
  env: Readonly<Record<string, string | undefined>>,
  variable: 'SEARXNG_URL' | 'LLM_URL',
): string {
  const fallback = variable === 'SEARXNG_URL' ? DEFAULT_SEARXNG_URL : DEFAULT_LLM_URL
  return normalizeHttpUrl(configuredValue(env, [variable]) ?? fallback, variable)
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a = -1, b = -1] = parts
  return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/**
 * Inference is deliberately constrained to the user's machine or private
 * network. Public/vendor hosts would silently change KeepIndex's privacy model.
 */
export function isPrivateInferenceUrl(value: string): boolean {
  return inspectInferenceEndpoint(value).allowed
}

function safeUrlForDisplay(value: string): string {
  try {
    const parsed = new URL(value)
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return '<invalid URL>'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function shapeHealthStatus(payload: unknown, url: string): KeepIndexStatus {
  if (!isRecord(payload)) throw new Error('health endpoint returned an invalid JSON object')
  const knowledge = isRecord(payload.knowledge) ? payload.knowledge : {}
  return {
    status: typeof payload.status === 'string' ? payload.status : 'unknown',
    url,
    healthScore: typeof payload.healthScore === 'number' && Number.isFinite(payload.healthScore)
      ? payload.healthScore
      : null,
    providers: {
      searxng: payload.searxng === true,
      localInference: payload.llm === true,
    },
    database: {
      available: payload.database === true,
      path: typeof payload.databasePath === 'string' ? payload.databasePath : null,
      persistence: typeof payload.persistence === 'string' ? payload.persistence : null,
    },
    index: {
      resources: finiteNumber(knowledge.resources, 0),
      unavailable: finiteNumber(knowledge.unavailable, 0),
    },
    models: {
      active: typeof payload.activeModel === 'string' && payload.activeModel ? payload.activeModel : null,
      count: finiteNumber(payload.modelCount, 0),
    },
  }
}

export function formatPlainStatus(status: KeepIndexStatus): string {
  const score = status.healthScore === null ? 'unknown score' : `${status.healthScore}%`
  const databaseDetail = status.database.path ? ` (${status.database.path})` : ''
  const modelDetail = status.models.active ? `; active ${status.models.active}` : ''
  return [
    `KeepIndex: ${status.status} (${score})`,
    `URL: ${status.url}`,
    `SearXNG: ${status.providers.searxng ? 'ready' : 'unavailable'}`,
    `Local inference: ${status.providers.localInference ? 'ready' : 'unavailable'}`,
    `Database: ${status.database.available ? 'ready' : 'unavailable'}${databaseDetail}`,
    `Index: ${status.index.resources} resources; ${status.index.unavailable} unavailable`,
    `Models: ${status.models.count}${modelDetail}`,
  ].join('\n') + '\n'
}

function appendEndpoint(base: string, pathname: string): string {
  return `${base.replace(/\/+$/, '')}/${pathname.replace(/^\/+/, '')}`
}

async function fetchWithTimeout(fetcher: FetchLike, url: string, timeoutMs = 3500, headers?: Record<string, string>, redirect?: RequestInit['redirect']): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetcher(url, {
      headers: { Accept: 'application/json', 'User-Agent': `KeepIndex/${KEEPINDEX_VERSION} keepidx`, ...headers },
      signal: controller.signal,
      redirect,
    })
  } finally {
    clearTimeout(timeout)
  }
}

function defaultCommandVersion(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
  })
  if (result.error || result.status !== 0) return { ok: false }
  const firstLine = `${result.stdout || result.stderr}`.trim().split(/\r?\n/, 1)[0]
  return { ok: true, detail: firstLine || 'available' }
}

async function defaultProbeUrl(fetcher: FetchLike, url: string, headers?: Record<string, string>, redirect?: RequestInit['redirect']): Promise<boolean> {
  try {
    return (await fetchWithTimeout(fetcher, url, 2500, headers, redirect)).ok
  } catch {
    return false
  }
}

async function defaultProbePort(port: number): Promise<PortState> {
  return await new Promise((complete) => {
    const server = createServer()
    server.unref()
    server.once('error', (error: NodeJS.ErrnoException) => {
      complete(error.code === 'EADDRINUSE' ? 'occupied' : 'unavailable')
    })
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => complete('available'))
    })
  })
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '::1' || normalized === '0.0.0.0' || isPrivateIpv4(normalized)
}

function endpointPort(value: string): number | null {
  const url = new URL(value)
  if (!isLocalHostname(url.hostname)) return null
  if (url.port) return Number.parseInt(url.port, 10)
  return url.protocol === 'https:' ? 443 : 80
}

export function resolveDatabasePath(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): string {
  const explicit = env.KEEPINDEX_DB_PATH?.trim()
  if (explicit) return resolve(cwd, explicit)
  return resolve(cwd, 'server', 'keepindex.sqlite')
}

export function inspectDatabasePath(path: string): CommandResult {
  const root = parsePath(path).root
  if (!path || path === root || path.includes('\0')) {
    return { ok: false, detail: 'must identify a database file, not a root or device path' }
  }
  if (!['.sqlite', '.sqlite3', '.db'].includes(extname(path).toLowerCase())) {
    return { ok: false, detail: 'must end in .sqlite, .sqlite3, or .db' }
  }
  if (existsSync(path)) {
    try {
      if (!statSync(path).isFile()) return { ok: false, detail: 'existing path is not a regular file' }
      accessSync(path, constants.R_OK | constants.W_OK)
      return { ok: true, detail: path }
    } catch {
      return { ok: false, detail: 'existing database is not readable and writable' }
    }
  }
  let parent = dirname(path)
  while (!existsSync(parent)) {
    const next = dirname(parent)
    if (next === parent) return { ok: false, detail: 'no writable parent directory exists' }
    parent = next
  }
  try {
    if (!statSync(parent).isDirectory()) return { ok: false, detail: 'parent is not a directory' }
    accessSync(parent, constants.W_OK)
    return { ok: true, detail: path }
  } catch {
    return { ok: false, detail: 'parent directory is not writable' }
  }
}

function defaultProjectRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
}

export function composeSignalPolicy(platform: NodeJS.Platform): {
  detached: boolean
  forwardInterrupt: boolean
  signalProcessGroup: boolean
} {
  // POSIX terminals signal the entire foreground group. Put Compose in its
  // own group and forward exactly once so Ctrl+C stays graceful. Windows
  // console control events already reach the inherited child group; an extra
  // forwarded SIGINT could turn Compose's first graceful stop into a force.
  const isolate = platform !== 'win32'
  return {
    detached: isolate,
    forwardInterrupt: isolate,
    signalProcessGroup: isolate,
  }
}

async function defaultRunCompose(projectRoot: string, detached: boolean): Promise<number> {
  const args = ['compose', '-f', resolve(projectRoot, 'docker-compose.yml'), 'up', '--build', '--remove-orphans']
  if (detached) args.push('--detach')
  return await new Promise((complete) => {
    const signalPolicy = composeSignalPolicy(process.platform)
    const child = spawn('docker', args, {
      cwd: projectRoot,
      env: process.env,
      stdio: 'inherit',
      detached: signalPolicy.detached,
    })
    let finished = false
    const forward = (signal: NodeJS.Signals) => {
      if (child.killed || child.pid == null) return
      try {
        if (signalPolicy.signalProcessGroup) process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch {
        // The child may have completed between the signal and this check.
      }
    }
    const onInterrupt = () => forward('SIGINT')
    const onTerminate = () => forward('SIGTERM')
    const cleanup = () => {
      process.off('SIGINT', onInterrupt)
      process.off('SIGTERM', onTerminate)
    }
    if (signalPolicy.forwardInterrupt) process.on('SIGINT', onInterrupt)
    process.on('SIGTERM', onTerminate)
    child.once('error', () => {
      if (finished) return
      finished = true
      cleanup()
      complete(127)
    })
    child.once('exit', (code, signal) => {
      if (finished) return
      finished = true
      cleanup()
      if (code !== null) complete(code)
      else complete(signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)
    })
  })
}

function openCommand(platform: NodeJS.Platform, url: string): { command: string; args: string[] }[] {
  if (platform === 'darwin') return [{ command: 'open', args: [url] }]
  if (platform === 'win32') {
    return [{ command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] }]
  }
  const commands = [
    { command: 'xdg-open', args: [url] },
    { command: 'gio', args: ['open', url] },
  ]
  if (process.env.WSL_INTEROP) {
    commands.push({
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $args[0]', url],
    })
  }
  return commands
}

async function defaultOpenUrl(url: string, platform: NodeJS.Platform): Promise<boolean> {
  for (const candidate of openCommand(platform, url)) {
    const result = spawnSync(candidate.command, candidate.args, {
      stdio: 'ignore',
      timeout: 5000,
      windowsHide: true,
    })
    if (!result.error && result.status === 0) return true
  }
  return false
}

type DoctorLevel = 'ok' | 'warn' | 'fail'
type DoctorCheck = { level: DoctorLevel; label: string; detail: string }

function doctorLine(check: DoctorCheck): string {
  return `[${check.level}] ${check.label}: ${check.detail}`
}

async function runDoctor(
  parsed: ParsedCliArgs,
  dependencies: CliDependencies,
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
  fetcher: FetchLike,
): Promise<{ code: number; output: string }> {
  const commandVersion = dependencies.commandVersion ?? defaultCommandVersion
  const probeUrl = dependencies.probeUrl ?? ((url, headers, redirect) => defaultProbeUrl(fetcher, url, headers, redirect))
  const probePort = dependencies.probePort ?? defaultProbePort
  const checks: DoctorCheck[] = []

  const bun = commandVersion('bun', ['--version'])
  checks.push({ level: bun.ok ? 'ok' : 'fail', label: 'Bun', detail: bun.ok ? (bun.detail ?? 'available') : 'not found' })
  const docker = commandVersion('docker', ['--version'])
  checks.push({ level: docker.ok ? 'ok' : 'fail', label: 'Docker', detail: docker.ok ? (docker.detail ?? 'available') : 'not found' })
  const dockerDaemon = docker.ok
    ? commandVersion('docker', ['info', '--format', '{{.ServerVersion}}'])
    : { ok: false }
  checks.push({
    level: dockerDaemon.ok ? 'ok' : 'fail',
    label: 'Docker daemon',
    detail: dockerDaemon.ok ? `available (${dockerDaemon.detail ?? 'server responding'})` : 'not responding',
  })
  const compose = commandVersion('docker', ['compose', 'version'])
  checks.push({
    level: compose.ok ? 'ok' : 'fail',
    label: 'Docker Compose',
    detail: compose.ok ? (compose.detail ?? 'available') : 'docker compose plugin not found',
  })

  let appUrl: string | null = null
  let searxngUrl: string | null = null
  let llmUrl: string | null = null
  let inferenceAdapter: InferenceAdapter | null = null
  try {
    appUrl = resolveKeepIndexUrl(parsed.url, env)
    checks.push({ level: 'ok', label: 'KeepIndex URL', detail: safeUrlForDisplay(appUrl) })
  } catch {
    checks.push({ level: 'fail', label: 'KeepIndex URL', detail: 'invalid local HTTP(S) endpoint' })
  }
  try {
    searxngUrl = resolveProviderUrl(env, 'SEARXNG_URL')
    checks.push({ level: 'ok', label: 'SearXNG URL', detail: safeUrlForDisplay(searxngUrl) })
  } catch {
    checks.push({ level: 'fail', label: 'SearXNG URL', detail: 'invalid HTTP(S) endpoint' })
  }
  try {
    inferenceAdapter = resolveInferenceAdapter(env)
    const detail = inferenceAdapter.requested === 'auto'
      ? 'auto (OpenAI-compatible or native Ollama)'
      : inferenceAdapter.requested
    checks.push({ level: 'ok', label: 'Inference provider', detail })
  } catch {
    checks.push({
      level: 'fail',
      label: 'Inference provider',
      detail: 'KEEPINDEX_INFERENCE_PROVIDER must be auto, openai-compatible, or ollama',
    })
  }
  try {
    llmUrl = resolveProviderUrl(env, 'LLM_URL')
    if (!isPrivateInferenceUrl(llmUrl)) {
      checks.push({
        level: 'fail',
        label: 'Inference policy',
        detail: 'LLM_URL must resolve to a local or private-network endpoint',
      })
      llmUrl = null
    } else {
      checks.push({ level: 'ok', label: 'Inference URL', detail: safeUrlForDisplay(llmUrl) })
    }
  } catch {
    checks.push({ level: 'fail', label: 'Inference URL', detail: 'invalid private HTTP(S) endpoint' })
  }

  const databasePath = resolveDatabasePath(env, cwd)
  const database = inspectDatabasePath(databasePath)
  checks.push({
    level: database.ok ? 'ok' : 'fail',
    label: 'Database path',
    detail: database.detail ?? (database.ok ? databasePath : 'unsafe'),
  })

  const llmApiKey = env.LLM_API_KEY?.trim()

  type EndpointEntry = { label: string; base: string; probes: string[]; headers?: Record<string, string>; redirect?: RequestInit['redirect'] }
  const endpoints: EndpointEntry[] = []
  if (appUrl) endpoints.push({ label: 'KeepIndex port', base: appUrl, probes: [appendEndpoint(appUrl, '/api/health')] })
  if (searxngUrl) endpoints.push({ label: 'SearXNG port', base: searxngUrl, probes: [appendEndpoint(searxngUrl, '/healthz')] })
  if (llmUrl && inferenceAdapter) {
    endpoints.push({
      label: 'Local inference port',
      base: llmUrl,
      headers: llmApiKey ? { Authorization: `Bearer ${llmApiKey}` } : undefined,
      redirect: LOCAL_INFERENCE_REDIRECT_POLICY,
      probes: inferenceAdapter.requested === 'auto'
        ? [appendEndpoint(llmUrl, '/v1/models'), appendEndpoint(llmUrl, '/api/tags')]
        : [appendEndpoint(llmUrl, inferenceAdapter.modelsPath)],
    })
  }

  const reachability = new Map<string, boolean>()
  for (const endpoint of endpoints) {
    for (const probe of endpoint.probes) {
      const reachable = await probeUrl(probe, endpoint.headers, endpoint.redirect)
      reachability.set(probe, reachable)
      if (reachable) break
    }
  }
  for (const endpoint of endpoints) {
    const port = endpointPort(endpoint.base)
    if (port === null) {
      checks.push({ level: 'ok', label: endpoint.label, detail: 'remote/private endpoint; local bind check not applicable' })
      continue
    }
    const state = await probePort(port)
    const reachable = endpoint.probes.some((probe) => reachability.get(probe) === true)
    if (state === 'available') {
      checks.push({ level: 'ok', label: endpoint.label, detail: `${port} available` })
    } else if (state === 'occupied' && reachable) {
      checks.push({ level: 'ok', label: endpoint.label, detail: `${port} in use by a responding service` })
    } else if (state === 'unavailable') {
      checks.push({ level: 'fail', label: endpoint.label, detail: `${port} could not be checked` })
    } else {
      checks.push({ level: 'fail', label: endpoint.label, detail: `${port} is occupied by an unrecognized service` })
    }
  }

  if (appUrl) {
    const reachable = reachability.get(appendEndpoint(appUrl, '/api/health')) === true
    checks.push({
      level: reachable ? 'ok' : 'warn',
      label: 'KeepIndex API',
      detail: reachable ? 'reachable' : 'not running yet',
    })
  }
  if (searxngUrl) {
    const reachable = reachability.get(appendEndpoint(searxngUrl, '/healthz')) === true
    checks.push({
      level: reachable ? 'ok' : 'warn',
      label: 'SearXNG',
      detail: reachable ? 'reachable' : 'unreachable; keepidx start will bootstrap it',
    })
  }
  if (llmUrl) {
    const inferenceEndpoint = endpoints.find((endpoint) => endpoint.label === 'Local inference port')
    const reachable = inferenceEndpoint?.probes.some((probe) => reachability.get(probe) === true) === true
    checks.push({
      level: reachable ? 'ok' : 'warn',
      label: 'Local inference',
      detail: reachable ? 'reachable' : 'unreachable; answers will remain gracefully degraded',
    })
  }

  const failures = checks.filter((check) => check.level === 'fail').length
  const warnings = checks.filter((check) => check.level === 'warn').length
  const summary = failures > 0
    ? `Result: ${failures} failure${failures === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`
    : `Result: ready${warnings > 0 ? ` with ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}`
  return {
    code: failures > 0 ? 1 : 0,
    output: ['KeepIndex doctor', ...checks.map(doctorLine), summary, ''].join('\n'),
  }
}

export async function runCli(argv: string[], dependencies: CliDependencies = {}): Promise<number> {
  const writeOut = dependencies.writeOut ?? ((text) => process.stdout.write(text))
  const writeErr = dependencies.writeErr ?? ((text) => process.stderr.write(text))
  const env = dependencies.env ?? process.env
  const cwd = dependencies.cwd ?? process.cwd()
  const platform = dependencies.platform ?? process.platform
  const fetcher = dependencies.fetch ?? fetch

  let parsed: ParsedCliArgs
  try {
    parsed = parseCliArgs(argv)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid arguments'
    writeErr(`keepidx: ${message}\nRun "keepidx help" for usage.\n`)
    return 2
  }

  if (parsed.command === 'help') {
    writeOut(helpText(parsed.helpTarget))
    return 0
  }
  if (parsed.command === 'version') {
    writeOut(`keepidx ${KEEPINDEX_VERSION}\n`)
    return 0
  }

  if (parsed.command === 'doctor') {
    const result = await runDoctor(parsed, dependencies, env, cwd, fetcher)
    writeOut(result.output)
    return result.code
  }

  let appUrl: string
  try {
    appUrl = resolveKeepIndexUrl(parsed.url, env)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid KeepIndex URL'
    writeErr(`keepidx: ${message}\n`)
    return 2
  }

  if (parsed.command === 'status') {
    try {
      const response = await fetchWithTimeout(fetcher, appendEndpoint(appUrl, '/api/health'))
      if (!response.ok) {
        if (parsed.json) {
          writeOut(`${JSON.stringify({ error: 'health-request-failed', statusCode: response.status, url: appUrl })}\n`)
        } else {
          writeErr(`keepidx: KeepIndex health request failed with HTTP ${response.status}\n`)
        }
        return 1
      }
      const status = shapeHealthStatus(await response.json(), appUrl)
      writeOut(parsed.json ? `${JSON.stringify(status)}\n` : formatPlainStatus(status))
      return 0
    } catch {
      if (parsed.json) {
        writeOut(`${JSON.stringify({ error: 'unreachable', url: appUrl })}\n`)
      } else {
        writeErr(`keepidx: cannot reach KeepIndex at ${safeUrlForDisplay(appUrl)}\n`)
      }
      return 1
    }
  }

  if (parsed.command === 'open') {
    const opened = await (dependencies.openUrl ?? defaultOpenUrl)(appUrl, platform)
    if (opened) {
      writeOut(`Opened ${safeUrlForDisplay(appUrl)}\n`)
    } else {
      writeOut(`${safeUrlForDisplay(appUrl)}\n`)
    }
    return 0
  }

  const commandVersion = dependencies.commandVersion ?? defaultCommandVersion
  if (!commandVersion('docker', ['--version']).ok) {
    writeErr('keepidx: Docker is required. Install Docker Desktop or Docker Engine and try again.\n')
    return 127
  }
  if (!commandVersion('docker', ['compose', 'version']).ok) {
    writeErr('keepidx: the Docker Compose plugin is required (docker compose).\n')
    return 127
  }
  if (!commandVersion('docker', ['info', '--format', '{{.ServerVersion}}']).ok) {
    writeErr('keepidx: Docker is installed, but its daemon is not available.\n')
    return 1
  }
  writeOut(`Starting KeepIndex at ${safeUrlForDisplay(appUrl)}\n`)
  writeOut(parsed.detach ? 'Containers will continue in the background.\n' : 'Press Ctrl+C to stop the KeepIndex stack.\n')
  const projectRoot = dependencies.projectRoot ?? defaultProjectRoot()
  const exitCode = await (dependencies.runCompose ?? defaultRunCompose)(projectRoot, parsed.detach)
  if (exitCode !== 0 && exitCode !== 130 && exitCode !== 143) {
    writeErr(`keepidx: Docker Compose exited with status ${exitCode}\n`)
  }
  return exitCode
}
