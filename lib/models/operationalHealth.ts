export type OperationalSeverity = 'healthy' | 'warning' | 'critical' | 'unknown'

export interface OperationalIssue {
  service: 'firestore' | 'drive' | 'archive' | 'cron'
  code: string
  severity: Exclude<OperationalSeverity, 'healthy' | 'unknown'>
  title: string
  message: string
}

export interface OperationalServiceStatus {
  service: OperationalIssue['service']
  severity: OperationalSeverity
  title: string
  message: string
  metrics?: Record<string, number | string | null>
}

export interface OperationalHealthSnapshot {
  overall: OperationalSeverity
  checkedAt: string
  services: OperationalServiceStatus[]
  emailFallbackConfigured: boolean
  emailFallbackAddress?: string
  alerts: Array<OperationalIssue & { status: 'active' | 'resolved'; updatedAt: string; lastNotifiedAt?: string }>
}
