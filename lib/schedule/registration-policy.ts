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
