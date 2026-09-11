import { isIP } from 'node:net'

/** These names describe this installation's Docker services, never LAN peers. */
const INFERENCE_SERVICES = new Set(['inference', 'llm', 'llama', 'llama_cpp', 'llama-server', 'ollama'])

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '::1'
    || (isIP(host) === 4 && host.startsWith('127.'))
}

export function isSameMachineService(hostname: string, service: 'inference' | 'search'): boolean {
  return isLoopbackHostname(hostname) || hostname === 'host.docker.internal'
    || (service === 'search' ? hostname === 'searxng' : INFERENCE_SERVICES.has(hostname))
}

export function requireLocalSearchEndpoint(input: string): string {
  let endpoint: URL
  try { endpoint = new URL(input) } catch { throw new Error('SEARXNG_URL must be a same-machine HTTP(S) endpoint.') }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password
    || endpoint.search || endpoint.hash || !isSameMachineService(endpoint.hostname, 'search')) {
    throw new Error('SEARXNG_URL must be a same-machine HTTP(S) endpoint without credentials, query, or fragment.')
  }
  return endpoint.toString().replace(/\/+$/, '')
}

/** Refuse foreign browser writes as well as reads; CORS headers alone do not. */
export function permitsLocalApiRequest(request: Request, extraOrigins: ReadonlySet<string> = new Set()): boolean {
  const target = new URL(request.url)
  if (!isLoopbackHostname(target.hostname)) return false
  // Honor Host explicitly too: native and proxy adapters can construct URLs differently.
  const host = request.headers.get('host')
  if (host && host.toLowerCase() !== target.host.toLowerCase()) return false
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = request.headers.get('origin')
  if (!origin) return true // Local CLI clients do not send a browser Origin.
  try {
    const source = new URL(origin)
    if (!['http:', 'https:'].includes(source.protocol) || !isLoopbackHostname(source.hostname)
      || origin !== source.origin) return false
    return origin === target.origin || extraOrigins.has(origin)
  } catch { return false }
}
