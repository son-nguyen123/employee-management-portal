import { describe, expect, it } from 'vitest'
import { isPastRegistrationDate, reactivationWaiverApplies, restrictPastRegistration } from '@/lib/schedule/registration-policy'

describe('schedule registration policy', () => {
  it('waives late registration only in the reactivation week', () => {
    expect(reactivationWaiverApplies({
      hasPreviousSchedule: true,
      waiverWeekStart: '2026-08-10',
      currentWeekStart: '2026-08-10',
      scheduleWeekStart: '2026-08-10',
    })).toBe(true)
    expect(reactivationWaiverApplies({
      hasPreviousSchedule: true,
      waiverWeekStart: '2026-08-10',
      currentWeekStart: '2026-08-17',
      scheduleWeekStart: '2026-08-17',
    })).toBe(false)
  })

  it('locks past dates for existing rotating employees only', () => {
    expect(restrictPastRegistration({
      fixedModeActive: false,
      hasPreviousSchedule: true,
      currentWeekStart: '2026-08-10',
      scheduleWeekStart: '2026-08-10',
    })).toBe(true)
    expect(isPastRegistrationDate('2026-08-11', '2026-08-13', true)).toBe(true)
    expect(isPastRegistrationDate('2026-08-13', '2026-08-13', true)).toBe(false)
  })

  it('keeps first schedules and fixed schedules exempt from the past-date lock', () => {
    expect(restrictPastRegistration({ fixedModeActive: false, hasPreviousSchedule: false, currentWeekStart: '2026-08-10', scheduleWeekStart: '2026-08-10' })).toBe(false)
    expect(restrictPastRegistration({ fixedModeActive: true, hasPreviousSchedule: true, currentWeekStart: '2026-08-10', scheduleWeekStart: '2026-08-10' })).toBe(false)
  })
})
