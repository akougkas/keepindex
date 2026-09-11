import { afterEach, describe, expect, it } from 'bun:test'
import app, { __test__ } from './index'
import { InferenceModelLoadError, readModelLoadFailure } from './inference-failure'

const diffusionModel = 'diffusiongemma-26B-A4B-it-GGUF-Q4_K_M'
const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  __test__.setKnowledgeIndex([])
})

function failedLoad() {
  return Response.json({ error: {
    code: 'model_load_error', type: 'model_load_error',
    message: 'llama-server failed to start: C:\\private\\model.gguf; secret=DO_NOT_EXPOSE',
  } }, { status: 500 })
}

describe('model-load diagnostics', () => {
  it('explains diffusion runtime requirements without exposing backend logs', async () => {
    const error = await readModelLoadFailure(failedLoad(), diffusionModel)
    expect(error).toBeInstanceOf(InferenceModelLoadError)
    expect(error?.message).toContain(diffusionModel)
    expect(error?.message).toContain('diffusion-capable inference runtime')
    expect(error?.message).not.toContain('C:\\private')
    expect(error?.message).not.toContain('DO_NOT_EXPOSE')
  })

  it('recognizes architecture rejection from plain-text and native Ollama errors', async () => {
    for (const response of [
      new Response("unknown model architecture: 'diffusion-gemma'", { status: 500 }),
      Response.json({ error: 'failed to load model: unsupported model architecture' }, { status: 500 }),
    ]) {
      expect(await readModelLoadFailure(response, 'custom-model')).toBeInstanceOf(InferenceModelLoadError)
    }
  })

  it('preserves retry handling for unrelated HTTP failures', async () => {
    for (const response of [
      Response.json({ error: 'model unavailable' }, { status: 404 }),
      Response.json({ error: { code: 'rate_limit_exceeded' } }, { status: 429 }),
      new Response('Bad Gateway', { status: 502 }),
    ]) expect(await readModelLoadFailure(response, diffusionModel)).toBeNull()
  })

  it('bounds and cancels oversized upstream diagnostics', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(20_000)) },
      cancel() { cancelled = true },
    })
    expect(await readModelLoadFailure(new Response(body, { status: 500 }), diffusionModel)).toBeNull()
    expect(cancelled).toBe(true)
  })

  it('does not consume successful completions or block compatible diffusion endpoints', async () => {
    const response = Response.json({ choices: [{ message: { content: 'It works.' } }] })
    expect(await readModelLoadFailure(response, diffusionModel)).toBeNull()
    expect(await response.json()).toEqual({ choices: [{ message: { content: 'It works.' } }] })
  })
})

describe('terminal model failures through KeepIndex', () => {
  for (const endpoint of ['/api/chat/conversation', '/api/ask']) {
    it(`reports the failed model without retries or substitution in ${endpoint}`, async () => {
      const models: string[] = []
      __test__.setKnowledgeIndex([{
        id: 'vault:load-error', filePath: '/home/user/vault/saffron.md', fileName: 'saffron.md',
        content: 'Saffron calibration uses a reference temperature of 25 degrees.', startLine: 1, endLine: 1,
      }])
      globalThis.fetch = (async (input, init) => {
        const url = String(input)
        if (!url.includes('/v1/chat/completions')) throw new Error(`Unexpected request: ${url}`)
        models.push(JSON.parse(String(init?.body)).model)
        return failedLoad()
      }) as typeof fetch
      const requestId = `load-error-${crypto.randomUUID()}`
      const response = await app.request(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: diffusionModel, requestId,
          messages: [{ role: 'user', content: 'What is the saffron calibration temperature?' }],
          query: 'saffron calibration temperature', target: 'files' }),
      })
      const stream = await response.text()
      expect(models).toEqual([diffusionModel])
      expect(stream).toContain('"type":"error"')
      expect(stream).toContain('diffusion-capable inference runtime')
      expect(stream).toContain('No other model was used')
      expect(stream).not.toContain('DO_NOT_EXPOSE')
      expect(stream).not.toContain('"type":"delta"')
      expect(stream).not.toContain('"type":"done"')
      const recordResponse = await app.request(`/api/queries/${requestId}`)
      const record = await recordResponse.json() as { record: { outcome: string; actualModel: string | null } }
      expect(record.record.outcome).toBe('failed')
      expect(record.record.actualModel).toBeNull()
    })
  }

  it('continues to accept DiffusionGemma from a compatible endpoint', async () => {
    globalThis.fetch = (async () => new Response(
      `data: ${JSON.stringify({ model: diffusionModel, choices: [{ delta: { content: 'A compatible diffusion runtime answered.' } }] })}\n\n` +
      'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }
    )) as typeof fetch
    const response = await app.request('/api/chat/conversation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: diffusionModel, messages: [{ role: 'user', content: 'Hello' }] }),
    })
    const stream = await response.text()
    expect(stream).toContain('A compatible diffusion runtime answered.')
    expect(stream).toContain('"type":"done"')
    expect(stream).not.toContain('"type":"error"')
  })
})
