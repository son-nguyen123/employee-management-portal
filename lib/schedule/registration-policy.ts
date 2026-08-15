export function reactivationWaiverApplies(params: {
  hasPreviousSchedule: boolean
  waiverWeekStart?: unknown
  currentWeekStart: string
  scheduleWeekStart: string
}): boolean {
  return params.hasPreviousSchedule &&
    params.waiverWeekStart === params.currentWeekStart &&
    params.scheduleWeekStart === params.currentWeekStart
}

export function restrictPastRegistration(params: {
  fixedModeActive: boolean
  hasPreviousSchedule: boolean
  currentWeekStart: string
  scheduleWeekStart: string
}): boolean {
  return !params.fixedModeActive &&
    params.hasPreviousSchedule &&
    params.scheduleWeekStart === params.currentWeekStart
}

export function isPastRegistrationDate(dateKey: string, todayKey: string, restricted: boolean): boolean {
  return restricted && dateKey < todayKey
}

/** ISO weekday: Monday = 1, ..., Sunday = 7. */
export function registrationTargetsNextWeek(isoWeekday: number): boolean {
  return isoWeekday >= 5
}

/** Returns the next Monday after `date`, using Vietnam's calendar date. */
export function nextMondayKeyInVietnam(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ''
  const isoWeekday = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[value('weekday')] || 1
  const base = new Date(Date.UTC(Number(value('year')), Number(value('month')) - 1, Number(value('day'))))
  base.setUTCDate(base.getUTCDate() + (8 - isoWeekday))
  return base.toISOString().slice(0, 10)
}

export function isManagementScheduleRole(role: unknown): boolean {
  return role === 'admin' || role === 'manager' || role === 'director'
}
