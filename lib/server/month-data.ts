import 'server-only'

import { employeeFactoryId } from '@/lib/models/factory'
import type { RequestActor } from '@/lib/server/api-auth'
import { listMonthlyArchives, readArchive } from '@/lib/server/google-drive-archive'
import { adminDb } from '@/lib/server/firebase-admin'
import { Timestamp, type DocumentData, type DocumentSnapshot } from 'firebase-admin/firestore'
import { currentVietnamMonth } from '@/lib/archive/retention'
import { withMonthDataCache } from '@/lib/server/month-data-cache'

export type MonthRecord = { id: string; path?: string; data: Record<string, unknown> }
type ArchivePayload = { records?: Record<string, MonthRecord[]> }
export type FlatMonthRecord = { id: string } & Record<string, unknown>

function monthWindow(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const nextYear = monthNumber === 12 ? year + 1 : year
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1
  return {
    start: new Date(`${month}-01T00:00:00+07:00`),
    end: new Date(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+07:00`),
  }
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]))
  return value
}

function archived(snapshot: DocumentSnapshot<DocumentData>): MonthRecord {
  return { id: snapshot.id, path: snapshot.ref.path, data: normalize(snapshot.data()) as Record<string, unknown> }
}

function safeRecords(payload: ArchivePayload, collection: string): MonthRecord[] {
  const records = payload.records?.[collection]
  return Array.isArray(records) ? records : []
}

type MonthSourceData = {
  source: 'firestore' | 'drive' | 'merged'
  records: MonthRecord[]
  profiles: MonthRecord[]
}

async function loadMonthSourceData(month: string, resource: 'penalties' | 'salaryAdvances'): Promise<MonthSourceData> {
  const { start, end } = monthWindow(month)
  const isCurrentMonth = month === currentVietnamMonth(new Date()).key
  const dateField = resource === 'penalties' ? 'penaltyDate' : 'createdAt'
  const [firestoreSnapshot, archiveFiles] = await Promise.all([
    isCurrentMonth
      ? adminDb.collection(resource).where(dateField, '>=', Timestamp.fromDate(start)).where(dateField, '<', Timestamp.fromDate(end)).get()
      : Promise.resolve({ docs: [] } as { docs: DocumentSnapshot<DocumentData>[] }),
    listMonthlyArchives().catch((error) => {
      if (!isCurrentMonth) throw error
      console.warn('Current month Drive archive is unavailable; continuing with Firestore:', error instanceof Error ? error.message : error)
      return []
    }),
  ])
  const archiveFile = archiveFiles.find((item) => item.archiveKey === month)
  let payload: ArchivePayload = {}
  let archiveAvailable = false
  if (archiveFile) {
    try {
      payload = await readArchive(archiveFile.id) as ArchivePayload
      archiveAvailable = true
    } catch (error) {
      if (!isCurrentMonth) throw error
      console.warn('Current month Drive archive could not be read; continuing with Firestore:', error instanceof Error ? error.message : error)
    }
  }
  const driveRecords = safeRecords(payload, resource)
  const firestoreRecords = firestoreSnapshot.docs.map(archived)
  const mergedById = new Map(driveRecords.map((item) => [item.id, item]))
  firestoreRecords.forEach((item) => mergedById.set(item.id, item))

  const archivedProfiles = safeRecords(payload, 'employeeProfiles')
  const allEmployeeIds = new Set(Array.from(mergedById.values()).map((item) => String(item.data.employeeId || '')).filter(Boolean))
  const liveProfileSnapshots = await Promise.all(Array.from(allEmployeeIds).map((uid) => adminDb.collection('employees').doc(uid).get()))
  const liveProfiles = liveProfileSnapshots.filter((item) => item.exists).map(archived)
  const profileRecordsById = new Map(liveProfiles.map((item) => [item.id, item]))
  archivedProfiles.forEach((item) => { if (!profileRecordsById.has(item.id)) profileRecordsById.set(item.id, item) })
  return {
    source: archiveAvailable && firestoreRecords.length ? 'merged' : archiveAvailable ? 'drive' : 'firestore',
    records: Array.from(mergedById.values()),
    profiles: Array.from(profileRecordsById.values()),
  }
}

export async function getAuthorizedMonthData(actor: RequestActor, month: string, resource: 'penalties' | 'salaryAdvances') {
  const sourceData = await withMonthDataCache(resource, month, () => loadMonthSourceData(month, resource))
  const profiles = sourceData.profiles
  const profileDataById = new Map(profiles.map((item) => [item.id, item.data]))
  const canReadEmployee = (employeeId: string) => {
    if (actor.role === 'employee') return employeeId === actor.uid
    if (actor.role === 'director') return true
    return employeeFactoryId(profileDataById.get(employeeId) as never) === actor.factoryId
  }
  const records = sourceData.records.filter((item) => canReadEmployee(String(item.data.employeeId || '')))
  const employeeIds = new Set(records.map((item) => String(item.data.employeeId || '')))
  const employees: FlatMonthRecord[] = profiles.filter((item) => employeeIds.has(item.id)).map((item) => ({ id: item.id, ...item.data, uid: item.id }))
  const flattenedRecords: FlatMonthRecord[] = records.map((item) => ({ id: item.id, ...item.data }))
  return { month, source: sourceData.source, records: flattenedRecords, employees }
}
