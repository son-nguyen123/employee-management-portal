export const userFeatureKeys = [
  'schedule',
  'lateArrival',
  'leave',
  'salaryAdvance',
  'penalties',
  'shiftChanges',
  'companyRules',
] as const

export type UserFeatureKey = (typeof userFeatureKeys)[number]

export type UserFeatureSettings = Record<UserFeatureKey, boolean>

export const defaultUserFeatureSettings: UserFeatureSettings = {
  schedule: true,
  lateArrival: true,
  leave: true,
  salaryAdvance: true,
  penalties: true,
  shiftChanges: true,
  companyRules: true,
}
