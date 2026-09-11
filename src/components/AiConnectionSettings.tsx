import { useCallback, useEffect, useState } from 'react'
import { Cpu, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSettingsStore, type AiConnectionSummary } from '@/stores/settings-store'

type Connection = AiConnectionSummary & {
  provider: 'auto' | 'openai-compatible' | 'ollama'
  hasApiKey: boolean; available?: boolean; modelCount: number
}
type Catalog = { activeId: string; connections: Connection[]; error?: string }

export function AiConnectionSettings({ onChange }: { onChange: () => void }) {
  const [catalog, setCatalog] = useState<Catalog>({ activeId: '', connections: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [provider, setProvider] = useState<Connection['provider']>('openai-compatible')
  const [apiKey, setApiKey] = useState('')
  const [removeKey, setRemoveKey] = useState(false)
  const active = catalog.connections.find(c => c.id === catalog.activeId)

  const request = useCallback(async (path: string, body?: object, method?: string) => {
    const response = await fetch(path, { method: method ?? (body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const data = await response.json() as Catalog
    if (!response.ok) throw new Error(data.error || 'Could not update AI connections.')
    setCatalog(data)
    return data
  }, [])

  useEffect(() => { void request('/api/ai/connections').catch(e => setError(String(e.message))) }, [request])

  const act = async (work: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : 'Connection request failed.') }
    finally { setBusy(false) }
  }
  const choose = (id: string) => act(async () => {
    await request('/api/ai/connections/select', { id })
    useSettingsStore.setState({ selectedModel: '', availableModels: [], aiConnection: null })
    await useSettingsStore.getState().fetchModels()
    onChange()
  })
  const edit = (connection?: Connection) => {
    setEditing(connection?.id ?? 'new'); setName(connection?.name ?? ''); setUrl(connection?.url ?? '')
    setProvider(connection?.provider ?? 'openai-compatible'); setApiKey(''); setRemoveKey(false)
  }

  return <Card>
    <CardHeader className="pb-2"><CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Cpu className="size-3.5 text-primary" /> AI connections</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <label className="block text-xs">Use this endpoint
        <select aria-label="AI endpoint" value={catalog.activeId} disabled={busy} onChange={event => void choose(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-muted/50 p-2 text-xs">
          {catalog.connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name} · {connection.scope === 'local' ? 'This computer' : 'Remote'}{connection.available === false ? ' · unavailable' : connection.available ? ` · ${connection.modelCount} models` : ''}</option>)}
        </select>
      </label>
      {active && <div className={`rounded-lg border p-2.5 text-xs leading-relaxed ${active.scope === 'remote' ? 'border-amber-600/40 bg-amber-500/5' : 'border-border bg-muted/30'}`}>
        <p className="font-medium">{active.scope === 'remote' ? 'Remote AI selected' : 'AI on this computer'}</p>
        <p className="mt-1 text-muted-foreground">{active.scope === 'remote' ? 'Prompts and retrieved excerpts are sent to this endpoint for AI processing. Your source files and index remain here.' : 'Prompts and retrieved excerpts go to this local runtime. KeepIndex does not switch to a remote endpoint automatically.'}</p>
        <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{active.url}</p>
      </div>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(async () => { await request('/api/ai/discover', {}) })}><RefreshCw className={`mr-1 size-3 ${busy ? 'animate-spin' : ''}`} /> Check endpoints</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => edit()}>Add endpoint</Button>
        <Button size="sm" variant="ghost" disabled={busy || !active} onClick={() => edit(active)}>Edit selected</Button>
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">Checks Lemonade, LM Studio, Ollama, llama.cpp, and your configured endpoints. It uses their public model APIs and never scans your network. Custom ports and compatible gateways can be added below.</p>
      {editing && <form className="space-y-2 border-t border-border pt-3" onSubmit={event => { event.preventDefault(); void act(async () => {
        const id = editing === 'new' ? undefined : editing
        await request('/api/ai/connections', { id, name, url, provider, ...(removeKey ? { apiKey: '' } : apiKey ? { apiKey } : {}) })
        setApiKey(''); setEditing(null)
        if (id === catalog.activeId) { useSettingsStore.setState({ selectedModel: '', availableModels: [] }); await useSettingsStore.getState().fetchModels(); onChange() }
      }) }}>
        <label className="block text-xs">Name<Input required value={name} onChange={e => setName(e.target.value)} placeholder="Blade AI Gateway" className="mt-1" /></label>
        <label className="block text-xs">Endpoint URL<Input required type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="http://host.docker.internal:13305/api" className="mt-1 font-mono text-xs" /></label>
        <label className="block text-xs">Protocol<select value={provider} onChange={e => setProvider(e.target.value as Connection['provider'])} className="mt-1 w-full rounded-lg border border-border bg-muted/50 p-2"><option value="openai-compatible">OpenAI-compatible (Lemonade, LM Studio, gateways)</option><option value="ollama">Native Ollama</option><option value="auto">Auto-detect</option></select></label>
        <label className="block text-xs">API key (optional)<Input type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={editing !== 'new' ? 'Leave blank to keep the key at the same URL' : 'Stored only in this installation'} className="mt-1" /></label>
        {editing !== 'new' && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={removeKey} onChange={e => setRemoveKey(e.target.checked)} /> Remove saved API key</label>}
        <p className="text-[10px] text-muted-foreground">Use the server root or its /v1 base URL. A remote endpoint receives prompts and evidence when selected. Saving a new endpoint does not select it.</p>
        <div className="flex gap-2"><Button size="sm" type="submit" disabled={busy}>Save endpoint</Button><Button size="sm" type="button" variant="ghost" disabled={busy} onClick={() => { setEditing(null); setApiKey('') }}>Cancel</Button></div>
      </form>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </CardContent>
  </Card>
}
