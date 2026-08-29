import {
  LOCAL_INFERENCE_REDIRECT_POLICY,
  OLLAMA_INFERENCE_ADAPTER,
  OPENAI_COMPATIBLE_INFERENCE_ADAPTER,
  requireLocalInferenceEndpoint,
  type InferenceAdapter,
} from './inference-endpoint-policy'

export type InferenceMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type InferenceChatRequest = {
  messages: InferenceMessage[]
  model: string
  stream: boolean
  temperature?: number
  maxTokens?: number
  chatTemplateKwargs?: Record<string, unknown>
  signal: AbortSignal
}

const responseModels = new WeakMap<Response, string>()
const MAX_OLLAMA_NDJSON_LINE_CHARS = 2_000_000
const MAX_OPENAI_MODEL_OBSERVATION_CHARS = 2_000_000

export function getInferenceResponseModel(response: Response): string | undefined {
  return responseModels.get(response)
}

function nonNegativeMetric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function safeModelId(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 240)
  return normalized || fallback
}

function ollamaMetrics(record: Record<string, unknown>): {
  usage: Record<string, number>
  timings: Record<string, number>
} {
  const promptTokens = nonNegativeMetric(record.prompt_eval_count) ?? 0
  const outputTokens = nonNegativeMetric(record.eval_count) ?? 0
  const promptDurationNs = nonNegativeMetric(record.prompt_eval_duration)
  const outputDurationNs = nonNegativeMetric(record.eval_duration)
  const timings: Record<string, number> = {
    prompt_n: promptTokens,
    predicted_n: outputTokens,
  }
  if (promptDurationNs != null) timings.prompt_ms = promptDurationNs / 1_000_000
  if (outputDurationNs != null) {
    timings.predicted_ms = outputDurationNs / 1_000_000
    if (outputDurationNs > 0) {
      timings.predicted_per_second = outputTokens / (outputDurationNs / 1_000_000_000)
    }
  }
  return {
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: outputTokens,
      total_tokens: promptTokens + outputTokens,
    },
    timings,
  }
}

function safeOllamaFinishReason(record: Record<string, unknown>): string {
  const value = typeof record.done_reason === 'string'
    ? record.done_reason.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80)
    : ''
  return value || 'stop'
}

function responseHeaders(source: Response, contentType: string): Headers {
  const headers = new Headers(source.headers)
  headers.set('Content-Type', contentType)
  headers.delete('Content-Length')
  headers.delete('Content-Encoding')
  return headers
}

function passthroughResponseHeaders(source: Response): Headers {
  const headers = new Headers(source.headers)
  headers.delete('Content-Length')
  headers.delete('Content-Encoding')
  return headers
}

function modelFromOpenAiPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  return safeModelId((payload as Record<string, unknown>).model)
}

/**
 * Observes the local OpenAI-compatible response without changing its JSON/SSE
 * bytes. The server-reported `model` is authoritative when present; malformed
 * or oversized observation data simply retains the safe requested-model
 * fallback and never disrupts answer delivery.
 */
function observeOpenAiCompatibleChatResponse(
  response: Response,
  request: Pick<InferenceChatRequest, 'stream' | 'model'>
): Response {
  responseModels.set(response, request.model)
  if (!response.ok || !response.body) return response

  const decoder = new TextDecoder()
  let observation = ''
  let observationEnabled = true
  let observed: Response

  const adoptModel = (payload: unknown): void => {
    const model = modelFromOpenAiPayload(payload)
    if (model) responseModels.set(observed, model)
  }
  const parseSseLine = (line: string): void => {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line
    if (!normalized.startsWith('data:')) return
    const data = normalized.slice(5).trimStart()
    if (!data || data === '[DONE]') return
    try {
      adoptModel(JSON.parse(data) as unknown)
    } catch {
      // Model observation is metadata-only; the ordinary stream parser owns
      // malformed-frame handling and must see the original bytes unchanged.
    }
  }
  const observeSseText = (text: string, flush = false): void => {
    if (!observationEnabled) return
    observation += text
    if (observation.length > MAX_OPENAI_MODEL_OBSERVATION_CHARS) {
      observation = ''
      observationEnabled = false
      return
    }
    const lines = observation.split('\n')
    observation = flush ? '' : lines.pop() ?? ''
    for (const line of lines) parseSseLine(line)
    if (flush && observation) parseSseLine(observation)
  }

  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk)
      if (!observationEnabled) return
      const decoded = decoder.decode(chunk, { stream: true })
      if (request.stream) {
        observeSseText(decoded)
        return
      }
      observation += decoded
      if (observation.length > MAX_OPENAI_MODEL_OBSERVATION_CHARS) {
        observation = ''
        observationEnabled = false
      }
    },
    flush() {
      if (!observationEnabled) return
      const tail = decoder.decode()
      if (request.stream) {
        observeSseText(tail, true)
        return
      }
      observation += tail
      try {
        adoptModel(JSON.parse(observation) as unknown)
      } catch {
        // The caller retains the original malformed response and its existing
        // error behavior; only optional model metadata is ignored here.
      }
    },
  }))

  observed = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: passthroughResponseHeaders(response),
  })
  responseModels.set(observed, request.model)
  return observed
}

function invalidOllamaResponse(): Response {
  return new Response(null, { status: 502, statusText: 'Invalid local Ollama response' })
}

/** Convert `/api/tags` into the model catalog shape already used internally. */
export async function normalizeOllamaModelsResponse(response: Response): Promise<Response> {
  if (!response.ok) return response
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return invalidOllamaResponse()
  }
  const rows = payload && typeof payload === 'object' && Array.isArray((payload as { models?: unknown }).models)
    ? (payload as { models: unknown[] }).models
    : null
  if (!rows) return invalidOllamaResponse()

  const data = rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const record = row as Record<string, unknown>
    const idValue = typeof record.model === 'string' ? record.model : record.name
    const id = safeModelId(idValue)
    if (!id) return []
    const details = record.details && typeof record.details === 'object'
      ? record.details as Record<string, unknown>
      : null
    const tags = [
      details?.family,
      ...(Array.isArray(details?.families) ? details.families : []),
      details?.parameter_size,
      details?.quantization_level,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0)
    const aliases = typeof record.name === 'string' && record.name !== id ? [record.name] : []
    return [{ id, aliases, tags }]
  })

  return Response.json(
    { data },
    { status: response.status, headers: responseHeaders(response, 'application/json; charset=utf-8') }
  )
}

function ollamaChatPayload(request: InferenceChatRequest): Record<string, unknown> {
  const options: Record<string, number> = {}
  if (typeof request.temperature === 'number') options.temperature = request.temperature
  if (typeof request.maxTokens === 'number') options.num_predict = request.maxTokens
  return {
    model: request.model,
    messages: request.messages,
    stream: request.stream,
    // Keep native private reasoning out of browser streams and persisted state.
    // This is set even when a caller omitted llama.cpp's template-specific flag.
    think: false,
    ...(Object.keys(options).length > 0 ? { options } : {}),
  }
}

function normalizeOllamaCompletionPayload(
  payload: unknown,
  requestedModel: string
): { body: Record<string, unknown>; model: string } | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (typeof record.error === 'string' || record.done !== true) return null
  const message = record.message && typeof record.message === 'object'
    ? record.message as Record<string, unknown>
    : null
  const content = typeof message?.content === 'string' ? message.content : ''
  const model = safeModelId(record.model, requestedModel)
  const metrics = ollamaMetrics(record)
  return {
    model,
    body: {
      model,
      choices: [{
        message: { role: 'assistant', content },
        finish_reason: safeOllamaFinishReason(record),
      }],
      ...metrics,
    },
  }
}

/**
 * Converts native Ollama JSON/NDJSON into the OpenAI-compatible JSON/SSE shape
 * consumed by the existing bounded stream parser. `message.thinking` is
 * deliberately discarded and can never become a public `thinking_delta`.
 */
export async function normalizeOllamaChatResponse(
  response: Response,
  request: Pick<InferenceChatRequest, 'stream' | 'model'>
): Promise<Response> {
  if (!response.ok) {
    responseModels.set(response, request.model)
    return response
  }

  if (!request.stream) {
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return invalidOllamaResponse()
    }
    const normalized = normalizeOllamaCompletionPayload(payload, request.model)
    if (!normalized) return invalidOllamaResponse()
    const converted = Response.json(normalized.body, {
      status: response.status,
      headers: responseHeaders(response, 'application/json; charset=utf-8'),
    })
    responseModels.set(converted, normalized.model)
    return converted
  }

  if (!response.body) return invalidOllamaResponse()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  let converted: Response

  const encodeFrame = (record: Record<string, unknown>): Uint8Array | null => {
    if (typeof record.error === 'string') {
      throw new Error('Native Ollama stream reported an error')
    }
    const model = safeModelId(record.model, request.model)
    responseModels.set(converted, model)
    const message = record.message && typeof record.message === 'object'
      ? record.message as Record<string, unknown>
      : null
    const content = typeof message?.content === 'string' ? message.content : ''
    const done = record.done === true
    if (!content && !done) return null
    const payload: Record<string, unknown> = {
      model,
      choices: [{
        delta: content ? { content } : {},
        finish_reason: done ? safeOllamaFinishReason(record) : null,
      }],
    }
    if (done) Object.assign(payload, ollamaMetrics(record))
    return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
  }

  const parseLine = (line: string): Uint8Array | null => {
    const trimmed = line.trim()
    if (!trimmed) return null
    let record: Record<string, unknown>
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (!parsed || typeof parsed !== 'object') return null
      record = parsed as Record<string, unknown>
    } catch {
      // Ignore one malformed line; absence of a valid done frame is still
      // caught by the existing incomplete-stream gate.
      return null
    }
    return encodeFrame(record)
  }

  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      if (buffer.length > MAX_OLLAMA_NDJSON_LINE_CHARS && !buffer.includes('\n')) {
        throw new Error('Native Ollama stream frame exceeded the safety limit')
      }
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.length > MAX_OLLAMA_NDJSON_LINE_CHARS) {
          throw new Error('Native Ollama stream frame exceeded the safety limit')
        }
        const frame = parseLine(line)
        if (frame) controller.enqueue(frame)
      }
    },
    flush(controller) {
      buffer += decoder.decode()
      const frame = parseLine(buffer)
      if (frame) controller.enqueue(frame)
    },
  }))
  converted = new Response(body, {
    status: response.status,
    headers: responseHeaders(response, 'text/event-stream; charset=utf-8'),
  })
  responseModels.set(converted, request.model)
  return converted
}

function shouldProbeNativeOllama(response: Response): boolean {
  if (response.status === 405 || response.status === 415 || response.status === 501) return true
  if (response.status !== 404) return false
  // A JSON 404 from an OpenAI-compatible endpoint commonly means that one
  // requested model is absent, not that the protocol itself is unavailable.
  // Native probing is reserved for router-style/plain-text endpoint misses.
  return !response.headers.get('Content-Type')?.toLowerCase().includes('application/json')
}

export class LocalInferenceTransport {
  private readonly baseUrl: string
  private activeAdapter: InferenceAdapter
  private readonly automatic: boolean

  constructor(
    baseUrl: string,
    configuredAdapter: InferenceAdapter,
    private readonly fetchImpl?: typeof fetch
  ) {
    this.baseUrl = requireLocalInferenceEndpoint(baseUrl)
    this.activeAdapter = configuredAdapter.kind === 'ollama'
      ? OLLAMA_INFERENCE_ADAPTER
      : OPENAI_COMPATIBLE_INFERENCE_ADAPTER
    this.automatic = configuredAdapter.requested === 'auto'
  }

  get adapter(): InferenceAdapter {
    return this.activeAdapter
  }

  private fetch(url: string, init: RequestInit): Promise<Response> {
    return (this.fetchImpl ?? globalThis.fetch)(url, {
      ...init,
      redirect: LOCAL_INFERENCE_REDIRECT_POLICY,
    })
  }

  private async modelsWith(adapter: InferenceAdapter, signal: AbortSignal): Promise<Response> {
    const response = await this.fetch(`${this.baseUrl}${adapter.modelsPath}`, {
      signal,
      headers: { Accept: 'application/json' },
    })
    return adapter.kind === 'ollama' ? normalizeOllamaModelsResponse(response) : response
  }

  async models(signal: AbortSignal): Promise<Response> {
    if (!this.automatic || this.activeAdapter.kind === 'ollama') {
      return this.modelsWith(this.activeAdapter, signal)
    }

    let preferred: Response | null = null
    let preferredError: unknown = null
    try {
      preferred = await this.modelsWith(OPENAI_COMPATIBLE_INFERENCE_ADAPTER, signal)
      if (preferred.ok) return preferred
    } catch (error) {
      preferredError = error
    }

    try {
      const ollama = await this.modelsWith(OLLAMA_INFERENCE_ADAPTER, signal)
      if (ollama.ok) {
        if (preferred?.body) await preferred.body.cancel().catch(() => {})
        this.activeAdapter = OLLAMA_INFERENCE_ADAPTER
        return ollama
      }
      if (!preferred) return ollama
      if (ollama.body) await ollama.body.cancel().catch(() => {})
    } catch (error) {
      if (!preferred && preferredError == null) preferredError = error
    }

    if (preferred) return preferred
    throw preferredError instanceof Error ? preferredError : new Error('Local model discovery failed')
  }

  private async chatWith(adapter: InferenceAdapter, request: InferenceChatRequest): Promise<Response> {
    const openAiPayload: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      stream: request.stream,
      temperature: request.temperature,
    }
    if (typeof request.maxTokens === 'number') openAiPayload.max_tokens = request.maxTokens
    if (request.chatTemplateKwargs) openAiPayload.chat_template_kwargs = request.chatTemplateKwargs
    const response = await this.fetch(`${this.baseUrl}${adapter.chatCompletionsPath}`, {
      method: 'POST',
      signal: request.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(adapter.kind === 'ollama' ? ollamaChatPayload(request) : openAiPayload),
    })
    return adapter.kind === 'ollama'
      ? normalizeOllamaChatResponse(response, request)
      : observeOpenAiCompatibleChatResponse(response, request)
  }

  async chat(request: InferenceChatRequest): Promise<Response> {
    if (!this.automatic || this.activeAdapter.kind === 'ollama') {
      return this.chatWith(this.activeAdapter, request)
    }

    let preferred: Response | null = null
    let preferredError: unknown = null
    try {
      preferred = await this.chatWith(OPENAI_COMPATIBLE_INFERENCE_ADAPTER, request)
      if (preferred.ok || !shouldProbeNativeOllama(preferred)) return preferred
    } catch (error) {
      preferredError = error
    }

    try {
      const ollama = await this.chatWith(OLLAMA_INFERENCE_ADAPTER, request)
      if (ollama.ok) {
        if (preferred?.body) await preferred.body.cancel().catch(() => {})
        this.activeAdapter = OLLAMA_INFERENCE_ADAPTER
        return ollama
      }
      if (!preferred) return ollama
      if (ollama.body) await ollama.body.cancel().catch(() => {})
    } catch (error) {
      if (!preferred && preferredError == null) preferredError = error
    }

    if (preferred) return preferred
    throw preferredError instanceof Error ? preferredError : new Error('Local inference request failed')
  }
}
