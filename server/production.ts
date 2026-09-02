import { resolve, sep } from 'node:path'
import app, { API_REQUEST_BODY_LIMIT_BYTES } from './index'

type BunFile = Blob & { exists(): Promise<boolean> }

declare const Bun: {
  file(path: string): BunFile
  serve(options: {
    hostname: string
    port: number
    maxRequestBodySize: number
    idleTimeout: number
    fetch(request: Request): Response | Promise<Response>
    error(error: Error): Response
  }): { hostname: string; port: number }
}

const STATIC_ROOT = resolve(process.env.KEEPINDEX_STATIC_DIR || resolve(process.cwd(), 'dist'))
const PORT = boundedPort(process.env.PORT, 5173)

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function boundedPort(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535 ? parsed : fallback
}

function extension(path: string): string {
  const match = /\.[a-z0-9]+$/i.exec(path)
  return match?.[0]?.toLowerCase() ?? ''
}

function staticHeaders(path: string): Headers {
  const headers = new Headers({
    'Content-Type': MIME_TYPES[extension(path)] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  })
  if (path.endsWith('/sw.js') || path.endsWith('/manifest.webmanifest') || path.endsWith('/index.html')) {
    headers.set('Cache-Control', 'no-cache')
  } else if (path.includes(`${sep}assets${sep}`)) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  } else {
    headers.set('Cache-Control', 'public, max-age=3600')
  }
  if (path.endsWith('/sw.js')) headers.set('Service-Worker-Allowed', '/')
  return headers
}

async function staticResponse(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
  }

  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname)
  } catch {
    return new Response('Bad Request', { status: 400 })
  }
  if (pathname.includes('\0')) return new Response('Bad Request', { status: 400 })

  const requested = pathname === '/' ? '/index.html' : pathname
  const candidate = resolve(STATIC_ROOT, `.${requested}`)
  const insideStaticRoot = candidate === STATIC_ROOT || candidate.startsWith(`${STATIC_ROOT}${sep}`)
  if (!insideStaticRoot) return new Response('Not Found', { status: 404 })

  let selected = candidate
  let file = Bun.file(selected)
  if (!(await file.exists())) {
    selected = resolve(STATIC_ROOT, 'index.html')
    file = Bun.file(selected)
    if (!(await file.exists())) return new Response('KeepIndex build is unavailable', { status: 503 })
  }
  const headers = staticHeaders(selected)
  return new Response(request.method === 'HEAD' ? null : file, { headers })
}

const server = Bun.serve({
  hostname: '0.0.0.0',
  port: PORT,
  // Hono returns the stable JSON 413 shape; this matching transport cap keeps a
  // production socket from buffering beyond the same public API budget first.
  maxRequestBodySize: API_REQUEST_BODY_LIMIT_BYTES,
  // Bun defaults idle sockets to 10 seconds. Citation repair and a busy local
  // inference server can legitimately produce no SSE bytes for longer than
  // that after the answer has streamed, which otherwise truncates HTTP chunked
  // encoding in the browser. Bun's supported maximum covers our 180s LLM wait.
  idleTimeout: 255,
  fetch(request) {
    const pathname = new URL(request.url).pathname
    if (pathname === '/api' || pathname.startsWith('/api/')) return app.fetch(request)
    return staticResponse(request)
  },
  error(error) {
    console.error('[keepindex-server]', error.message)
    return new Response('Internal Server Error', { status: 500 })
  },
})

console.log(`[keepindex-server] KeepIndex UI/API listening on http://${server.hostname}:${server.port}`)
