import type { StaffRequestShift, StaffRequestType } from '@/lib/models/types'

export type RequestTimingType = 'account' | 'schedule' | 'leave' | 'late' | 'salary' | 'staff'
type TimingShift = { date: Date; shift: StaffRequestShift['shift'] }

export type RequestTimingInput = {
  type: RequestTimingType
  staffRequestType?: StaffRequestType
  createdAt: Date
  referenceDate: Date
  shifts?: TimingShift[]
  removedShifts?: TimingShift[]
  restoredShifts?: TimingShift[]
}

const SHIFT_START: Record<StaffRequestShift['shift'], [number, number]> = {
  Morning: [7, 30],
  Afternoon: [13, 0],
  Evening: [18, 0],
}

const vietnamDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function vietnamDateKey(value: Date): string {
  const parts = vietnamDateFormatter.formatToParts(value)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function startOfDay(value: Date): Date {
  return new Date(`${vietnamDateKey(value)}T00:00:00+07:00`)
}

function endOfDay(value: Date): Date {
  return new Date(`${vietnamDateKey(value)}T23:59:59.999+07:00`)
}

function shiftStart(value: Date, shift: StaffRequestShift['shift']): Date {
  const day = vietnamDateKey(value)
  const [hours, minutes] = SHIFT_START[shift]
  return new Date(`${day}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+07:00`)
}

function earliestShiftStart(input: RequestTimingInput): Date | null {
  const shifts = [
    ...(input.shifts || []),
    ...(input.removedShifts || []),
    ...(input.restoredShifts || []),
  ]
  if (!shifts.length) return null
  return shifts
    .map((item) => shiftStart(new Date(item.date), item.shift))
    .sort((left, right) => left.getTime() - right.getTime())[0] || null
}

/**
 * Returns the last useful moment for a pending request. This is a visual
 * workflow deadline only: it never changes the Firestore status or deletes a
 * request. All dates use Vietnam's calendar explicitly, matching the server
 * workflow and preventing a manager's computer timezone from changing a
 * deadline.
 */
export function requestDueAt(input: RequestTimingInput): Date | null {
  if (input.type === 'salary') {
    return new Date(input.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000)
  }
  if (input.type === 'leave') {
    return startOfDay(input.referenceDate)
  }
  if (input.type === 'late') {
    // Late reports remain reviewable after the shift, so the deadline is the
    // end of the affected calendar day rather than an automatic rejection.
    return endOfDay(input.referenceDate)
  }
  if (input.type === 'staff') {
    if (input.staffRequestType === 'note') return null
    if (input.staffRequestType === 'overtime' || input.staffRequestType === 'scheduleChange') {
      return earliestShiftStart(input)
    }
    if (input.staffRequestType === 'scheduleModeChange' || input.staffRequestType === 'factoryChange') {
      return startOfDay(input.referenceDate)
    }
  }
  return null
}

export function isRequestOverdue(item: { dueAt?: Date | null }, now = new Date()): boolean {
  return Boolean(item.dueAt && now.getTime() >= item.dueAt.getTime())
}

export function requestTimingLabel(item: { dueAt?: Date | null }, now = new Date()): string | null {
  if (!isRequestOverdue(item, now) || !item.dueAt) return null
  return `Quá hạn từ ${item.dueAt.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} · ${item.dueAt.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' })}`
}
