import { describe, expect, it } from 'bun:test'
import {
  LocalInferenceTransport,
  getInferenceResponseModel,
} from './inference-adapter'
import { resolveInferenceAdapter } from './inference-endpoint-policy'

type FetchCall = { url: string; init?: RequestInit }

function fetchStub(
  handler: (url: string, init: RequestInit | undefined, index: number) => Response | Promise<Response>
): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const fetchImpl = (async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, init })
    return handler(url, init, calls.length - 1)
  }) as typeof fetch
  return { fetchImpl, calls }
}

function request(overrides: Partial<Parameters<LocalInferenceTransport['chat']>[0]> = {}) {
  return {
    model: 'requested-model:latest',
    messages: [
      { role: 'system' as const, content: 'Answer privately.' },
      { role: 'user' as const, content: 'What is indexed?' },
    ],
    stream: false,
    temperature: 0.2,
    maxTokens: 256,
    chatTemplateKwargs: { enable_thinking: false },
    signal: AbortSignal.timeout(5_000),
    ...overrides,
  }
}

describe('native Ollama model discovery', () => {
  it('normalizes /api/tags into the existing model catalog', async () => {
    const mock = fetchStub(() => Response.json({
      models: [{
        name: 'local-model:8b',
        model: 'local-model:8b',
        details: {
          family: 'local-transformer',
          families: ['local-decoder'],
          parameter_size: '8.2B',
          quantization_level: 'Q4_K_M',
        },
      }],
    }))
    const transport = new LocalInferenceTransport(
      'http://ollama:11434',
      resolveInferenceAdapter({ KEEPINDEX_INFERENCE_PROVIDER: 'ollama' }),
      mock.fetchImpl
    )

    const response = await transport.models(AbortSignal.timeout(5_000))
    const payload = await response.json() as {
      data: Array<{ id: string; aliases: string[]; tags: string[] }>
    }

    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0]?.url).toBe('http://ollama:11434/api/tags')
    expect(mock.calls[0]?.init?.redirect).toBe('error')
    expect(payload.data).toEqual([{
      id: 'local-model:8b',
      aliases: [],
      tags: ['local-transformer', 'local-decoder', '8.2B', 'Q4_K_M'],
    }])
  })

  it('returns a deterministic gateway failure for malformed discovery JSON', async () => {
    const transport = new LocalInferenceTransport(
      'http://ollama:11434',
      resolveInferenceAdapter({ KEEPINDEX_INFERENCE_PROVIDER: 'ollama' }),
      (async () => new Response('{not json', { status: 200 })) as typeof fetch
    )

    const response = await transport.models(AbortSignal.timeout(5_000))
    expect(response.status).toBe(502)
    expect(response.statusText).toBe('Invalid local Ollama response')
  })
})

describe('native Ollama completion translation', () => {
  it('normalizes a non-streaming answer, usage, timing, and actual model without reasoning', async () => {
    const mock = fetchStub(() => Response.json({
      model: 'local-model:8b-q4_K_M',
      message: {
        role: 'assistant',
        content: 'The private index contains three sources.',
        thinking: 'This must remain private and absent from output.',
      },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 12,
      prompt_eval_duration: 600_000_000,
      eval_count: 8,
      eval_duration: 400_000_000,
    }))
    const transport = new LocalInferenceTransport(
      'http://ollama:11434',
      resolveInferenceAdapter({ KEEPINDEX_INFERENCE_PROVIDER: 'ollama' }),
      mock.fetchImpl
    )

    const response = await transport.chat(request())
    const serialized = await response.text()
    const payload = JSON.parse(serialized) as {
      choices: Array<{ message: { content: string }; finish_reason: string }>
      usage: Record<string, number>
      timings: Record<string, number>
    }
    const sent = JSON.parse(String(mock.calls[0]?.init?.body)) as Record<string, unknown>

    expect(mock.calls[0]?.url).toBe('http://ollama:11434/api/chat')
    expect(mock.calls[0]?.init?.redirect).toBe('error')
    expect(sent).toMatchObject({
      model: 'requested-model:latest',
      stream: false,
      think: false,
      options: { temperature: 0.2, num_predict: 256 },
    })
    expect(sent).not.toHaveProperty('chat_template_kwargs')
    expect(payload.choices[0]).toEqual({
      message: { role: 'assistant', content: 'The private index contains three sources.' },
      finish_reason: 'stop',
    })
    expect(payload.usage).toEqual({
      prompt_tokens: 12,
      completion_tokens: 8,
      total_tokens: 20,
    })
    expect(payload.timings.predicted_per_second).toBe(20)
    expect(serialized).not.toContain('This must remain private')
    expect(serialized).not.toContain('thinking')
    expect(getInferenceResponseModel(response)).toBe('local-model:8b-q4_K_M')
  })

  it('translates native NDJSON into bounded SSE frames and hides thinking', async () => {
    const nativeStream = [
      JSON.stringify({
        model: 'local-reasoning-model:8b',
        message: { role: 'assistant', content: '', thinking: 'private chain of thought' },
        done: false,
      }),
      JSON.stringify({
        model: 'local-reasoning-model:8b',
        message: { role: 'assistant', content: 'Grounded ' },
        done: false,
      }),
      JSON.stringify({
        model: 'local-reasoning-model:8b',
        message: { role: 'assistant', content: 'answer.' },
        done: true,
        done_reason: 'length',
        prompt_eval_count: 20,
        eval_count: 5,
        eval_duration: 250_000_000,
      }),
    ].join('\n') + '\n'
    const encoded = new TextEncoder().encode(nativeStream)
    const splitBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 37))
        controller.enqueue(encoded.slice(37, 143))
        controller.enqueue(encoded.slice(143))
        controller.close()
      },
    })
    const transport = new LocalInferenceTransport(
      'http://ollama:11434',
      resolveInferenceAdapter({ KEEPINDEX_INFERENCE_PROVIDER: 'ollama' }),
      (async () => new Response(splitBody, {
        headers: { 'Content-Type': 'application/x-ndjson' },
      })) as typeof fetch
    )

    const response = await transport.chat(request({ stream: true }))
    const sse = await response.text()
    const frames = sse
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>)

    expect(response.headers.get('Content-Type')).toContain('text/event-stream')
    expect(frames).toHaveLength(2)
    expect(sse).toContain('Grounded ')
    expect(sse).toContain('answer.')
    expect(sse).not.toContain('private chain of thought')
    expect(sse).not.toContain('thinking')
    expect(frames[1]).toMatchObject({
      choices: [{ delta: { content: 'answer.' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
      timings: { predicted_n: 5, predicted_per_second: 20 },
    })
    expect(getInferenceResponseModel(response)).toBe('local-reasoning-model:8b')
  })

  it('propagates native stream error frames without exposing their text', async () => {
    const transport = new LocalInferenceTransport(
      'http://ollama:11434',
      resolveInferenceAdapter({ KEEPINDEX_INFERENCE_PROVIDER: 'ollama' }),
      (async () => new Response('{"error":"sensitive backend detail"}\n')) as typeof fetch
    )

    const response = await transport.chat(request({ stream: true }))
    await expect(response.text()).rejects.toThrow('Native Ollama stream reported an error')
  })

  it('preserves an HTTP failure status for existing failure handling', async () => {
    const transport = new LocalInferenceTransport(
      'http://ollama:11434',
      resolveInferenceAdapter({ KEEPINDEX_INFERENCE_PROVIDER: 'ollama' }),
      (async () => Response.json({ error: 'model unavailable' }, { status: 404 })) as typeof fetch
    )

    const response = await transport.chat(request())
    expect(response.status).toBe(404)
    expect(getInferenceResponseModel(response)).toBe('requested-model:latest')
  })

  it('fails closed when a non-streaming response is not terminal', async () => {
    const transport = new LocalInferenceTransport(
      'http://ollama:11434',
      resolveInferenceAdapter({ KEEPINDEX_INFERENCE_PROVIDER: 'ollama' }),
      (async () => Response.json({
        model: 'local-model:8b',
        message: { role: 'assistant', content: 'Partial output' },
        done: false,
      })) as typeof fetch
    )

    expect((await transport.chat(request())).status).toBe(502)
  })
})

describe('OpenAI-compatible actual-model observation', () => {
  it('adopts the server-reported model from a non-streaming JSON response', async () => {
    const transport = new LocalInferenceTransport(
      'http://llama:8080',
      resolveInferenceAdapter({ KEEPINDEX_INFERENCE_PROVIDER: 'openai-compatible' }),
      (async () => Response.json({
        model: 'served-model:q4',
        choices: [{ message: { role: 'assistant', content: 'Local answer.' } }],
      })) as typeof fetch
    )

    const response = await transport.chat(request({ model: 'requested-model:q8' }))
    expect(getInferenceResponseModel(response)).toBe('requested-model:q8')
    const payload = await response.json() as { model: string; choices: unknown[] }

    expect(payload.model).toBe('served-model:q4')
    expect(payload.choices).toHaveLength(1)
    expect(getInferenceResponseModel(response)).toBe('served-model:q4')
  })

  it('adopts the server-reported model from fragmented SSE without changing frames', async () => {
    const source = [
      `data: ${JSON.stringify({
        model: 'served-stream-model:q5',
        choices: [{ delta: { content: 'Grounded answer.' } }],
      })}`,
      '',
      `data: ${JSON.stringify({
        model: 'served-stream-model:q5',
        choices: [{ delta: {}, finish_reason: 'stop' }],
      })}`,
      '',
    ].join('\n')
    const encoded = new TextEncoder().encode(source)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 19))
        controller.enqueue(encoded.slice(19, 83))
        controller.enqueue(encoded.slice(83))
        controller.close()
      },
    })
    const transport = new LocalInferenceTransport(
      'http://llama:8080',
      resolveInferenceAdapter({ KEEPINDEX_INFERENCE_PROVIDER: 'openai-compatible' }),
      (async () => new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
      })) as typeof fetch
    )

    const response = await transport.chat(request({ stream: true, model: 'requested-stream-model:q8' }))
    expect(getInferenceResponseModel(response)).toBe('requested-stream-model:q8')
    expect(await response.text()).toBe(source)
    expect(getInferenceResponseModel(response)).toBe('served-stream-model:q5')
  })
})

describe('automatic local adapter probing', () => {
  it('re-applies the local-only URL policy at the transport boundary', () => {
    expect(() => new LocalInferenceTransport(
      'https://api.openai.com/v1',
      resolveInferenceAdapter({}),
      (async () => new Response()) as typeof fetch
    )).toThrow('known-cloud-host')
  })

  it('probes OpenAI-compatible discovery first, then pins native Ollama', async () => {
    const mock = fetchStub((url) => {
      if (url.endsWith('/v1/models')) return new Response(null, { status: 404 })
      if (url.endsWith('/api/tags')) {
        return Response.json({ models: [{ name: 'local-model:3b', model: 'local-model:3b' }] })
      }
      if (url.endsWith('/api/chat')) {
        return Response.json({
          model: 'local-model:3b',
          message: { role: 'assistant', content: 'Local answer.' },
          done: true,
          done_reason: 'stop',
        })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    const transport = new LocalInferenceTransport(
      'http://local-model:11434',
      resolveInferenceAdapter({}),
      mock.fetchImpl
    )

    const models = await transport.models(AbortSignal.timeout(5_000))
    expect(models.ok).toBe(true)
    expect(transport.adapter.kind).toBe('ollama')
    const completion = await transport.chat(request({ model: 'local-model:3b' }))
    expect(completion.ok).toBe(true)
    expect(mock.calls.map((call) => call.url)).toEqual([
      'http://local-model:11434/v1/models',
      'http://local-model:11434/api/tags',
      'http://local-model:11434/api/chat',
    ])
    expect(mock.calls.every((call) => call.init?.redirect === 'error')).toBe(true)
  })

  it('falls back on an absent OpenAI-compatible chat endpoint but not a server error', async () => {
    const absent = fetchStub((url) => url.endsWith('/v1/chat/completions')
      ? new Response(null, { status: 404 })
      : Response.json({
          model: 'native:latest',
          message: { role: 'assistant', content: 'Native fallback.' },
          done: true,
        }))
    const fallbackTransport = new LocalInferenceTransport(
      'http://local-model:11434',
      resolveInferenceAdapter({}),
      absent.fetchImpl
    )
    expect((await fallbackTransport.chat(request())).ok).toBe(true)
    expect(fallbackTransport.adapter.kind).toBe('ollama')
    expect(absent.calls).toHaveLength(2)

    const failed = fetchStub(() => new Response(null, { status: 503 }))
    const boundedTransport = new LocalInferenceTransport(
      'http://local-model:11434',
      resolveInferenceAdapter({}),
      failed.fetchImpl
    )
    expect((await boundedTransport.chat(request())).status).toBe(503)
    expect(failed.calls).toHaveLength(1)
    expect(boundedTransport.adapter.kind).toBe('openai-compatible')
  })

  it('forwards Authorization Bearer header when apiKey is configured', async () => {
    const mock = fetchStub((url) => {
      if (url.endsWith('/v1/models')) return Response.json({ data: [{ id: 'test-model' }] })
      return Response.json({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 123456,
        model: 'test-model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'hello' } }],
      })
    })

    const authenticated = new LocalInferenceTransport(
      'http://100.124.181.9:4000',
      resolveInferenceAdapter({ KEEPINDEX_INFERENCE_PROVIDER: 'openai-compatible' }),
      mock.fetchImpl,
      '  secret-blade-token  '
    )

    await authenticated.models(AbortSignal.timeout(2000))
    expect(mock.calls[0]?.init?.headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer secret-blade-token',
    })

    await authenticated.chat(request())
    expect(mock.calls[1]?.init?.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret-blade-token',
    })
  })

  it('omits Authorization header when apiKey is omitted', async () => {
    const mock = fetchStub(() => Response.json({ data: [] }))
    const unauthenticated = new LocalInferenceTransport(
      'http://127.0.0.1:8080',
      resolveInferenceAdapter({ KEEPINDEX_INFERENCE_PROVIDER: 'openai-compatible' }),
      mock.fetchImpl
    )
    await unauthenticated.models(AbortSignal.timeout(2000))
    expect(mock.calls[0]?.init?.headers).toEqual({
      Accept: 'application/json',
    })
  })
})

