export type HealthLevel = 'healthy' | 'warning' | 'critical' | 'unknown'

export function healthLevelRank(value: HealthLevel): number {
  return ({ healthy: 0, unknown: 1, warning: 2, critical: 3 } as const)[value]
}

export function quotaHealthLevel(value: number, limit: number): HealthLevel {
  if (!Number.isFinite(value) || !Number.isFinite(limit) || limit <= 0) return 'unknown'
  const ratio = value / limit
  if (ratio >= 0.95) return 'critical'
  if (ratio >= 0.8) return 'warning'
  return 'healthy'
}

export function overallHealthLevel(values: HealthLevel[]): HealthLevel {
  return [...values].sort((left, right) => healthLevelRank(right) - healthLevelRank(left))[0] || 'unknown'
}
