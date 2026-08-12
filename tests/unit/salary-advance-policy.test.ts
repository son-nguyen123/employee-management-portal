import { describe, expect, it } from 'vitest'
import { salaryAdvanceWindowState, vietnamDayOfMonth } from '@/lib/salary/advance-policy'

describe('salary advance submission window', () => {
  it('uses Vietnam time around the UTC date boundary', () => {
    expect(vietnamDayOfMonth(new Date('2026-08-23T17:00:00.000Z'))).toBe(24)
  })

  it('allows only the 24th and 25th when restriction is enabled', () => {
    expect(salaryAdvanceWindowState(true, new Date('2026-08-24T12:00:00+07:00')).canSubmit).toBe(true)
    expect(salaryAdvanceWindowState(true, new Date('2026-08-25T23:59:59+07:00')).canSubmit).toBe(true)
    expect(salaryAdvanceWindowState(true, new Date('2026-08-26T00:00:00+07:00')).canSubmit).toBe(false)
  })

  it('keeps submissions open when the admin toggle is disabled', () => {
    expect(salaryAdvanceWindowState(false, new Date('2026-08-13T12:00:00+07:00')).canSubmit).toBe(true)
  })
})
