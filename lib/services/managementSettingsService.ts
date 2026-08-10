import { callWorkflowApi } from '@/lib/services/workflowApi'
import type { UserFeatureKey, UserFeatureSettings } from '@/lib/models/userFeatureSettings'

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

export interface AccountRegistrationWindow {
  isOpen: boolean
  closesAt: string | null
}

export function getAccountRegistrationWindow(): Promise<AccountRegistrationWindow> {
  return callWorkflowApi('getAccountRegistrationWindow', {})
}

export function updateAccountRegistrationWindow(open: boolean): Promise<AccountRegistrationWindow> {
  return callWorkflowApi('updateAccountRegistrationWindow', { open })
}

export function getUserFeatureSettings(): Promise<UserFeatureSettings> {
  return callWorkflowApi('getUserFeatureSettings', {})
}

export function updateUserFeatureSetting(key: UserFeatureKey, enabled: boolean): Promise<UserFeatureSettings> {
  return callWorkflowApi('updateUserFeatureSetting', { key, enabled })
}
