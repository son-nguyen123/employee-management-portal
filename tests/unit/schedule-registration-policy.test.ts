import { describe, expect, it } from 'vitest'
import { isManagementScheduleRole, isPastRegistrationDate, nextMondayKeyInVietnam, reactivationWaiverApplies, registrationTargetsNextWeek, restrictPastRegistration } from '@/lib/schedule/registration-policy'

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

  it('opens next-week registration from Friday through Sunday', () => {
    expect(registrationTargetsNextWeek(1)).toBe(false)
    expect(registrationTargetsNextWeek(4)).toBe(false)
    expect(registrationTargetsNextWeek(5)).toBe(true)
    expect(registrationTargetsNextWeek(6)).toBe(true)
    expect(registrationTargetsNextWeek(7)).toBe(true)
  })

  it('materializes fixed schedules for the next Monday in Vietnam', () => {
    expect(nextMondayKeyInVietnam(new Date('2026-08-13T17:00:00.000Z'))).toBe('2026-08-17') // Friday 00:00
    expect(nextMondayKeyInVietnam(new Date('2026-08-15T17:00:00.000Z'))).toBe('2026-08-17') // Sunday 00:00
    expect(nextMondayKeyInVietnam(new Date('2026-08-16T17:00:00.000Z'))).toBe('2026-08-24') // Monday 00:00
  })

  it('recognizes every management role as an unrestricted schedule owner', () => {
    expect(isManagementScheduleRole('employee')).toBe(false)
    expect(isManagementScheduleRole('manager')).toBe(true)
    expect(isManagementScheduleRole('director')).toBe(true)
    expect(isManagementScheduleRole('admin')).toBe(true)
  })
})
