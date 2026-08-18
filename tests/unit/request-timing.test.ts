import { describe, expect, it } from 'vitest'
import { isRequestOverdue, requestDueAt } from '@/lib/requests/request-timing'

const date = (value: string) => new Date(value)

describe('request timing policy', () => {
  it('marks overtime and schedule changes overdue at the earliest shift start', () => {
    const dueAt = requestDueAt({
      type: 'staff',
      staffRequestType: 'overtime',
      createdAt: date('2026-08-17T08:00:00+07:00'),
      referenceDate: date('2026-08-17T12:00:00+07:00'),
      shifts: [
        { date: date('2026-08-18T12:00:00+07:00'), shift: 'Afternoon' },
        { date: date('2026-08-18T12:00:00+07:00'), shift: 'Morning' },
      ],
    })

    expect(dueAt?.toISOString()).toBe('2026-08-18T00:30:00.000Z')
    expect(isRequestOverdue({ dueAt }, date('2026-08-18T07:30:00+07:00'))).toBe(true)
  })

  it('uses seven calendar days for salary advances', () => {
    const dueAt = requestDueAt({
      type: 'salary',
      createdAt: date('2026-08-01T09:00:00+07:00'),
      referenceDate: date('2026-08-01T09:00:00+07:00'),
    })

    expect(dueAt?.toISOString()).toBe('2026-08-08T02:00:00.000Z')
  })

  it('does not expire ordinary notes', () => {
    const dueAt = requestDueAt({
      type: 'staff',
      staffRequestType: 'note',
      createdAt: date('2026-08-01T09:00:00+07:00'),
      referenceDate: date('2026-08-01T09:00:00+07:00'),
    })

    expect(dueAt).toBeNull()
  })
})
