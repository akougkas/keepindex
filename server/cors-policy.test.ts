import { describe, expect, it } from 'bun:test'
import app from './index'
import { permitsLocalApiRequest, requireLocalSearchEndpoint } from './local-service-policy'

const local = 'http://localhost:5173'

describe('single-machine API boundary', () => {
  for (const origin of ['https://evil.example', 'null', 'http://192.168.1.41:5173', 'http://localhost:4321']) {
    it(`rejects writes and preflights from ${origin} before the handler`, async () => {
      for (const method of ['POST', 'OPTIONS']) {
        const response = await app.request(`${local}/api/models/select`, {
          method, headers: { Origin: origin, 'Content-Type': 'application/json' },
          ...(method === 'POST' ? { body: '{}' } : {}),
        })
        expect(response.status).toBe(403)
        expect(response.headers.get('access-control-allow-origin')).toBeNull()
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        expect(response.headers.get('X-Frame-Options')).toBe('DENY')
      }
    })
  }
  for (const url of [local, 'http://127.0.0.1:5173', 'http://[::1]:5173']) {
    it(`allows its same-origin browser at ${url}`, async () => {
      const response = await app.request(`${url}/api/models/select`, {
        method: 'OPTIONS', headers: { Origin: url, 'Access-Control-Request-Method': 'POST' },
      })
      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe(url)
    })
  }
  it('allows a local CLI but rejects DNS rebinding and conflicting Host headers', () => {
    expect(permitsLocalApiRequest(new Request(`${local}/api/health`))).toBe(true)
    expect(permitsLocalApiRequest(new Request('http://attacker.example/api/health'))).toBe(false)
    expect(permitsLocalApiRequest(new Request(local, { headers: { Host: 'attacker.example' } }))).toBe(false)
    expect(permitsLocalApiRequest(new Request(local, { headers: { 'Sec-Fetch-Site': 'cross-site' } }))).toBe(false)
  })
  it('permits an explicit local development origin without allowing remote exceptions', () => {
    const extras = new Set(['http://localhost:4321', 'https://keepindex.ing'])
    expect(permitsLocalApiRequest(new Request(local, { headers: { Origin: 'http://localhost:4321' } }), extras)).toBe(true)
    expect(permitsLocalApiRequest(new Request(local, { headers: { Origin: 'https://keepindex.ing' } }), extras)).toBe(false)
  })
})

describe('same-machine search provider', () => {
  it('accepts the bundled service and loopback, preserving a base path', () => {
    expect(requireLocalSearchEndpoint('http://searxng:8080/')).toBe('http://searxng:8080')
    expect(requireLocalSearchEndpoint('http://localhost:8888/search-base/')).toBe('http://localhost:8888/search-base')
  })
  for (const url of ['http://blade:8888', 'http://192.168.1.1:8888', 'https://search.example', 'http://u:secret@localhost:8888', 'http://localhost:8888?key=secret']) {
    it(`rejects a remote or credential-bearing search URL: ${url}`, () => {
      expect(() => requireLocalSearchEndpoint(url)).toThrow('same-machine')
    })
  }
})


describe('explicit browser-history selection', () => {
  for (const body of [{}, { paths: [] }, { paths: [42] }]) {
    it(`refuses import without selected profiles: ${JSON.stringify(body)}`, async () => {
      const response = await app.request(`${local}/api/browser-history/import`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      expect(response.status).toBe(400)
    })
  }
})
