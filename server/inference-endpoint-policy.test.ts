import { describe, expect, it } from 'bun:test'
import {
  LOCAL_INFERENCE_REDIRECT_POLICY,
  inspectInferenceEndpoint,
  requireInferenceEndpoint,
  resolveInferenceAdapter,
} from './inference-endpoint-policy'

describe('configured inference endpoint policy', () => {
  it('requires fetch callers to reject redirects away from the local endpoint', () => {
    expect(LOCAL_INFERENCE_REDIRECT_POLICY).toBe('error')
  })

  const allowed = ['http://127.0.0.1:8080', 'http://localhost:8080/', 'http://llama:8080', 'http://llama_cpp:8080', 'http://host.docker.internal:8080', 'http://inference:8080', 'http://ollama:11434', 'http://[::1]:8080']

  for (const endpoint of allowed) {
    it(`allows ${endpoint}`, () => {
      expect(inspectInferenceEndpoint(endpoint).allowed).toBe(true)
    })
  }

  const rejected: Array<[string, string]> = [
    ['ftp://localhost/model', 'unsupported-protocol'],
    ['http://user:secret@localhost:8080', 'credentials-forbidden'],
    ['http://localhost:8080?token=secret', 'query-or-fragment-forbidden'],
    ['https://api.example.com/v1#secret', 'query-or-fragment-forbidden'],
    ['not-a-url', 'invalid-url'],
  ]
  for (const url of ['http://100.124.181.9:4000', 'http://192.168.1.20:8080', 'https://api.openai.com/v1', 'https://custom.example/v1']) {
    it(`accepts an explicitly configured remote endpoint ${url}`, () => expect(inspectInferenceEndpoint(url).allowed).toBe(true))
  }

  for (const [endpoint, reason] of rejected) {
    it(`rejects ${endpoint}`, () => {
      expect(inspectInferenceEndpoint(endpoint)).toMatchObject({ allowed: false, reason })
    })
  }

  it('normalizes a safe base URL without changing a configured path', () => {
    expect(requireInferenceEndpoint('http://localhost:8080/gateway/'))
      .toBe('http://localhost:8080/gateway')
  })

  it('does not echo a credential-bearing endpoint in its error', () => {
    expect(() => requireInferenceEndpoint('http://admin:very-secret@localhost:8080'))
      .toThrow('credentials-forbidden')
    try {
      requireInferenceEndpoint('http://admin:very-secret@localhost:8080')
    } catch (error) {
      expect(String(error)).not.toContain('very-secret')
      expect(String(error)).not.toContain('admin')
    }
  })
})

describe('inference adapter selection', () => {
  it('starts auto with the OpenAI-compatible adapter', () => {
    expect(resolveInferenceAdapter({})).toMatchObject({
      kind: 'openai-compatible',
      requested: 'auto',
    })
  })

  it('selects either explicit local transport', () => {
    expect(resolveInferenceAdapter({ KEEPINDEX_INFERENCE_PROVIDER: 'openai-compatible' }))
      .toMatchObject({ kind: 'openai-compatible', requested: 'openai-compatible' })
    expect(resolveInferenceAdapter({ KEEPINDEX_INFERENCE_PROVIDER: 'ollama' }))
      .toMatchObject({
        kind: 'ollama',
        requested: 'ollama',
        modelsPath: '/api/tags',
        chatCompletionsPath: '/api/chat',
      })
  })

  it('rejects unknown provider names', () => {
    expect(() => resolveInferenceAdapter({ KEEPINDEX_INFERENCE_PROVIDER: 'cloud' }))
      .toThrow('must be auto, openai-compatible, or ollama')
  })
})
