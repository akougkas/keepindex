import { describe, expect, it } from 'bun:test'
import {
  LOCAL_INFERENCE_REDIRECT_POLICY,
  inspectInferenceEndpoint,
  requireLocalInferenceEndpoint,
  resolveInferenceAdapter,
} from './inference-endpoint-policy'

describe('local-only inference endpoint policy', () => {
  it('requires fetch callers to reject redirects away from the local endpoint', () => {
    expect(LOCAL_INFERENCE_REDIRECT_POLICY).toBe('error')
  })

  const allowed = [
    'http://127.0.0.1:8080',
    'http://localhost:8080/',
    'http://llama:8080',
    'http://llama_cpp:8080',
    'http://host.docker.internal:8080',
    'https://inference.local:8443',
    'http://models.lan:8080',
    'http://inference.internal:8080',
    'http://inference.home.arpa:8080',
    'http://10.12.0.4:8080',
    'http://172.31.255.254:8080',
    'http://192.168.50.2:8080',
    'http://100.64.0.1:8080',
    'http://100.127.255.254:8080',
    'http://[::1]:8080',
    'http://[fd12:3456::8]:8080',
    'http://[fe80::8]:8080',
  ]

  for (const endpoint of allowed) {
    it(`allows ${endpoint}`, () => {
      expect(inspectInferenceEndpoint(endpoint).allowed).toBe(true)
    })
  }

  const rejected: Array<[string, string]> = [
    ['https://api.openai.com/v1', 'known-cloud-host'],
    ['https://api.anthropic.com', 'known-cloud-host'],
    ['https://generativelanguage.googleapis.com', 'known-cloud-host'],
    ['https://example.com', 'public-host-forbidden'],
    ['https://example.', 'public-host-forbidden'],
    ['http://8.8.8.8:8080', 'public-host-forbidden'],
    ['http://172.32.0.1:8080', 'public-host-forbidden'],
    ['http://169.254.2.3:8080', 'public-host-forbidden'],
    ['http://100.63.255.254:8080', 'public-host-forbidden'],
    ['http://100.128.0.1:8080', 'public-host-forbidden'],
    ['https://private-tailnet.ts.net', 'public-host-forbidden'],
    ['ftp://localhost/model', 'unsupported-protocol'],
    ['http://user:secret@localhost:8080', 'credentials-forbidden'],
    ['http://localhost:8080?token=secret', 'query-or-fragment-forbidden'],
  ]

  for (const [endpoint, reason] of rejected) {
    it(`rejects ${endpoint}`, () => {
      expect(inspectInferenceEndpoint(endpoint)).toMatchObject({ allowed: false, reason })
    })
  }

  it('normalizes a safe base URL without changing a configured path', () => {
    expect(requireLocalInferenceEndpoint('http://localhost:8080/gateway/'))
      .toBe('http://localhost:8080/gateway')
  })

  it('does not echo a credential-bearing endpoint in its error', () => {
    expect(() => requireLocalInferenceEndpoint('http://admin:very-secret@localhost:8080'))
      .toThrow('credentials-forbidden')
    try {
      requireLocalInferenceEndpoint('http://admin:very-secret@localhost:8080')
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
