import type { QueryMetrics } from '@/stores/app-store'

export type ComputeProfile = 'laptop' | 'desktop' | 'workstation' | 'custom'

export const COMPUTE_PROFILES: Record<Exclude<ComputeProfile, 'custom'>, { label: string; watts: number; description: string }> = {
  laptop: { label: 'Laptop GPU', watts: 90, description: 'Approx. 90 W active package power' },
  desktop: { label: 'Desktop GPU', watts: 350, description: 'Approx. 350 W GPU/system inference load' },
  workstation: { label: 'Workstation GPU', watts: 600, description: 'Approx. 600 W multi-component inference load' },
}

export type QueryImpact = {
  energyWh: number
  electricityCostUsd: number
  carbonGrams: number
  ledSeconds: number
}

export function getProfileWatts(profile: ComputeProfile, customWatts: number): number {
  if (profile === 'custom') return Math.max(10, Math.min(2000, customWatts || 350))
  return COMPUTE_PROFILES[profile].watts
}

/**
 * A transparent local-resource estimate, not hardware telemetry. Generation uses the
 * configured active wattage; search/planning time uses a conservative 35 W host baseline.
 */
export function estimateQueryImpact(
  metrics: QueryMetrics,
  options: {
    profile: ComputeProfile
    customWatts: number
    electricityRateUsdPerKwh: number
    gridCarbonGramsPerKwh: number
  }
): QueryImpact {
  const activeWatts = getProfileWatts(options.profile, options.customWatts)
  const generationMs = Math.max(0, metrics.durationMs)
  const baselineMs = Math.max(0, metrics.endToEndMs - generationMs)
  const energyWh = (activeWatts * generationMs + 35 * baselineMs) / 3_600_000
  return {
    energyWh,
    electricityCostUsd: (energyWh / 1000) * Math.max(0, options.electricityRateUsdPerKwh),
    carbonGrams: (energyWh / 1000) * Math.max(0, options.gridCarbonGramsPerKwh),
    ledSeconds: (energyWh / 10) * 3600,
  }
}
