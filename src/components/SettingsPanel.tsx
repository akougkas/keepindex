import { AiConnectionSettings } from './AiConnectionSettings'
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Activity,
  CheckCircle2,
  Cpu,
  Download,
  Gauge,
  Leaf,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useSettingsStore } from '@/stores/settings-store'
import { useSystemStore } from '@/stores/system-store'
import { useThemeStore } from '@/stores/theme-store'
import { COMPUTE_PROFILES, type ComputeProfile } from '@/lib/query-impact'
import {
  createStateBackup,
  downloadStateBackup,
  parseStateBackup,
  restoreStateBackup,
  type KeepIndexBackup,
} from '@/lib/state-backup'
import { cn } from '@/lib/utils'
import { collectionMutationQueue, sessionMutationQueue } from '@/lib/mutation-queue'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

const SHORTCUTS = [
  { key: '/', action: 'Focus omnibar' },
  { key: 'Enter', action: 'Ask across web + vault' },
  { key: 'Shift+Enter', action: 'Start deep research' },
  { key: 'Ctrl+K', action: 'Command palette' },
  { key: 'Ctrl+S', action: 'Save to collection' },
  { key: 'Ctrl+B', action: 'Open collections' },
  { key: 'Escape', action: 'Close / blur' },
]

function Toggle({ value, onChange, label }: { value: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={cn('relative h-6 w-11 rounded-full transition-colors', value ? 'bg-primary' : 'bg-muted')}
      role="switch"
      aria-checked={value}
      aria-label={label}
    >
      <span className={cn('absolute left-1 top-1 size-4 rounded-full bg-white transition-transform', value ? 'translate-x-5' : 'translate-x-0')} />
    </button>
  )
}

function HealthRow({ label, healthy, detail, pending }: { label: string; healthy?: boolean; detail: string; pending?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 p-2">
      <span className="font-medium">{label}</span>
      <span className={cn('flex items-center gap-1.5 font-mono text-[10px]', pending ? 'text-muted-foreground' : healthy ? 'text-primary' : 'text-destructive')}>
        {pending ? <RefreshCw className="size-3 animate-spin" /> : healthy ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
        {detail}
      </span>
    </div>
  )
}

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const importRef = useRef<HTMLInputElement>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [backupStatus, setBackupStatus] = useState<string | null>(null)
  const [pendingRestore, setPendingRestore] = useState<KeepIndexBackup | null>(null)
  const [isRestoring, setIsRestoring] = useState(false)

  const selectedModel = useSettingsStore((state) => state.selectedModel)
  const availableModels = useSettingsStore((state) => state.availableModels)
  const modelsError = useSettingsStore((state) => state.modelsError)
  const showThinking = useSettingsStore((state) => state.showThinking)
  const showQueryMetrics = useSettingsStore((state) => state.showQueryMetrics)
  const searchResultsCount = useSettingsStore((state) => state.searchResultsCount)
  const computeProfile = useSettingsStore((state) => state.computeProfile)
  const customPowerWatts = useSettingsStore((state) => state.customPowerWatts)
  const electricityRate = useSettingsStore((state) => state.electricityRateUsdPerKwh)
  const gridCarbon = useSettingsStore((state) => state.gridCarbonGramsPerKwh)
  const setSelectedModel = useSettingsStore((state) => state.setSelectedModel)
  const setShowThinking = useSettingsStore((state) => state.setShowThinking)
  const setShowQueryMetrics = useSettingsStore((state) => state.setShowQueryMetrics)
  const setSearchResultsCount = useSettingsStore((state) => state.setSearchResultsCount)
  const setComputeProfile = useSettingsStore((state) => state.setComputeProfile)
  const setCustomPowerWatts = useSettingsStore((state) => state.setCustomPowerWatts)
  const setElectricityRate = useSettingsStore((state) => state.setElectricityRate)
  const setGridCarbonIntensity = useSettingsStore((state) => state.setGridCarbonIntensity)
  const fetchModels = useSettingsStore((state) => state.fetchModels)
  const resetAll = useSettingsStore((state) => state.resetAll)

  const health = useSystemStore((state) => state.health)
  const healthError = useSystemStore((state) => state.healthError)
  const isCheckingHealth = useSystemStore((state) => state.isChecking)
  const checkHealth = useSystemStore((state) => state.checkHealth)
  const isDark = useThemeStore((state) => state.isDark)
  const toggleTheme = useThemeStore((state) => state.toggleTheme)

  useEffect(() => {
    if (!isOpen) return
    void checkHealth()
    void fetchModels()
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isRestoring) onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, checkHealth, fetchModels, isRestoring, onClose])

  const handleClearAll = () => {
    if (confirmClear) {
      setBackupStatus('Clearing KeepIndex data on this computer…')
      void resetAll().catch((error) => {
        setBackupStatus(error instanceof Error ? error.message : 'Factory reset failed before local data was cleared.')
        setConfirmClear(false)
      })
    }
    else {
      setConfirmClear(true)
      window.setTimeout(() => setConfirmClear(false), 3500)
    }
  }

  const handleExport = async () => {
    setBackupStatus('Preparing recovery bundle…')
    try {
      const backup = await createStateBackup()
      downloadStateBackup(backup)
      setBackupStatus('Recovery bundle downloaded.')
    } catch (error) {
      setBackupStatus(error instanceof Error ? error.message : 'Could not create backup.')
    }
  }

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const backup = parseStateBackup(await file.text())
      setPendingRestore(backup)
      setBackupStatus(null)
    } catch (error) {
      setBackupStatus(error instanceof Error ? error.message : 'Could not read backup.')
    }
  }

  const confirmRestore = async () => {
    if (!pendingRestore) return
    setIsRestoring(true)
    try {
      await Promise.all([
        collectionMutationQueue.runAfterPending(async () => undefined),
        sessionMutationQueue.runAfterPending(async () => undefined),
      ])
      await restoreStateBackup(pendingRestore, setBackupStatus)
      window.location.reload()
    } catch (error) {
      setBackupStatus(error instanceof Error ? error.message : 'Restore failed.')
      setIsRestoring(false)
    }
  }

  const healthPending = !health && !healthError

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={isRestoring ? undefined : onClose} className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" aria-hidden />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 27, stiffness: 220 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[470px] flex-col border-l border-border bg-card shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-dialog-title"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border/60 p-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 id="settings-dialog-title" className="font-semibold">KeepIndex settings</h2>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">private local</span>
                </div>
                <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">local state · models · recovery</p>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} disabled={isRestoring} aria-label="Close settings"><X className="size-4" /></Button>
            </div>

            <div className="flex-1 space-y-5 overflow-auto p-4">
              <Card className="border-border/60">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Activity className="size-3.5 text-primary" /> System health {health && <span className="text-primary">{health.healthScore}%</span>}</CardTitle>
                  <Button variant="ghost" size="icon-xs" onClick={() => void checkHealth()} aria-label="Refresh health check" title="Refresh health check"><RefreshCw className={cn('size-3.5', isCheckingHealth && 'animate-spin')} /></Button>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <HealthRow label="Selected AI endpoint" healthy={health?.llm} pending={healthPending} detail={healthPending ? 'checking' : health?.llm ? `${health.modelCount ?? availableModels.length} models · ${health.latencyMs?.llm ?? '—'}ms` : 'offline'} />
                  <HealthRow label="SearXNG" healthy={health?.searxng} pending={healthPending} detail={healthPending ? 'checking' : health?.searxng ? `${health.latencyMs?.searxng ?? '—'}ms` : 'offline'} />
                  {health?.searxngEngines && health.searxngEngines.total > 0 && (
                    <HealthRow
                      label="Search engines"
                      healthy={health.searxngEngines.coveragePct >= 50}
                      pending={healthPending}
                      detail={healthPending ? 'checking' : `${health.searxngEngines.live.length}/${health.searxngEngines.total} answering · ${health.searxngEngines.coveragePct}%`}
                    />
                  )}
                  {health?.searxngEngines && health.searxngEngines.down.length > 0 && (
                    <ul className="space-y-0.5 px-1">
                      {health.searxngEngines.down.map((engine) => (
                        <li key={engine.engine} className="font-mono text-[10px] text-muted-foreground">
                          <span className="text-destructive">{engine.engine}</span> — {engine.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                  <HealthRow label="SQLite WAL" healthy={health?.database} pending={healthPending} detail={healthPending ? 'checking' : health?.database ? 'healthy' : 'unavailable'} />
                  <HealthRow label="Knowledge mounts" healthy={!health?.knowledge?.unavailable} pending={healthPending} detail={healthPending ? 'checking' : `${health?.knowledge?.resources ?? 0} roots · ${health?.knowledge?.score ?? 0}%`} />
                  {health?.slots && <p className="px-1 font-mono text-[10px] text-muted-foreground">Inference slots: {health.slots.idle}/{health.slots.total} idle</p>}
                  {healthError && <p className="text-[10px] text-destructive">{healthError}</p>}
                </CardContent>
              </Card>

              <AiConnectionSettings onChange={() => void checkHealth()} />
              <Card>
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Cpu className="size-3.5 text-primary" /> Active AI model</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <select value={selectedModel} onChange={(event) => void setSelectedModel(event.target.value)} className="w-full rounded-lg border border-border bg-muted/50 p-2 font-mono text-xs outline-none focus:ring-1 focus:ring-primary" aria-label="Active AI model">
                    {availableModels.map((model) => <option key={model.id} value={model.id}>{model.id}{model.isReasoning ? ' · reasoning' : ''}</option>)}
                  </select>
                  <p className="text-[11px] text-muted-foreground">Choose a model from the selected AI endpoint. KeepIndex adapts generation limits and grounding instructions for compact models.</p>
                  {modelsError && <p className="text-[10px] text-[oklch(0.68_0.13_75)]">{modelsError}</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Sparkles className="size-3.5 text-primary" /> Response display</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-xs">
                  <div className="flex items-center justify-between gap-3"><span>Show live reasoning</span><Toggle value={showThinking} onChange={setShowThinking} label="Show live reasoning" /></div>
                  <div className="flex items-center justify-between gap-3"><span>Show query metrics and estimates</span><Toggle value={showQueryMetrics} onChange={setShowQueryMetrics} label="Show query metrics" /></div>
                  <div className="border-t border-border/45 pt-3">
                    <div className="mb-1.5 flex items-center justify-between"><span>Raw search result count</span><span className="font-mono">{searchResultsCount}</span></div>
                    <input type="range" min={5} max={25} step={5} value={searchResultsCount} onChange={(event) => setSearchResultsCount(Number(event.target.value))} className="w-full" aria-label="Raw search result count" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Gauge className="size-3.5 text-primary" /> Impact assumptions</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-xs">
                  <label className="block"><span className="mb-1 block text-[11px] text-muted-foreground">Inference hardware profile</span><select value={computeProfile} onChange={(event) => setComputeProfile(event.target.value as ComputeProfile)} className="w-full rounded-lg border border-border bg-muted/50 p-2 text-xs"><option value="laptop">{COMPUTE_PROFILES.laptop.label} · {COMPUTE_PROFILES.laptop.watts} W</option><option value="desktop">{COMPUTE_PROFILES.desktop.label} · {COMPUTE_PROFILES.desktop.watts} W</option><option value="workstation">{COMPUTE_PROFILES.workstation.label} · {COMPUTE_PROFILES.workstation.watts} W</option><option value="custom">Custom wattage</option></select></label>
                  {computeProfile === 'custom' && <label className="block"><span className="mb-1 block text-[11px] text-muted-foreground">Active power, watts</span><input type="number" min={10} max={2000} value={customPowerWatts} onChange={(event) => setCustomPowerWatts(Number(event.target.value))} className="w-full rounded-lg border border-border bg-muted/50 p-2 font-mono text-xs" /></label>}
                  <details className="rounded-lg border border-border/50 p-2.5"><summary className="cursor-pointer text-[11px] text-muted-foreground">Electricity and grid assumptions</summary><div className="mt-3 grid grid-cols-2 gap-2"><label><span className="mb-1 block text-[10px] text-muted-foreground">USD / kWh</span><input type="number" min={0} max={5} step={0.01} value={electricityRate} onChange={(event) => setElectricityRate(Number(event.target.value))} className="w-full rounded border border-border bg-muted/40 p-1.5 font-mono text-xs" /></label><label><span className="mb-1 block text-[10px] text-muted-foreground">g CO₂e / kWh</span><input type="number" min={0} max={2000} step={10} value={gridCarbon} onChange={(event) => setGridCarbonIntensity(Number(event.target.value))} className="w-full rounded border border-border bg-muted/40 p-1.5 font-mono text-xs" /></label></div></details>
                  <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground"><Leaf className="mt-0.5 size-3 shrink-0" /> Energy and carbon are transparent local estimates—not hardware meter readings or utility-billing claims.</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Appearance & shortcuts</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between"><span className="text-xs">Color theme</span><Button variant="outline" size="sm" onClick={toggleTheme} className="h-7 text-xs">{isDark ? 'Light mode' : 'Dark mode'}</Button></div>
                  <div className="space-y-1.5 border-t border-border/50 pt-2">{SHORTCUTS.map(({ key, action }) => <div key={key} className="flex items-center justify-between text-xs"><kbd>{key}</kbd><span className="text-[11px] text-muted-foreground">{action}</span></div>)}</div>
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader className="pb-2"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recovery & data</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" onClick={() => void handleExport()} disabled={isRestoring} className="gap-1.5 text-xs"><Download className="size-3.5" /> Export backup</Button>
                    <Button variant="outline" size="sm" onClick={() => importRef.current?.click()} disabled={isRestoring} className="gap-1.5 text-xs"><Upload className="size-3.5" /> Import backup</Button>
                    <input ref={importRef} type="file" accept="application/json,.json" onChange={(event) => void handleImportFile(event)} className="hidden" />
                  </div>
                  {pendingRestore && (
                    <div className="rounded-lg border border-[oklch(0.68_0.13_75/0.35)] bg-[oklch(0.68_0.13_75/0.06)] p-2.5 text-[11px]">
                      <p>Restore backup from {new Date(pendingRestore.exportedAt).toLocaleString()}? Current KeepIndex and browser state on this computer will be replaced.</p>
                      <div className="mt-2 flex gap-2"><Button size="sm" onClick={() => void confirmRestore()} disabled={isRestoring} className="h-7 text-[11px]">{isRestoring ? 'Restoring…' : 'Confirm restore'}</Button><Button variant="ghost" size="sm" onClick={() => setPendingRestore(null)} disabled={isRestoring} className="h-7 text-[11px]">Cancel</Button></div>
                    </div>
                  )}
                  {backupStatus && <p className="text-[10px] leading-relaxed text-muted-foreground">{backupStatus}</p>}
                  <div className="border-t border-destructive/20 pt-3">
                    <Button variant={confirmClear ? 'destructive' : 'outline'} size="sm" onClick={handleClearAll} disabled={isRestoring} className="gap-2 text-xs"><Trash2 className="size-3.5" />{confirmClear ? 'Confirm factory reset' : 'Factory reset KeepIndex data'}</Button>
                    <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">Clears collections, history, sessions, conversations, journey memory, telemetry, settings, and every knowledge index. Original files are never deleted.</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
