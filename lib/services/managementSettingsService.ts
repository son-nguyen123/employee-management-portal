import { callWorkflowApi } from '@/lib/services/workflowApi'

export interface WeeklyScheduleTarget {
  weekStart: string
  expectedEmployees: number
}

export function getWeeklyScheduleTarget(weekStart: string): Promise<WeeklyScheduleTarget> {
  return callWorkflowApi('getWeeklyScheduleTarget', { weekStart })
}

export function updateWeeklyScheduleTarget(
  weekStart: string,
  expectedEmployees: number,
): Promise<WeeklyScheduleTarget> {
  return callWorkflowApi('updateWeeklyScheduleTarget', { weekStart, expectedEmployees })
}

export function getManagementContact(): Promise<{ uid: string; fullName: string; photoURL: string; facebookUrl: string }> {
  return callWorkflowApi('getManagementContact', {})
}

export interface AuditReceiptSettings {
  emailEnabled: boolean
  auditTrailEnabled: boolean
  emailEnvironmentEnabled: boolean
  emailConfigured: boolean
  cancelledQueuedEmails?: number
}

export function getAuditReceiptSettings(): Promise<AuditReceiptSettings> {
  return callWorkflowApi('getAuditReceiptSettings', {})
}

export function updateAuditReceiptSettings(emailEnabled: boolean): Promise<AuditReceiptSettings> {
  return callWorkflowApi('updateAuditReceiptSettings', { emailEnabled })
}
