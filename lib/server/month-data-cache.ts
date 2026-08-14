import { revalidateTag, unstable_cache } from 'next/cache'
import { currentVietnamMonth, previousVietnamMonth } from '@/lib/archive/retention'

export type MonthDataResource = 'penalties' | 'salaryAdvances'

const CURRENT_MONTH_TTL_SECONDS = 5 * 60
const PREVIOUS_MONTH_TTL_SECONDS = 24 * 60 * 60
const inFlightMonthLoads = new Map<string, Promise<unknown>>()

function shareMonthLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = inFlightMonthLoads.get(key)
  if (existing) return existing as Promise<T>

  const pending = loader().finally(() => {
    if (inFlightMonthLoads.get(key) === pending) inFlightMonthLoads.delete(key)
  })
  inFlightMonthLoads.set(key, pending)
  return pending
}

export function monthDataCacheTag(resource: MonthDataResource, month: string): string {
  return `month-data:${resource}:${month}`
}

export function isActiveMonthCache(month: string, now = new Date()): boolean {
  const currentMonth = currentVietnamMonth(now).key
  const previousMonth = previousVietnamMonth(now).key
  return month === currentMonth || month === previousMonth
}

export function withMonthDataCache<T>(
  resource: MonthDataResource,
  month: string,
  loader: () => Promise<T>,
): Promise<T> {
  const loadKey = `${resource}:${month}`
  if (!isActiveMonthCache(month)) return shareMonthLoad(loadKey, loader)

  const currentMonth = currentVietnamMonth(new Date()).key
  const revalidate = month === currentMonth ? CURRENT_MONTH_TTL_SECONDS : PREVIOUS_MONTH_TTL_SECONDS
  const cachedLoader = unstable_cache(loader, ['month-data-v2', resource, month], {
    revalidate,
    tags: [monthDataCacheTag(resource, month)],
  })
  return shareMonthLoad(loadKey, cachedLoader)
}

export function invalidateMonthDataCache(): void {
  const now = new Date()
  const months = new Set([currentVietnamMonth(now).key, previousVietnamMonth(now).key])
  for (const month of months) {
    for (const resource of ['penalties', 'salaryAdvances'] as const) {
      try {
        // Data-changing workflows should not serve a stale monthly snapshot
        // on the next API read. The UI still receives the same change through
        // Firestore listeners for current-month records.
        revalidateTag(monthDataCacheTag(resource, month), { expire: 0 })
      } catch (error) {
        console.error(`Failed to invalidate ${resource} cache for ${month}:`, error)
      }
    }
  }
}
