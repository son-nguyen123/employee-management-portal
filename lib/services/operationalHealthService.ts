import { callWorkflowApi } from '@/lib/services/workflowApi'
import type { OperationalHealthSnapshot } from '@/lib/models/operationalHealth'

export type { OperationalHealthSnapshot, OperationalServiceStatus, OperationalSeverity } from '@/lib/models/operationalHealth'

export function getOperationalHealth(): Promise<OperationalHealthSnapshot> {
  return callWorkflowApi('getOperationalHealth', {})
}

export function runOperationalHealthNow(): Promise<OperationalHealthSnapshot> {
  return callWorkflowApi('runOperationalHealthNow', {})
}
