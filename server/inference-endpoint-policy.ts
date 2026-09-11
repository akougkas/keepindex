import type { Environment } from './environment'

export type InferenceProviderRequest = 'auto' | 'openai-compatible' | 'ollama'

export type OpenAiCompatibleInferenceAdapter = {
  kind: 'openai-compatible'
  requested: 'auto' | 'openai-compatible'
  modelsPath: '/v1/models'
  chatCompletionsPath: '/v1/chat/completions'
  optionalSlotsPath: '/slots'
}

export type OllamaInferenceAdapter = {
  kind: 'ollama'
  requested: 'ollama'
  modelsPath: '/api/tags'
  chatCompletionsPath: '/api/chat'
  optionalSlotsPath: null
}

export type InferenceAdapter = OpenAiCompatibleInferenceAdapter | OllamaInferenceAdapter

export const OPENAI_COMPATIBLE_INFERENCE_ADAPTER: OpenAiCompatibleInferenceAdapter = {
  kind: 'openai-compatible',
  requested: 'openai-compatible',
  modelsPath: '/v1/models',
  chatCompletionsPath: '/v1/chat/completions',
  optionalSlotsPath: '/slots',
}

export const AUTO_INFERENCE_ADAPTER: OpenAiCompatibleInferenceAdapter = {
  ...OPENAI_COMPATIBLE_INFERENCE_ADAPTER,
  requested: 'auto',
}

export const OLLAMA_INFERENCE_ADAPTER: OllamaInferenceAdapter = {
  kind: 'ollama',
  requested: 'ollama',
  modelsPath: '/api/tags',
  chatCompletionsPath: '/api/chat',
  optionalSlotsPath: null,
}

/** Prevent a permitted local endpoint from redirecting a prompt to the web. */
export const LOCAL_INFERENCE_REDIRECT_POLICY = 'error' as const

export type InferenceEndpointDecision =
  | { allowed: true; url: string; hostname: string }
  | {
      allowed: false
      reason:
        | 'invalid-url'
        | 'unsupported-protocol'
        | 'credentials-forbidden'
        | 'query-or-fragment-forbidden'
    }

/** Validate a user-configured inference URL without restricting the provider location.
 * Endpoint selection is explicit; redirects and credentials in URLs stay forbidden.
 */
export function inspectInferenceEndpoint(input: string): InferenceEndpointDecision {
  let endpoint: URL
  try {
    endpoint = new URL(input)
  } catch {
    return { allowed: false, reason: 'invalid-url' }
  }

  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    return { allowed: false, reason: 'unsupported-protocol' }
  }
  if (endpoint.username || endpoint.password) {
    return { allowed: false, reason: 'credentials-forbidden' }
  }
  if (endpoint.search || endpoint.hash) {
    return { allowed: false, reason: 'query-or-fragment-forbidden' }
  }

  const hostname = endpoint.hostname
  const pathname = endpoint.pathname === '/'
    ? ''
    : endpoint.pathname.replace(/\/+$/, '')
  return { allowed: true, url: `${endpoint.origin}${pathname}`, hostname }
}

export function requireInferenceEndpoint(input: string): string {
  const decision = inspectInferenceEndpoint(input)
  if (decision.allowed) return decision.url
  // Deliberately omit the configured value: it may contain sensitive material
  // even though embedded credentials are rejected above.
  throw new Error(
    `Inference endpoint must be a valid HTTP(S) URL (${decision.reason}). `
    + 'Set authentication with an API key, not in the URL.'
  )
}

/**
 * Resolves the configured local transport. Auto starts with the broadly
 * supported OpenAI-compatible protocol and may fall back to native Ollama
 * after a bounded endpoint probe.
 */
export function resolveInferenceAdapter(
  environment: Environment = process.env
): InferenceAdapter {
  const requested = environment.KEEPINDEX_INFERENCE_PROVIDER?.trim().toLowerCase() || 'auto'
  if (requested === 'auto') return AUTO_INFERENCE_ADAPTER
  if (requested === 'openai-compatible') return OPENAI_COMPATIBLE_INFERENCE_ADAPTER
  if (requested === 'ollama') return OLLAMA_INFERENCE_ADAPTER
  throw new Error(
    'KEEPINDEX_INFERENCE_PROVIDER must be auto, openai-compatible, or ollama.'
  )
}
