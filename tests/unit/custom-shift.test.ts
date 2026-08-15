import { describe, expect, it } from 'vitest'
import { parseCustomShiftNote, scheduleShiftIdentity } from '@/lib/schedule/custom-shift'

describe('custom overtime shifts', () => {
  it('accepts a valid custom time range and rejects malformed ranges', () => {
    expect(parseCustomShiftNote('[CUSTOM:17:30-21:00]')).toEqual({
      marker: '[CUSTOM:17:30-21:00]',
      start: '17:30',
      end: '21:00',
    })
    expect(parseCustomShiftNote('[CUSTOM:21:00-17:30]')).toBeNull()
    expect(parseCustomShiftNote('[CUSTOM:25:00-26:00]')).toBeNull()
  })

  it('keeps custom overtime distinct from a regular morning shift on the same day', () => {
    const date = new Date('2026-08-17T05:00:00.000Z')
    expect(scheduleShiftIdentity(date, 'Morning')).not.toBe(
      scheduleShiftIdentity(date, 'Morning', '[CUSTOM:17:30-21:00]')
    )
  })
})
