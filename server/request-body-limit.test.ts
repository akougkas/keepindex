import { describe, expect, it } from 'bun:test'
import app, { API_REQUEST_BODY_LIMIT_BYTES } from './index'

const LIMIT_ERROR = { error: 'request body exceeds the 3 MB safety limit' }

describe('API request body safety limit', () => {
  it('rejects an oversized body even when Content-Length is absent', async () => {
    const body = JSON.stringify({ padding: 'x'.repeat(API_REQUEST_BODY_LIMIT_BYTES) })
    const request = new Request('http://localhost/api/models/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    expect(request.headers.get('content-length')).toBeNull()
    const response = await app.fetch(request)

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual(LIMIT_ERROR)
  })

  it('counts a chunked stream instead of trusting request framing headers', async () => {
    const chunk = new Uint8Array(1_100_000).fill(0x78)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk)
        controller.enqueue(chunk)
        controller.enqueue(chunk)
        controller.close()
      },
    })
    const request = new Request('http://localhost/api/models/select', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked',
      },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })

    const response = await app.fetch(request)

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual(LIMIT_ERROR)
  })

  it('keeps the existing early JSON response for a declared oversized body', async () => {
    const response = await app.request('/api/models/select', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(API_REQUEST_BODY_LIMIT_BYTES + 1),
      },
      body: '{}',
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual(LIMIT_ERROR)
  })
})
