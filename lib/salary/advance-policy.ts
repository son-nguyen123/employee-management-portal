export interface SalaryAdvanceWindowState {
  restrictionEnabled: boolean
  canSubmit: boolean
  vietnamDay: number
  allowedDays: readonly [24, 25]
}

export function vietnamDayOfMonth(now = new Date()): number {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).getUTCDate()
}

export function salaryAdvanceWindowState(restrictionEnabled: boolean, now = new Date()): SalaryAdvanceWindowState {
  const vietnamDay = vietnamDayOfMonth(now)
  return {
    restrictionEnabled,
    canSubmit: !restrictionEnabled || vietnamDay === 24 || vietnamDay === 25,
    vietnamDay,
    allowedDays: [24, 25],
  }
}
