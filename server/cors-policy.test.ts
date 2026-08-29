/**
 * Cross-origin access to the private API.
 *
 * KeepIndex binds to 0.0.0.0 for homelab use and serves a user's vault, browser
 * history and search log with no authentication. `origin: '*'` therefore let any
 * page the user happened to be visiting read all of it from their own machine.
 *
 * The homelab access documented in the README stays intact: curl and other shell
 * clients send no Origin at all, and a browser opening the UI on any interface is
 * same-origin. Only a third-party page is refused.
 */
import { describe, expect, it } from 'bun:test'
import app from './index'

const LAN_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://192.168.1.41:5173',
  'http://10.0.0.7:5173',
  'http://172.16.4.9:5173',
  'http://[::1]:5173',
]

const FOREIGN_ORIGINS = [
  'https://evil.example',
  'http://evil.example',
  'https://keepindex.evil.example',
  'null',
  'https://127.0.0.1.evil.example',
  'https://localhost.evil.example',
]

function allowedOriginFor(headers: Headers): string | null {
  return headers.get('access-control-allow-origin')
}

describe('private API cross-origin policy', () => {
  it('never answers a third-party origin with a permissive wildcard', async () => {
    const response = await app.request('/api/health', {
      headers: { Origin: 'https://evil.example' },
    })
    expect(allowedOriginFor(response.headers)).not.toBe('*')
  })

  for (const origin of FOREIGN_ORIGINS) {
    it(`refuses cross-origin reads from ${origin}`, async () => {
      const response = await app.request('/api/health', { headers: { Origin: origin } })
      const allowed = allowedOriginFor(response.headers)
      expect(allowed === null || allowed === '' || allowed === undefined).toBe(true)
    })
  }

  for (const origin of LAN_ORIGINS) {
    it(`allows the local and homelab origin ${origin}`, async () => {
      const response = await app.request('/api/health', { headers: { Origin: origin } })
      expect(allowedOriginFor(response.headers)).toBe(origin)
    })
  }

  it('still serves a client that sends no Origin at all', async () => {
    const response = await app.request('/api/health')
    expect(response.status).toBe(200)
  })

  it('refuses a third-party preflight for a destructive method', async () => {
    const response = await app.request('/api/browser-history', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'DELETE',
      },
    })
    const allowed = allowedOriginFor(response.headers)
    expect(allowed === null || allowed === '' || allowed === undefined).toBe(true)
  })

  it('keeps the preflight working for a homelab origin', async () => {
    const response = await app.request('/api/search', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://192.168.1.41:5173',
        'Access-Control-Request-Method': 'POST',
      },
    })
    expect(allowedOriginFor(response.headers)).toBe('http://192.168.1.41:5173')
  })

  it('keeps the hardening response headers on every API route', async () => {
    const response = await app.request('/api/health')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('X-Frame-Options')).toBe('DENY')
  })
})
