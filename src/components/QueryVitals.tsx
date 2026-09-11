import { Gauge, Leaf, ShieldCheck, Zap } from 'lucide-react'
import type { GroundingAssessment, QueryMetrics } from '@/stores/app-store'
import { useSettingsStore } from '@/stores/settings-store'
import { COMPUTE_PROFILES, estimateQueryImpact, getProfileWatts } from '@/lib/query-impact'
import { cn } from '@/lib/utils'

function formatUsd(value: number): string {
  if (value <= 0) return '$0'
  if (value < 0.001) return '<$0.001'
  if (value < 0.01) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

export function QueryVitals({
  metrics,
  quality,
  className,
}: {
  metrics: QueryMetrics | null
  quality?: GroundingAssessment | null
  className?: string
}) {
  const showQueryMetrics = useSettingsStore((state) => state.showQueryMetrics)
  const computeProfile = useSettingsStore((state) => state.computeProfile)
  const customPowerWatts = useSettingsStore((state) => state.customPowerWatts)
  const electricityRateUsdPerKwh = useSettingsStore((state) => state.electricityRateUsdPerKwh)
  const gridCarbonGramsPerKwh = useSettingsStore((state) => state.gridCarbonGramsPerKwh)

  if (!showQueryMetrics || (!metrics && !quality)) return null
  const impact = metrics
    ? estimateQueryImpact(metrics, {
        profile: computeProfile,
        customWatts: customPowerWatts,
        electricityRateUsdPerKwh,
        gridCarbonGramsPerKwh,
      })
    : null
  const watts = getProfileWatts(computeProfile, customPowerWatts)
  const profileLabel = computeProfile === 'custom' ? 'Custom profile' : COMPUTE_PROFILES[computeProfile].label
  const qualityTone = quality?.status === 'strong'
    ? 'text-primary'
    : quality?.status === 'weak' || quality?.status === 'ungrounded'
      ? 'text-destructive'
      : 'text-[oklch(0.68_0.13_75)]'

  return (
    <details className={cn('group rounded-xl border border-border/55 bg-muted/15', className)}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 font-mono text-[10px] text-muted-foreground marker:hidden">
        <span className="inline-flex items-center gap-1.5 uppercase tracking-[0.11em]"><Gauge className="size-3 text-primary" /> Query vitals</span>
        {metrics && metrics.model && <span className="max-w-48 truncate" title={metrics.model}>{metrics.model}</span>}
        {metrics && metrics.outputTokens > 0 && (
          <>
            <span>{metrics.tokensPerSecond.toFixed(1)} tok/s</span>
            <span>{metrics.tokenCountsEstimated ? '~' : ''}{metrics.totalTokens.toLocaleString()} tokens</span>
            <span>TTFT {formatDuration(metrics.timeToFirstTokenMs)}</span>
          </>
        )}
        {quality && <span className={cn('inline-flex items-center gap-1 font-semibold', qualityTone)}><ShieldCheck className="size-3" /> {quality.citationCoveragePct}% citation coverage</span>}
        <span className="ml-auto text-[9px] uppercase tracking-wider group-open:text-foreground">details</span>
      </summary>
      <div className="grid gap-3 border-t border-border/45 px-3 py-3 text-[11px] text-muted-foreground sm:grid-cols-2">
        {quality && (
          <div className="rounded-lg border border-border/45 bg-background/45 p-2.5">
            <p className={cn('flex items-center gap-1.5 font-semibold capitalize', qualityTone)}><ShieldCheck className="size-3.5" /> {quality.status} citation coverage</p>
            <p className="mt-1 leading-relaxed">{quality.citationCoveragePct}% of long claim segments carry a nearby citation; {quality.citedSourceCount}/{quality.sourceCount} sources are cited.</p>
            {quality.invalidCitations.length > 0 && <p className="mt-1 text-destructive">Invalid IDs: {quality.invalidCitations.join(', ')}</p>}
            <p className="mt-1 text-[10px]">{quality.note}</p>
          </div>
        )}
        {metrics && impact && (
          <div className="rounded-lg border border-border/45 bg-background/45 p-2.5">
            <p className="flex items-center gap-1.5 font-semibold text-foreground"><Zap className="size-3.5 text-[oklch(0.72_0.16_85)]" /> Estimated local impact</p>
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px]">
              <span>{impact.energyWh.toFixed(3)} Wh</span>
              <span>{formatUsd(impact.electricityCostUsd)} electricity</span>
              <span className="inline-flex items-center gap-1"><Leaf className="size-2.5" />{impact.carbonGrams.toFixed(2)} g CO₂e</span>
              <span>≈ {Math.max(1, Math.round(impact.ledSeconds))}s of a 10W LED</span>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed">Estimate uses {profileLabel.toLowerCase()} at {watts} W during generation plus a 35 W host baseline. It is not a power-meter reading.</p>
          </div>
        )}
      </div>
    </details>
  )
}
