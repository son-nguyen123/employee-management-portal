import 'server-only'

import { currentVietnamMonth } from '@/lib/archive/retention'
import { employeeFactoryId } from '@/lib/models/factory'
import type { RequestActor } from '@/lib/server/api-auth'
import { getCurrentMonthSnapshot } from '@/lib/server/current-month-snapshot'
import { listMonthlyArchives, readArchive } from '@/lib/server/google-drive-archive'

export type MonthRecord = { id: string; path?: string; data: Record<string, unknown> }
type ArchivePayload = { records?: Record<string, MonthRecord[]> }
export type FlatMonthRecord = { id: string } & Record<string, unknown>

function safeRecords(payload: ArchivePayload, collection: string): MonthRecord[] {
  const records = payload.records?.[collection]
  return Array.isArray(records) ? records : []
}

export async function getAuthorizedMonthData(actor: RequestActor, month: string, resource: 'penalties' | 'salaryAdvances') {
  const currentMonth = currentVietnamMonth(new Date()).key
  let payload: ArchivePayload
  let source: 'firestore' | 'drive'
  if (month === currentMonth) {
    payload = await getCurrentMonthSnapshot(month) as unknown as ArchivePayload
    source = 'firestore'
  } else {
    const file = (await listMonthlyArchives()).find((item) => item.archiveKey === month)
    if (!file) return { month, source: 'drive' as const, records: [], employees: [] }
    payload = await readArchive(file.id) as ArchivePayload
    source = 'drive'
  }

  const profiles = safeRecords(payload, 'employeeProfiles')
  const profileById = new Map(profiles.map((item) => [item.id, item.data]))
  const canReadEmployee = (employeeId: string) => {
    if (actor.role === 'employee') return employeeId === actor.uid
    if (actor.role === 'director') return true
    return employeeFactoryId(profileById.get(employeeId) as never) === actor.factoryId
  }
  const records = safeRecords(payload, resource).filter((item) => canReadEmployee(String(item.data.employeeId || '')))
  const employeeIds = new Set(records.map((item) => String(item.data.employeeId || '')))
  const employees: FlatMonthRecord[] = profiles.filter((item) => employeeIds.has(item.id)).map((item) => ({ id: item.id, ...item.data }))
  const flattenedRecords: FlatMonthRecord[] = records.map((item) => ({ id: item.id, ...item.data }))
  return { month, source, records: flattenedRecords, employees }
}
