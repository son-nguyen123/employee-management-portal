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

const USER_FEATURE_CACHE_TTL_MS = 60_000
let userFeatureSettingsCache: { value: UserFeatureSettings; cachedAt: number } | null = null
let userFeatureSettingsRequest: Promise<UserFeatureSettings> | null = null

const cloneUserFeatureSettings = (value: UserFeatureSettings): UserFeatureSettings => ({ ...value })

/**
 * Returns the last known settings without waiting for the network. The home
 * screen uses this to render immediately, then revalidates in the background.
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
  if (userFeatureSettingsRequest) return userFeatureSettingsRequest.then(cloneUserFeatureSettings)

  const request = callWorkflowApi<UserFeatureSettings>('getUserFeatureSettings', {}).then((settings) => {
    userFeatureSettingsCache = { value: cloneUserFeatureSettings(settings), cachedAt: Date.now() }
    return cloneUserFeatureSettings(settings)
  })
  userFeatureSettingsRequest = request
  request.then(
    () => { if (userFeatureSettingsRequest === request) userFeatureSettingsRequest = null },
    () => { if (userFeatureSettingsRequest === request) userFeatureSettingsRequest = null },
  )
  return request.then(cloneUserFeatureSettings)
}

export function updateUserFeatureSetting(key: UserFeatureKey, enabled: boolean): Promise<UserFeatureSettings> {
  return callWorkflowApi<UserFeatureSettings>('updateUserFeatureSetting', { key, enabled }).then((settings) => {
    userFeatureSettingsCache = { value: cloneUserFeatureSettings(settings), cachedAt: Date.now() }
    return cloneUserFeatureSettings(settings)
  })
}
