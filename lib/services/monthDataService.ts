import { auth } from '@/lib/firebase'
import type { Employee, Penalty, SalaryAdvance } from '@/lib/models/types'
import { previousVietnamMonth } from '@/lib/archive/retention'

export type MonthDataSource = 'firestore' | 'drive' | 'merged'

export interface MonthDataResult<T> {
  month: string
  source: MonthDataSource
  records: T[]
  employees: Employee[]
}

type MonthCacheEntry = {
  result: MonthDataResult<unknown>
  expiresAt: number
}

const PREVIOUS_MONTH_CLIENT_CACHE_TTL_MS = 10 * 60 * 1000
const cache = new Map<string, MonthCacheEntry>()

function removeInactiveMonthCacheEntries(previousMonth: string) {
  for (const [key] of cache) {
    if (!key.endsWith(`:${previousMonth}`)) cache.delete(key)
  }
}

function hydrateDates(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...record }
  for (const field of ['createdAt', 'updatedAt', 'reviewedAt', 'penaltyDate', 'adjustedAt', 'cancelledAt']) {
    const value = result[field]
    if (typeof value === 'string') result[field] = new Date(value)
  }
  return result
}

async function readMonth<T extends Record<string, unknown>>(resource: 'penalties' | 'salaryAdvances', month: string): Promise<MonthDataResult<T>> {
  const user = auth.currentUser
  if (!user) throw new Error('Bạn cần đăng nhập để xem dữ liệu theo tháng.')
  const key = `${user.uid}:${resource}:${month}`
  const previousMonth = previousVietnamMonth(new Date()).key
  removeInactiveMonthCacheEntries(previousMonth)
  const cacheableMonth = month === previousMonth
  const cached = cacheableMonth ? cache.get(key) : undefined
  if (cached && cached.expiresAt > Date.now()) return cached.result as MonthDataResult<T>
  if (cached) cache.delete(key)
  const token = await user.getIdToken()
  const response = await fetch(`/api/month-data?resource=${resource}&month=${encodeURIComponent(month)}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' })
  const body = await response.json().catch(() => null) as { ok?: boolean; result?: MonthDataResult<T>; error?: string } | null
  if (!response.ok || !body?.ok || !body.result) throw new Error(body?.error || 'Chưa thể tải dữ liệu theo tháng.')
  const result: MonthDataResult<T> = {
    ...body.result,
    records: body.result.records.map((record) => hydrateDates(record) as T),
    employees: body.result.employees.map((employee) => {
      const hydrated = hydrateDates(employee as unknown as Record<string, unknown>)
      return { ...hydrated, uid: String(hydrated.uid || hydrated.id) } as unknown as Employee
    }),
  }
  if (cacheableMonth) {
    cache.set(key, {
      result: result as MonthDataResult<unknown>,
      expiresAt: Date.now() + PREVIOUS_MONTH_CLIENT_CACHE_TTL_MS,
    })
  } else {
    cache.delete(key)
  }
  return result
}

export const readPenaltyMonth = (month: string) => readMonth<Penalty & Record<string, unknown>>('penalties', month)
export const readSalaryAdvanceMonth = (month: string) => readMonth<SalaryAdvance & Record<string, unknown>>('salaryAdvances', month)

export function invalidateMonthData(resource: 'penalties' | 'salaryAdvances', month: string) {
  const uid = auth.currentUser?.uid
  if (uid) cache.delete(`${uid}:${resource}:${month}`)
}
