import { isIP } from 'node:net'
import type { Environment } from './environment'

const LOCAL_HOST_SUFFIXES = ['.localhost', '.local', '.lan', '.internal', '.home.arpa'] as const
const KNOWN_CLOUD_HOST_SUFFIXES = [
  'openai.com',
  'anthropic.com',
  'googleapis.com',
  'google.com',
] as const

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
        | 'known-cloud-host'
        | 'public-host-forbidden'
    }

function hostnameWithoutBrackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
}

function isLocalOrSharedIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }
  const [first, second] = octets
  return first === 127
    || first === 10
    || (first === 172 && second! >= 16 && second! <= 31)
    || (first === 192 && second === 168)
    // RFC 6598 shared address space used by local Tailscale peers.
    || (first === 100 && second! >= 64 && second! <= 127)
}

function isLocalIpv6(hostname: string): boolean {
  if (hostname === '::1') return true
  const firstHextet = Number.parseInt(hostname.split(':', 1)[0] ?? '', 16)
  if (!Number.isFinite(firstHextet)) return false
  // fc00::/7 (unique local) and fe80::/10 (link-local).
  return (firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80
}

function matchesHostOrSubdomain(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`)
}

function isKnownCloudHost(hostname: string): boolean {
  return KNOWN_CLOUD_HOST_SUFFIXES.some((suffix) => matchesHostOrSubdomain(hostname, suffix))
}

function isAllowedLocalHostname(hostname: string): boolean {
  const ipVersion = isIP(hostname)
  if (ipVersion === 4) return isLocalOrSharedIpv4(hostname)
  if (ipVersion === 6) return isLocalIpv6(hostname)
  if (hostname === 'host.docker.internal') return true
  if (!hostname.includes('.')) return true
  return LOCAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
}

/**
 * Pure, DNS-free policy for the inference base URL. KeepIndex deliberately
 * permits only address forms whose names themselves establish local scope,
 * including RFC 6598 addresses used by Tailscale peers. Public DNS names are
 * never resolved and then trusted after the fact.
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

  const absoluteSingleLabel = endpoint.hostname.endsWith('.')
    && !hostnameWithoutBrackets(endpoint.hostname).includes('.')
  const hostname = hostnameWithoutBrackets(endpoint.hostname)
  if (isKnownCloudHost(hostname)) return { allowed: false, reason: 'known-cloud-host' }
  if (absoluteSingleLabel) return { allowed: false, reason: 'public-host-forbidden' }
  if (!isAllowedLocalHostname(hostname)) return { allowed: false, reason: 'public-host-forbidden' }

  const pathname = endpoint.pathname === '/'
    ? ''
    : endpoint.pathname.replace(/\/+$/, '')
  return { allowed: true, url: `${endpoint.origin}${pathname}`, hostname }
}

export function requireLocalInferenceEndpoint(input: string): string {
  const decision = inspectInferenceEndpoint(input)
  if (decision.allowed) return decision.url
  // Deliberately omit the configured value: it may contain sensitive material
  // even though embedded credentials are rejected above.
  throw new Error(
    `LLM_URL must identify a local inference server (${decision.reason}). `
    + 'Use loopback, RFC1918/Tailscale addressing, or a local/container hostname.'
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
