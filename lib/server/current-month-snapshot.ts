import 'server-only'

import { Timestamp, type DocumentData, type DocumentSnapshot } from 'firebase-admin/firestore'
import { currentVietnamMonth } from '@/lib/archive/retention'
import { adminDb } from '@/lib/server/firebase-admin'

function normalizeForJson(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(normalizeForJson)
  if (typeof value === 'object') {
    const candidate = value as { toDate?: () => Date }
    if (typeof candidate.toDate === 'function') return candidate.toDate().toISOString()
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, normalizeForJson(nested)]))
  }
  return value
}

function archiveDocument(snapshot: DocumentSnapshot<DocumentData>) {
  return { path: snapshot.ref.path, id: snapshot.id, data: normalizeForJson(snapshot.data()) }
}

function timestampAtOrAfter(value: unknown, start: Date): boolean {
  const date = value instanceof Timestamp ? value.toDate() : value instanceof Date ? value : null
  return Boolean(date && date >= start)
}

function timestampWithin(value: unknown, start: Date, end: Date): boolean {
  const date = value instanceof Timestamp ? value.toDate() : value instanceof Date ? value : null
  return Boolean(date && date >= start && date < end)
}

function requestActivityWithin(snapshot: DocumentSnapshot<DocumentData>, start: Date, end: Date): boolean {
  return ['reviewedAt', 'updatedAt', 'createdAt'].some((field) => timestampWithin(snapshot.get(field), start, end))
}

export async function getCurrentMonthSnapshot(requestedMonth: string, now = new Date()) {
  const window = currentVietnamMonth(now)
  if (requestedMonth !== window.key) throw new Error('Chỉ tháng hiện tại mới được cộng dữ liệu đang sống từ Firestore.')
  const start = Timestamp.fromDate(window.start)
  const end = Timestamp.fromDate(window.end)
  const [schedules, leaveCandidates, lateRequests, salaryAdvances, staffRequests, penalties, auditEvents] = await Promise.all([
    adminDb.collection('workSchedules').where('date', '>=', start).where('date', '<', end).get(),
    adminDb.collection('leaveRequests').where('leaveDate', '<', end).get(),
    adminDb.collection('lateRequests').where('date', '>=', start).where('date', '<', end).get(),
    adminDb.collection('salaryAdvances').where('createdAt', '>=', start).where('createdAt', '<', end).get(),
    adminDb.collection('staffRequests').where('createdAt', '<', end).get(),
    adminDb.collection('penalties').where('penaltyDate', '>=', start).where('penaltyDate', '<', end).get(),
    adminDb.collection('auditEvents').where('occurredAt', '>=', start).where('occurredAt', '<', end).get(),
  ])
  const domainRecords = {
    workSchedules: schedules.docs.map(archiveDocument),
    leaveRequests: leaveCandidates.docs.filter((document) => timestampAtOrAfter(document.get('endDate') ?? document.get('leaveDate'), window.start)).map(archiveDocument),
    lateRequests: lateRequests.docs.map(archiveDocument),
    salaryAdvances: salaryAdvances.docs.map(archiveDocument),
    staffRequests: staffRequests.docs.filter((document) => requestActivityWithin(document, window.start, window.end)).map(archiveDocument),
    penalties: penalties.docs.map(archiveDocument),
    auditEvents: auditEvents.docs.map(archiveDocument),
  }
  const employeeIds = new Set<string>()
  Object.values(domainRecords).flat().forEach((record) => {
    const employeeId = (record.data as Record<string, unknown>).employeeId
    if (typeof employeeId === 'string') employeeIds.add(employeeId)
  })
  const employeeSnapshots = await Promise.all(Array.from(employeeIds).map((uid) => adminDb.collection('employees').doc(uid).get()))
  const records = { ...domainRecords, employeeProfiles: employeeSnapshots.filter((snapshot) => snapshot.exists).map(archiveDocument) }
  const counts = Object.fromEntries(Object.entries(records).map(([collection, documents]) => [collection, documents.length]))
  return {
    schemaVersion: 1,
    application: 'employee-management-portal',
    archiveKind: 'live' as const,
    archiveKey: window.key,
    timezone: 'Asia/Ho_Chi_Minh',
    monthStart: window.start.toISOString(),
    monthEndExclusive: window.end.toISOString(),
    exportedAt: now.toISOString(),
    counts,
    records,
  }
}
