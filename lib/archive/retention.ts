const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
export const WEEK_MS = 7 * DAY_MS

export interface ArchiveWindow {
  key: string
  start: Date
  end: Date
}

function shiftedVietnamDate(date: Date): Date {
  return new Date(date.getTime() + VIETNAM_OFFSET_MS)
}

export function formatVietnamDate(date: Date): string {
  const shifted = shiftedVietnamDate(date)
  return [shifted.getUTCFullYear(), String(shifted.getUTCMonth() + 1).padStart(2, '0'), String(shifted.getUTCDate()).padStart(2, '0')].join('-')
}

export function vietnamWeekContaining(now: Date): ArchiveWindow {
  const shifted = shiftedVietnamDate(now)
  const weekday = shifted.getUTCDay() || 7
  const mondayShifted = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - weekday + 1)
  const start = new Date(mondayShifted - VIETNAM_OFFSET_MS)
  return { key: formatVietnamDate(start), start, end: new Date(start.getTime() + WEEK_MS) }
}

export function previousVietnamWeek(now: Date, weeksBack = 1): ArchiveWindow {
  if (!Number.isInteger(weeksBack) || weeksBack < 1) throw new Error('weeksBack must be at least 1.')
  const current = vietnamWeekContaining(now)
  const start = new Date(current.start.getTime() - weeksBack * WEEK_MS)
  return { key: formatVietnamDate(start), start, end: new Date(start.getTime() + WEEK_MS) }
}

export function previousVietnamMonth(now: Date): ArchiveWindow {
  const shifted = shiftedVietnamDate(now)
  const currentMonthShifted = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1)
  const previousMonthShifted = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - 1, 1))
  const start = new Date(previousMonthShifted.getTime() - VIETNAM_OFFSET_MS)
  return {
    key: `${previousMonthShifted.getUTCFullYear()}-${String(previousMonthShifted.getUTCMonth() + 1).padStart(2, '0')}`,
    start,
    end: new Date(currentMonthShifted - VIETNAM_OFFSET_MS),
  }
}

export function currentVietnamMonth(now: Date): ArchiveWindow {
  const shifted = shiftedVietnamDate(now)
  const startShifted = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1))
  const endShifted = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1))
  return {
    key: `${startShifted.getUTCFullYear()}-${String(startShifted.getUTCMonth() + 1).padStart(2, '0')}`,
    start: new Date(startShifted.getTime() - VIETNAM_OFFSET_MS),
    end: new Date(endShifted.getTime() - VIETNAM_OFFSET_MS),
  }
}

export function scheduleShareText(params: { fullName?: string | null; employeeCode?: string | null; weekStart: Date; weekEnd: Date }): string {
  const fullName = params.fullName?.trim() || 'nhân viên'
  const employeeCode = params.employeeCode?.trim() || 'chưa có mã'
  const shortDate = (date: Date) => `${date.getDate()}/${date.getMonth() + 1}`
  return `Em là ${fullName}, mã ${employeeCode}, gửi lịch làm tuần ${shortDate(params.weekStart)}–${shortDate(params.weekEnd)}.`
}
