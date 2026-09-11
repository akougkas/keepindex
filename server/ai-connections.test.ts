import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AiConnections, defaultAiConnections } from './ai-connections'

const local = { id: 'lemonade', name: 'Lemonade', url: 'http://localhost:13305/api', provider: 'openai-compatible' as const }
const remote = { id: 'blade', name: 'Blade AI Gateway', url: 'http://100.124.181.9:4000', provider: 'openai-compatible' as const, apiKey: 'private-test-key' }

describe('AI connections', () => {
  it('lists endpoint scope and key presence without exposing credentials', () => {
    const registry = new AiConnections([local, remote])
    const list = registry.list()
    expect(list.connections.map(c => c.scope)).toEqual(['local', 'remote'])
    expect(list.connections[1].hasApiKey).toBe(true)
    expect(JSON.stringify(list)).not.toContain('private-test-key')
  })

  it('pins an active request to its original endpoint and credentials during a switch', async () => {
    const sent: Array<{ url: string; auth: string | null }> = []
    const mock = (async (input, init) => {
      sent.push({ url: String(input), auth: new Headers(init?.headers).get('Authorization') })
      return Response.json({ data: [{ id: 'model' }] })
    }) as typeof fetch
    const registry = new AiConnections([local, remote], undefined, mock)
    let resume!: () => void
    const gate = new Promise<void>(resolve => { resume = resolve })
    const pending = registry.run(async () => {
      await gate
      await registry.current().transport.models(AbortSignal.timeout(1000))
    })
    registry.select('blade')
    await registry.run(() => registry.current().transport.models(AbortSignal.timeout(1000)))
    resume()
    await pending
    expect(sent).toEqual([
      { url: 'http://100.124.181.9:4000/v1/models', auth: 'Bearer private-test-key' },
      { url: 'http://localhost:13305/api/v1/models', auth: null },
    ])
  })

  it('persists connection/model selection privately and reloads it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'keepindex-ai-'))
    try {
      const path = join(directory, 'ai-connections.json')
      const registry = new AiConnections([local, remote], path)
      registry.select('blade')
      registry.current().activeModel = 'dynamo/ornith'
      registry.saveModel()
      expect(statSync(path).mode & 0o777).toBe(0o600)
      const restored = new AiConnections([local], path)
      expect(restored.current().id).toBe('blade')
      expect(restored.current().activeModel).toBe('dynamo/ornith')
      expect(restored.current().apiKey).toBe('private-test-key')
      expect(readFileSync(path, 'utf8')).not.toContain('transport')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('uses public local runtime APIs, never ephemeral llama worker ports', () => {
    const profiles = defaultAiConnections({ KEEPINDEX_CONTAINER: '1' })
    expect(profiles.some(c => c.url === 'http://host.docker.internal:13305/api')).toBe(true)
    expect(profiles.some(c => c.url.includes(':8001') || c.url.includes(':8002'))).toBe(false)
    const registry = new AiConnections([{ ...local, url: 'http://localhost:13305/api/v1' }])
    expect(registry.current().url).toBe('http://localhost:13305/api')
  })

  it('does not switch on save or silently fall back to a different endpoint', () => {
    const registry = new AiConnections([local])
    registry.save(remote)
    expect(registry.current().id).toBe('lemonade')
    expect(() => registry.select('missing')).toThrow('Unknown')
    expect(registry.current().id).toBe('lemonade')
    expect(() => registry.remove('lemonade')).toThrow('Select another')
  })
})
