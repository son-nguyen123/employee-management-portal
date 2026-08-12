import { callWorkflowApi } from '@/lib/services/workflowApi'
import type { UserFeatureKey, UserFeatureSettings } from '@/lib/models/userFeatureSettings'
import { auth } from '@/lib/firebase'

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

export interface SalaryAdvancePolicy {
  restrictionEnabled: boolean
  canSubmit: boolean
  vietnamDay: number
  allowedDays: readonly [24, 25]
}

export function getSalaryAdvancePolicy(): Promise<SalaryAdvancePolicy> {
  return callWorkflowApi('getSalaryAdvancePolicy', {})
}

export function updateSalaryAdvancePolicy(restrictionEnabled: boolean): Promise<SalaryAdvancePolicy> {
  return callWorkflowApi('updateSalaryAdvancePolicy', { restrictionEnabled })
}

const USER_FEATURE_CACHE_TTL_MS = 60_000
let userFeatureSettingsCache: { value: UserFeatureSettings; cachedAt: number } | null = null
let userFeatureSettingsRequest: { uid: string; promise: Promise<UserFeatureSettings> } | null = null

const cloneUserFeatureSettings = (value: UserFeatureSettings): UserFeatureSettings => ({ ...value })

/**
 * Returns the last known settings without waiting for the network for callers
 * that explicitly opt into a cached value.
 */
export function getCachedUserFeatureSettings(): UserFeatureSettings | null {
  return userFeatureSettingsCache ? cloneUserFeatureSettings(userFeatureSettingsCache.value) : null
}

export function getAccountRegistrationWindow(): Promise<AccountRegistrationWindow> {
  return callWorkflowApi('getAccountRegistrationWindow', {})
}

export function updateAccountRegistrationWindow(open: boolean): Promise<AccountRegistrationWindow> {
  return callWorkflowApi('updateAccountRegistrationWindow', { open })
}

export function getUserFeatureSettings(options: { force?: boolean } = {}): Promise<UserFeatureSettings> {
  if (!options.force && userFeatureSettingsCache && Date.now() - userFeatureSettingsCache.cachedAt < USER_FEATURE_CACHE_TTL_MS) {
    return Promise.resolve(cloneUserFeatureSettings(userFeatureSettingsCache.value))
  }
  const uid = auth.currentUser?.uid || ''
  if (userFeatureSettingsRequest?.uid === uid) {
    return userFeatureSettingsRequest.promise.then(cloneUserFeatureSettings)
  }

  const request = callWorkflowApi<UserFeatureSettings>('getUserFeatureSettings', {}).then((settings) => {
    userFeatureSettingsCache = { value: cloneUserFeatureSettings(settings), cachedAt: Date.now() }
    return cloneUserFeatureSettings(settings)
  })
  userFeatureSettingsRequest = { uid, promise: request }
  request.then(
    () => { if (userFeatureSettingsRequest?.promise === request) userFeatureSettingsRequest = null },
    () => { if (userFeatureSettingsRequest?.promise === request) userFeatureSettingsRequest = null },
  )
  return request.then(cloneUserFeatureSettings)
}

export function updateUserFeatureSetting(key: UserFeatureKey, enabled: boolean): Promise<UserFeatureSettings> {
  return callWorkflowApi<UserFeatureSettings>('updateUserFeatureSetting', { key, enabled }).then((settings) => {
    userFeatureSettingsCache = { value: cloneUserFeatureSettings(settings), cachedAt: Date.now() }
    return cloneUserFeatureSettings(settings)
  })
}
