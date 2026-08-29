import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_KEEPINDEX_URL,
  KEEPINDEX_VERSION,
  composeSignalPolicy,
  formatPlainStatus,
  inspectDatabasePath,
  isPrivateInferenceUrl,
  parseCliArgs,
  resolveDatabasePath,
  resolveKeepIndexUrl,
  runCli,
  shapeHealthStatus,
} from '../cli'

function outputHarness() {
  let stdout = ''
  let stderr = ''
  return {
    writeOut(text: string) { stdout += text },
    writeErr(text: string) { stderr += text },
    stdout: () => stdout,
    stderr: () => stderr,
  }
}

const HEALTH_PAYLOAD = {
  status: 'degraded',
  healthScore: 70,
  searxng: true,
  llm: false,
  database: true,
  databasePath: '/data/keepindex.sqlite',
  persistence: 'sqlite-wal',
  knowledge: { resources: 2, unavailable: 1 },
  modelCount: 3,
  activeModel: 'local-model',
}

describe('keepidx argument parsing', () => {
  test('defaults to help and supports command help in both forms', () => {
    expect(parseCliArgs([])).toEqual({ command: 'help', url: undefined, json: false, detach: false })
    expect(parseCliArgs(['help', 'status']).helpTarget).toBe('status')
    expect(parseCliArgs(['status', '--help']).helpTarget).toBe('status')
  })

  test('parses status JSON and a URL before or after the command', () => {
    expect(parseCliArgs(['--url', 'http://localhost:9000', 'status', '--json'])).toEqual({
      command: 'status',
      url: 'http://localhost:9000',
      json: true,
      detach: false,
    })
    expect(parseCliArgs(['start', '--detach', '--url=http://localhost:9001'])).toEqual({
      command: 'start',
      url: 'http://localhost:9001',
      json: false,
      detach: true,
    })
  })

  test('rejects unknown commands, invalid option combinations, and missing values', () => {
    expect(() => parseCliArgs(['search'])).toThrow('unknown command')
    expect(() => parseCliArgs(['doctor', '--json'])).toThrow('--json is only valid with status')
    expect(() => parseCliArgs(['status', '--detach'])).toThrow('--detach is only valid with start')
    expect(() => parseCliArgs(['status', '--url'])).toThrow('--url requires a value')
  })
})

describe('keepidx configuration precedence and safety', () => {
  test('uses CLI override, KeepIndex environment, then localhost URL precedence', () => {
    const configured = { KEEPINDEX_URL: 'http://localhost:6100' }
    expect(resolveKeepIndexUrl('http://localhost:6000', configured)).toBe('http://localhost:6000')
    expect(resolveKeepIndexUrl(undefined, configured)).toBe('http://localhost:6100')
    expect(resolveKeepIndexUrl(undefined, { KEEPINDEX_URL: '   ' })).toBe(DEFAULT_KEEPINDEX_URL)
    expect(resolveKeepIndexUrl(undefined, {})).toBe(DEFAULT_KEEPINDEX_URL)
  })

  test('rejects URL credentials and public/cloud inference hosts', () => {
    expect(() => resolveKeepIndexUrl('http://person:secret@localhost:5173', {})).toThrow('credentials')
    expect(isPrivateInferenceUrl('http://127.0.0.1:8080')).toBe(true)
    expect(isPrivateInferenceUrl('http://192.168.1.20:8080')).toBe(true)
    expect(isPrivateInferenceUrl('http://100.64.12.8:8080')).toBe(true)
    expect(isPrivateInferenceUrl('http://host.docker.internal:8080')).toBe(true)
    expect(isPrivateInferenceUrl('http://llama.local:8080')).toBe(true)
    expect(isPrivateInferenceUrl('https://api.openai.com')).toBe(false)
    expect(isPrivateInferenceUrl('https://inference.example.com')).toBe(false)
  })

  test('uses only the canonical database setting and checks safe file targets', () => {
    const cwd = process.cwd()
    expect(resolveDatabasePath({
      KEEPINDEX_DB_PATH: 'server/current.sqlite',
    }, cwd)).toBe(`${cwd}/server/current.sqlite`)
    expect(resolveDatabasePath({}, cwd)).toBe(`${cwd}/server/keepindex.sqlite`)
    expect(inspectDatabasePath('/')).toEqual({
      ok: false,
      detail: 'must identify a database file, not a root or device path',
    })
    expect(inspectDatabasePath(`${cwd}/server/keepindex.txt`).ok).toBe(false)
    expect(inspectDatabasePath(`${cwd}/server/keepindex.sqlite`).ok).toBe(true)
  })
})

describe('keepidx status output', () => {
  test('shapes the existing health response deterministically', () => {
    const shaped = shapeHealthStatus(HEALTH_PAYLOAD, 'http://localhost:5173')
    expect(shaped).toEqual({
      status: 'degraded',
      url: 'http://localhost:5173',
      healthScore: 70,
      providers: { searxng: true, localInference: false },
      database: { available: true, path: '/data/keepindex.sqlite', persistence: 'sqlite-wal' },
      index: { resources: 2, unavailable: 1 },
      models: { active: 'local-model', count: 3 },
    })
    expect(formatPlainStatus(shaped)).toContain('SearXNG: ready\nLocal inference: unavailable')
  })

  test('status --json emits one stable object and uses /api/health', async () => {
    const output = outputHarness()
    let requestedUrl = ''
    const code = await runCli(['status', '--json'], {
      env: { KEEPINDEX_URL: 'http://localhost:7000/' },
      writeOut: output.writeOut,
      writeErr: output.writeErr,
      fetch: async (input) => {
        requestedUrl = String(input)
        return Response.json(HEALTH_PAYLOAD)
      },
    })
    expect(code).toBe(0)
    expect(requestedUrl).toBe('http://localhost:7000/api/health')
    expect(output.stderr()).toBe('')
    expect(JSON.parse(output.stdout())).toEqual(shapeHealthStatus(HEALTH_PAYLOAD, 'http://localhost:7000'))
    expect(output.stdout().split('\n')).toHaveLength(2)
  })

  test('status failures are concise and return a failure exit code', async () => {
    const output = outputHarness()
    const code = await runCli(['status'], {
      env: {},
      writeOut: output.writeOut,
      writeErr: output.writeErr,
      fetch: async () => { throw new Error('connection failed with token=do-not-print') },
    })
    expect(code).toBe(1)
    expect(output.stdout()).toBe('')
    expect(output.stderr()).toBe('keepidx: cannot reach KeepIndex at http://localhost:5173\n')
    expect(output.stderr()).not.toContain('do-not-print')
  })

  test('status --json keeps failure output machine-readable', async () => {
    const output = outputHarness()
    const code = await runCli(['status', '--json'], {
      env: {},
      writeOut: output.writeOut,
      writeErr: output.writeErr,
      fetch: async () => new Response('unavailable', { status: 503 }),
    })
    expect(code).toBe(1)
    expect(output.stderr()).toBe('')
    expect(JSON.parse(output.stdout())).toEqual({
      error: 'health-request-failed',
      statusCode: 503,
      url: 'http://localhost:5173',
    })
  })
})

describe('keepidx command behavior', () => {
  test('foreground Compose receives one graceful terminal signal', () => {
    expect(composeSignalPolicy('linux')).toEqual({
      detached: true,
      forwardInterrupt: true,
      signalProcessGroup: true,
    })
    expect(composeSignalPolicy('darwin')).toEqual({
      detached: true,
      forwardInterrupt: true,
      signalProcessGroup: true,
    })
    expect(composeSignalPolicy('win32')).toEqual({
      detached: false,
      forwardInterrupt: false,
      signalProcessGroup: false,
    })
  })

  test('help and version succeed without external services', async () => {
    const help = outputHarness()
    expect(await runCli(['help'], { writeOut: help.writeOut, writeErr: help.writeErr })).toBe(0)
    expect(help.stdout()).toContain('keepidx — KeepIndex local operations')

    const version = outputHarness()
    expect(await runCli(['version'], { writeOut: version.writeOut, writeErr: version.writeErr })).toBe(0)
    expect(version.stdout()).toBe(`keepidx ${KEEPINDEX_VERSION}\n`)
  })

  test('start delegates to Compose and preserves its failure exit code', async () => {
    const output = outputHarness()
    let detached: boolean | null = null
    const code = await runCli(['start', '--detach'], {
      env: {},
      projectRoot: '/project',
      writeOut: output.writeOut,
      writeErr: output.writeErr,
      commandVersion: () => ({ ok: true, detail: 'available' }),
      runCompose: async (root, isDetached) => {
        expect(root).toBe('/project')
        detached = isDetached
        return 9
      },
    })
    expect(detached).toBe(true)
    expect(code).toBe(9)
    expect(output.stderr()).toBe('keepidx: Docker Compose exited with status 9\n')
  })

  test('start fails actionably when the Docker daemon is unavailable', async () => {
    const output = outputHarness()
    let composeCalled = false
    const code = await runCli(['start'], {
      env: {},
      writeOut: output.writeOut,
      writeErr: output.writeErr,
      commandVersion: (_command, args) => ({ ok: args[0] !== 'info', detail: 'available' }),
      runCompose: async () => {
        composeCalled = true
        return 0
      },
    })
    expect(code).toBe(1)
    expect(composeCalled).toBe(false)
    expect(output.stderr()).toBe('keepidx: Docker is installed, but its daemon is not available.\n')
  })

  test('open prints the URL when no safe platform opener succeeds', async () => {
    const output = outputHarness()
    const code = await runCli(['open', '--url', 'http://localhost:8123'], {
      writeOut: output.writeOut,
      writeErr: output.writeErr,
      openUrl: async () => false,
    })
    expect(code).toBe(0)
    expect(output.stdout()).toBe('http://localhost:8123\n')
  })

  test('doctor fails a public inference endpoint without printing its path', async () => {
    const output = outputHarness()
    const code = await runCli(['doctor'], {
      env: { LLM_URL: 'https://api.example.com/secret-model' },
      cwd: process.cwd(),
      writeOut: output.writeOut,
      writeErr: output.writeErr,
      commandVersion: () => ({ ok: true, detail: 'available' }),
      probePort: async () => 'available',
      probeUrl: async () => false,
    })
    expect(code).toBe(1)
    expect(output.stdout()).toContain('[fail] Inference policy: LLM_URL must resolve to a local or private-network endpoint')
    expect(output.stdout()).not.toContain('secret-model')
  })

  test('doctor never prints rejected URL credentials', async () => {
    const output = outputHarness()
    const code = await runCli(['doctor'], {
      env: { LLM_URL: 'http://private-user:do-not-print@localhost:8080' },
      cwd: process.cwd(),
      writeOut: output.writeOut,
      writeErr: output.writeErr,
      commandVersion: () => ({ ok: true, detail: 'available' }),
      probePort: async () => 'available',
      probeUrl: async () => false,
    })
    expect(code).toBe(1)
    expect(output.stdout()).toContain('[fail] Inference URL: invalid private HTTP(S) endpoint')
    expect(output.stdout()).not.toContain('private-user')
    expect(output.stdout()).not.toContain('do-not-print')
  })

  test('doctor probes native Ollama at /api/tags', async () => {
    const output = outputHarness()
    const probes: string[] = []
    const code = await runCli(['doctor'], {
      env: {
        KEEPINDEX_INFERENCE_PROVIDER: 'ollama',
        LLM_URL: 'http://127.0.0.1:11434',
      },
      cwd: process.cwd(),
      writeOut: output.writeOut,
      writeErr: output.writeErr,
      commandVersion: () => ({ ok: true, detail: 'available' }),
      probePort: async () => 'available',
      probeUrl: async (url) => {
        probes.push(url)
        return url.endsWith('/api/tags')
      },
    })
    expect(code).toBe(0)
    expect(probes).toContain('http://127.0.0.1:11434/api/tags')
    expect(probes.some((url) => url.endsWith('/v1/models'))).toBe(false)
    expect(output.stdout()).toContain('[ok] Inference provider: ollama')
    expect(output.stdout()).toContain('[ok] Local inference: reachable')
  })

  test('doctor probes OpenAI-compatible servers at /v1/models', async () => {
    const output = outputHarness()
    const inferenceProbes: string[] = []
    const code = await runCli(['doctor'], {
      env: {
        KEEPINDEX_INFERENCE_PROVIDER: 'openai-compatible',
        LLM_URL: 'http://inference.local:8080',
      },
      cwd: process.cwd(),
      writeOut: output.writeOut,
      writeErr: output.writeErr,
      commandVersion: () => ({ ok: true, detail: 'available' }),
      probePort: async () => 'available',
      probeUrl: async (url) => {
        if (url.startsWith('http://inference.local:8080')) inferenceProbes.push(url)
        return url.endsWith('/v1/models')
      },
    })
    expect(code).toBe(0)
    expect(inferenceProbes).toEqual(['http://inference.local:8080/v1/models'])
    expect(output.stdout()).toContain('[ok] Inference provider: openai-compatible')
  })

  test('doctor auto-detects either bounded local inference protocol', async () => {
    const output = outputHarness()
    const probes: string[] = []
    const code = await runCli(['doctor'], {
      env: { KEEPINDEX_INFERENCE_PROVIDER: 'auto' },
      cwd: process.cwd(),
      writeOut: output.writeOut,
      writeErr: output.writeErr,
      commandVersion: () => ({ ok: true, detail: 'available' }),
      probePort: async () => 'available',
      probeUrl: async (url) => {
        probes.push(url)
        return url.endsWith('/api/tags')
      },
    })
    expect(code).toBe(0)
    expect(probes).toContain('http://127.0.0.1:8080/v1/models')
    expect(probes).toContain('http://127.0.0.1:8080/api/tags')
    expect(output.stdout()).toContain('[ok] Inference provider: auto (OpenAI-compatible or native Ollama)')
  })

  test('doctor rejects an unsupported inference provider deterministically', async () => {
    const output = outputHarness()
    const code = await runCli(['doctor'], {
      env: { KEEPINDEX_INFERENCE_PROVIDER: 'hosted-cloud' },
      cwd: process.cwd(),
      writeOut: output.writeOut,
      writeErr: output.writeErr,
      commandVersion: () => ({ ok: true, detail: 'available' }),
      probePort: async () => 'available',
      probeUrl: async () => false,
    })
    expect(code).toBe(1)
    expect(output.stdout()).toContain(
      '[fail] Inference provider: KEEPINDEX_INFERENCE_PROVIDER must be auto, openai-compatible, or ollama'
    )
    expect(output.stdout()).not.toContain('hosted-cloud')
  })

  test('unknown commands are usage errors with exit code 2', async () => {
    const output = outputHarness()
    const code = await runCli(['not-a-command'], {
      writeOut: output.writeOut,
      writeErr: output.writeErr,
    })
    expect(code).toBe(2)
    expect(output.stderr()).toContain('unknown command: not-a-command')
  })
})
