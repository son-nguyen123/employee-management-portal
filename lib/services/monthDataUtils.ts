import { currentVietnamMonth } from '@/lib/archive/retention'

export function dateFromMonthValue(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate()
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null
  }
  return null
}

export function belongsToVietnamMonth(value: unknown, month: string): boolean {
  const date = dateFromMonthValue(value)
  return Boolean(date && currentVietnamMonth(date).key === month)
}
