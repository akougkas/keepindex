import { AsyncLocalStorage } from 'node:async_hooks'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LocalInferenceTransport } from './inference-adapter'
import { requireInferenceEndpoint, resolveInferenceAdapter, type InferenceProviderRequest } from './inference-endpoint-policy'
import { isSameMachineService } from './local-service-policy'

export type ConnectionModel = { id: string; aliases: string[]; tags: string[]; isReasoning: boolean }
export type AiConnectionConfig = {
  id: string; name: string; url: string; provider: InferenceProviderRequest
  apiKey?: string; defaultModel?: string; fallbackModel?: string; embeddingModel?: string
}
export type AiConnection = AiConnectionConfig & {
  transport: LocalInferenceTransport; models: ConnectionModel[]; activeModel: string
}

function validateConfig(input: AiConnectionConfig): AiConnectionConfig {
  const url = requireInferenceEndpoint(input.url).replace(input.provider === 'ollama' ? /$^/ : /\/v1$/, '')
  resolveInferenceAdapter({ KEEPINDEX_INFERENCE_PROVIDER: input.provider })
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(input.id) || !input.name?.trim() || input.name.length > 100) {
    throw new Error('A connection needs a valid ID and a name of up to 100 characters.')
  }
  const bounded = (value: string | undefined, limit: number) => {
    if (value != null && (typeof value !== 'string' || value.length > limit || /[\r\n\0]/.test(value))) throw new Error('Invalid connection field.')
    return value?.trim() || undefined
  }
  return { id: input.id, name: input.name.trim(), url, provider: input.provider,
    apiKey: bounded(input.apiKey, 8192), defaultModel: bounded(input.defaultModel, 240),
    fallbackModel: bounded(input.fallbackModel, 240), embeddingModel: bounded(input.embeddingModel, 240) }
}

export function describeAiConnection(connection: AiConnection) {
  return { id: connection.id, name: connection.name, url: connection.url, provider: connection.provider,
    scope: isSameMachineService(new URL(connection.url).hostname, 'inference') ? 'local' as const : 'remote' as const,
    hasApiKey: Boolean(connection.apiKey), defaultModel: connection.defaultModel ?? '',
    embeddingModel: connection.embeddingModel ?? '', modelCount: connection.models.length }
}

export class AiConnections {
  private connections = new Map<string, AiConnection>()
  private activeId: string
  private readonly scope = new AsyncLocalStorage<AiConnection>()

  constructor(configs: AiConnectionConfig[], private readonly path?: string, private readonly fetchImpl?: typeof fetch) {
    let activeId = configs[0]?.id
    if (path && existsSync(path)) {
      try {
        const saved = JSON.parse(readFileSync(path, 'utf8')) as { connections: AiConnectionConfig[]; activeId: string }
        if (!Array.isArray(saved.connections) || saved.connections.length > 32) throw new Error('Invalid saved connections')
        configs = saved.connections
        activeId = saved.activeId
      } catch { throw new Error('Could not read the AI connections file. Check its JSON and file permissions.') }
    }
    for (const config of configs) this.connections.set(config.id, this.create(config))
    if (this.connections.size === 0) throw new Error('At least one AI connection is required.')
    this.activeId = this.connections.has(activeId) ? activeId : this.connections.keys().next().value!
  }

  private create(raw: AiConnectionConfig): AiConnection {
    const config = validateConfig(raw)
    return { ...config, transport: new LocalInferenceTransport(config.url,
      resolveInferenceAdapter({ KEEPINDEX_INFERENCE_PROVIDER: config.provider }), this.fetchImpl, config.apiKey),
      models: [], activeModel: config.defaultModel ?? '' }
  }

  private persist(connections = this.connections, activeId = this.activeId) {
    if (!this.path) return
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const configs = [...connections.values()].map(({ transport: _transport, models: _models, activeModel, ...config }) => ({ ...config, defaultModel: activeModel || config.defaultModel }))
    const temporary = `${this.path}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify({ version: 1, activeId, connections: configs }, null, 2) + '\n', { mode: 0o600 })
    renameSync(temporary, this.path)
  }

  current(): AiConnection { return this.scope.getStore() ?? this.connections.get(this.activeId)! }
  run<T>(callback: () => T): T { return this.scope.run(this.connections.get(this.activeId)!, callback) }
  list() { return { activeId: this.activeId, connections: [...this.connections.values()].map(describeAiConnection) } }
  get(id: string): AiConnection | undefined { return this.connections.get(id) }

  save(raw: AiConnectionConfig): void {
    if (!this.connections.has(raw.id) && this.connections.size >= 32) throw new Error('At most 32 AI connections are supported.')
    const connection = this.create(raw)
    const next = new Map(this.connections).set(connection.id, connection)
    this.persist(next)
    this.connections = next // Existing requests retain the previous immutable transport and credential pair.
  }

  select(id: string): void {
    if (!this.connections.has(id)) throw new Error('Unknown AI connection.')
    this.persist(this.connections, id)
    this.activeId = id
  }

  remove(id: string): void {
    if (id === this.activeId) throw new Error('Select another AI connection before removing this one.')
    const next = new Map(this.connections)
    next.delete(id)
    this.persist(next)
    this.connections = next
  }

  saveModel(): void { this.persist() }
}

export function defaultAiConnections(environment: Readonly<Record<string, string | undefined>> = process.env): AiConnectionConfig[] {
  const host = environment.KEEPINDEX_CONTAINER === '1' ? 'host.docker.internal' : '127.0.0.1'
  const defaults: AiConnectionConfig[] = [{
    id: 'configured', name: environment.KEEPINDEX_AI_NAME?.trim() || 'Configured AI endpoint',
    url: environment.LLM_URL || `http://${host}:8080`,
    provider: (environment.KEEPINDEX_INFERENCE_PROVIDER || 'auto') as InferenceProviderRequest,
    apiKey: environment.LLM_API_KEY, defaultModel: environment.LLM_MODEL,
    fallbackModel: environment.LLM_FALLBACK_MODEL, embeddingModel: environment.KEEPINDEX_EMBEDDING_MODEL,
  }]
  for (const [id, name, url, provider] of [
    ['lemonade', 'Lemonade', `http://${host}:13305/api`, 'openai-compatible'],
    ['lmstudio', 'LM Studio', `http://${host}:1234`, 'openai-compatible'],
    ['ollama', 'Ollama', `http://${host}:11434`, 'ollama'],
    ['llamacpp', 'llama.cpp', `http://${host}:8080`, 'openai-compatible'],
  ] as const) {
    if (!defaults.some((connection) => connection.url.replace(/\/$/, '') === url)) defaults.push({ id, name, url, provider })
  }
  return defaults
}

export function aiConnectionsPath(environment: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  if (environment.NODE_ENV === 'test') return undefined
  return environment.KEEPINDEX_AI_CONNECTIONS_PATH || resolve(dirname(environment.KEEPINDEX_DB_PATH || 'server/keepindex.sqlite'), 'ai-connections.json')
}
