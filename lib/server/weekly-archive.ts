import 'server-only'

import { createHash } from 'node:crypto'
import { FieldValue, Timestamp, type DocumentData, type DocumentSnapshot } from 'firebase-admin/firestore'
import { previousVietnamWeek, vietnamWeekContaining, type ArchiveWindow } from '@/lib/archive/retention'
import { adminDb } from '@/lib/server/firebase-admin'
import { storeWeeklyArchive } from '@/lib/server/google-drive-archive'

const MAX_ARCHIVE_DOCUMENTS = 4_000
const WEEKLY_ARCHIVE_SCHEMA_VERSION = 3
const FINAL_SCHEDULE_STATUSES = new Set(['Approved', 'Rejected', 'Cancelled'])
const FINAL_REQUEST_STATUSES = new Set(['Approved', 'Rejected', 'Cancelled'])

interface ArchivedDocument { path: string; id: string; data: unknown }

export interface WeeklyArchiveResult {
  state: 'already-completed' | 'verified' | 'completed' | 'empty'
  archiveKey: string
  documentCount: number
  counts: Record<string, number>
  driveFileId?: string
  driveWebViewLink?: string
  driveFileName?: string
  driveFileSize?: number
  deleted: boolean
  purgedArchiveKey?: string
  purgedDocumentCount?: number
  expiredInactiveSchedules?: number
}

async function expireInactiveEmployeeSchedules(now: Date): Promise<number> {
  const currentWeek = vietnamWeekContaining(now)
  const [inactiveEmployees, schedules] = await Promise.all([
    adminDb.collection('employees').where('status', '==', 'inactive').get(),
    adminDb.collection('workSchedules').where('date', '>=', Timestamp.fromDate(currentWeek.start)).get(),
  ])
  const inactiveIds = new Set(inactiveEmployees.docs.map((employee) => employee.id))
  const expirable = schedules.docs.filter((schedule) =>
    inactiveIds.has(String(schedule.get('employeeId'))) &&
    ['Registered', 'Draft', 'Pending', 'Editing', 'ChangesRequested', 'Approved'].includes(String(schedule.get('status')))
  )
  for (let offset = 0; offset < expirable.length; offset += 450) {
    const batch = adminDb.batch()
    expirable.slice(offset, offset + 450).forEach((schedule) => batch.set(schedule.ref, {
      status: 'Cancelled',
      lockedAt: null,
      statusBeforeDeactivation: schedule.get('status'),
      cancelledBy: 'system-inactive-account-expiry',
      cancelledAt: FieldValue.serverTimestamp(),
      cancellationReason: 'Tài khoản vẫn bị vô hiệu hóa khi sang tuần mới.',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }))
    await batch.commit()
  }
  return expirable.length
}

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

function archiveDocument(snapshot: DocumentSnapshot<DocumentData>): ArchivedDocument {
  return { path: snapshot.ref.path, id: snapshot.id, data: normalizeForJson(snapshot.data()) }
}

function timestampWithin(value: unknown, window: ArchiveWindow): boolean {
  const date = value instanceof Timestamp ? value.toDate() : value instanceof Date ? value : null
  return Boolean(date && date >= window.start && date < window.end)
}

function requestActivityWithin(snapshot: DocumentSnapshot<DocumentData>, window: ArchiveWindow): boolean {
  return ['reviewedAt', 'updatedAt', 'createdAt'].some((field) => timestampWithin(snapshot.get(field), window))
}

async function collectDocuments(window: ArchiveWindow) {
  const start = Timestamp.fromDate(window.start)
  const end = Timestamp.fromDate(window.end)
  const [schedules, leaveCandidates, lateRequests, staffRequests, auditEvents, notifications, pushDispatches, auditEmailOutbox] = await Promise.all([
    adminDb.collection('workSchedules').where('date', '>=', start).where('date', '<', end).get(),
    adminDb.collection('leaveRequests').where('leaveDate', '<', end).get(),
    adminDb.collection('lateRequests').where('date', '>=', start).where('date', '<', end).get(),
    adminDb.collection('staffRequests').where('createdAt', '<', end).get(),
    adminDb.collection('auditEvents').where('occurredAt', '>=', start).where('occurredAt', '<', end).get(),
    adminDb.collection('notifications').where('createdAt', '>=', start).where('createdAt', '<', end).get(),
    adminDb.collection('pushDispatches').where('createdAt', '>=', start).where('createdAt', '<', end).get(),
    adminDb.collection('auditEmailOutbox').where('createdAt', '>=', start).where('createdAt', '<', end).get(),
  ])
  const domainRecords = {
    workSchedules: schedules.docs.map(archiveDocument),
    leaveRequests: leaveCandidates.docs.filter((doc) => timestampWithin(doc.get('endDate') ?? doc.get('leaveDate'), window)).map(archiveDocument),
    lateRequests: lateRequests.docs.map(archiveDocument),
    staffRequests: staffRequests.docs.filter((doc) => requestActivityWithin(doc, window)).map(archiveDocument),
    auditEvents: auditEvents.docs.map(archiveDocument),
    notifications: notifications.docs.map(archiveDocument),
    pushDispatches: pushDispatches.docs.map(archiveDocument),
    auditEmailOutbox: auditEmailOutbox.docs.map(archiveDocument),
  }
  const employeeIds = new Set<string>()
  Object.values(domainRecords).flat().forEach((record) => {
    const employeeId = (record.data as Record<string, unknown>).employeeId
    if (typeof employeeId === 'string') employeeIds.add(employeeId)
  })
  const employeeSnapshots = await Promise.all(Array.from(employeeIds).map((uid) => adminDb.collection('employees').doc(uid).get()))
  const records = { ...domainRecords, employeeProfiles: employeeSnapshots.filter((snapshot) => snapshot.exists).map(archiveDocument) }
  const counts = Object.fromEntries(Object.entries(records).map(([collection, documents]) => [collection, documents.length]))
  const paths = Object.entries(domainRecords).flatMap(([collection, documents]) => {
    if (['auditEvents', 'notifications'].includes(collection)) return documents.map((record) => record.path)
    if (collection === 'pushDispatches') {
      return documents.filter((record) => ['sent', 'partial', 'failed', 'no-devices'].includes(String((record.data as Record<string, unknown>).state))).map((record) => record.path)
    }
    if (collection === 'auditEmailOutbox') {
      return documents.filter((record) => ['sent', 'failed', 'cancelled'].includes(String((record.data as Record<string, unknown>).state))).map((record) => record.path)
    }
    return documents.filter((record) => {
      const status = String((record.data as Record<string, unknown>).status)
      return (collection === 'workSchedules' ? FINAL_SCHEDULE_STATUSES : FINAL_REQUEST_STATUSES).has(status)
    }).map((record) => record.path)
  })
  const documentCount = Object.values(records).flat().length
  if (documentCount > MAX_ARCHIVE_DOCUMENTS) throw new Error(`Archive contains ${documentCount} documents; maximum safe batch is ${MAX_ARCHIVE_DOCUMENTS}.`)
  return { records, paths, counts, documentCount }
}

async function deleteArchivedDocuments(paths: string[]): Promise<void> {
  for (let offset = 0; offset < paths.length; offset += 450) {
    const batch = adminDb.batch()
    paths.slice(offset, offset + 450).forEach((path) => batch.delete(adminDb.doc(path)))
    await batch.commit()
  }
}

function manifestId(window: ArchiveWindow) { return `weekly-${window.key}` }

async function ensureWeekArchived(window: ArchiveWindow, now: Date): Promise<WeeklyArchiveResult> {
  const manifestRef = adminDb.collection('archiveRuns').doc(manifestId(window))
  const existing = await manifestRef.get()
  if (['verified', 'completed'].includes(String(existing.get('state'))) && Number(existing.get('archiveSchemaVersion') || 0) >= WEEKLY_ARCHIVE_SCHEMA_VERSION) {
    return {
      state: existing.get('state') === 'completed' ? 'already-completed' : 'verified',
      archiveKey: window.key,
      documentCount: Number(existing.get('documentCount') ?? 0),
      counts: existing.get('counts') ?? {},
      driveFileId: existing.get('driveFileId'),
      driveWebViewLink: existing.get('driveWebViewLink'),
      deleted: existing.get('state') === 'completed',
    }
  }

  const { records, paths, counts, documentCount } = await collectDocuments(window)
  const payload = {
    schemaVersion: WEEKLY_ARCHIVE_SCHEMA_VERSION,
    application: 'employee-management-portal',
    firebaseProjectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    archiveKey: window.key,
    archiveKind: 'weekly',
    timezone: 'Asia/Ho_Chi_Minh',
    weekStart: window.start.toISOString(),
    weekEndExclusive: window.end.toISOString(),
    exportedAt: now.toISOString(),
    counts,
    records,
  }
  const json = JSON.stringify(payload, null, 2)
  const checksum = createHash('sha256').update(json).digest('hex')
  const lockAcquired = await adminDb.runTransaction(async (transaction) => {
    const current = await transaction.get(manifestRef)
    const leaseUntil = current.get('leaseUntil')
    if (current.get('state') === 'exporting' && leaseUntil instanceof Timestamp && leaseUntil.toMillis() > Date.now()) return false
    if (['verified', 'completed'].includes(String(current.get('state'))) && Number(current.get('archiveSchemaVersion') || 0) >= WEEKLY_ARCHIVE_SCHEMA_VERSION) return false
    transaction.set(manifestRef, {
      state: 'exporting', archiveKind: 'weekly', archiveSchemaVersion: WEEKLY_ARCHIVE_SCHEMA_VERSION, archiveKey: window.key,
      weekStart: Timestamp.fromDate(window.start), weekEndExclusive: Timestamp.fromDate(window.end),
      documentCount, documentPaths: paths, counts, checksum,
      leaseUntil: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
      updatedAt: FieldValue.serverTimestamp(), createdAt: current.get('createdAt') ?? FieldValue.serverTimestamp(),
    }, { merge: true })
    return true
  })
  if (!lockAcquired) throw new Error(`Weekly archive ${window.key} is already running.`)

  try {
    const driveFile = await storeWeeklyArchive({ archiveKey: window.key, checksum, json })
    await manifestRef.set({
      state: 'verified', driveFileId: driveFile.id, driveFileName: driveFile.name,
      driveFileSize: Number(driveFile.size ?? 0), driveMd5Checksum: driveFile.md5Checksum ?? null,
      driveWebViewLink: driveFile.webViewLink ?? null, leaseUntil: null,
      verifiedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return { state: documentCount ? 'verified' : 'empty', archiveKey: window.key, documentCount, counts, driveFileId: driveFile.id, driveWebViewLink: driveFile.webViewLink, driveFileName: driveFile.name, driveFileSize: Number(driveFile.size ?? 0), deleted: false }
  } catch (error) {
    await manifestRef.set({ state: 'failed', leaseUntil: null, error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown archive error', failedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    throw error
  }
}

async function purgeVerifiedWeek(window: ArchiveWindow): Promise<number> {
  const manifestRef = adminDb.collection('archiveRuns').doc(manifestId(window))
  const manifest = await manifestRef.get()
  if (manifest.get('state') === 'completed') return Number(manifest.get('deletedDocumentCount') ?? 0)
  if (manifest.get('state') !== 'verified') throw new Error(`Week ${window.key} has not been verified on Google Drive.`)
  const paths = manifest.get('documentPaths')
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string')) throw new Error(`Week ${window.key} has invalid saved document paths.`)
  await deleteArchivedDocuments(paths)
  await manifestRef.set({ state: 'completed', deletedDocumentCount: paths.length, deletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  return paths.length
}

export async function runWeeklyArchive(now = new Date()): Promise<WeeklyArchiveResult> {
  const retainedWeek = previousVietnamWeek(now, 1)
  const expiredWeek = previousVietnamWeek(now, 2)
  const retained = await ensureWeekArchived(retainedWeek, now)
  const expiredInactiveSchedules = await expireInactiveEmployeeSchedules(now)
  if (process.env.WEEKLY_ARCHIVE_DELETE_ENABLED !== 'true') return { ...retained, expiredInactiveSchedules }
  await ensureWeekArchived(expiredWeek, now)
  const purgedDocumentCount = await purgeVerifiedWeek(expiredWeek)
  return { ...retained, expiredInactiveSchedules, purgedArchiveKey: expiredWeek.key, purgedDocumentCount }
}

export async function runArchivePreview(referenceDate: Date): Promise<WeeklyArchiveResult> {
  const window = vietnamWeekContaining(referenceDate)
  const { records, counts, documentCount } = await collectDocuments(window)
  const archiveKey = `${window.key}-test-${Date.now()}`
  const json = JSON.stringify({ schemaVersion: WEEKLY_ARCHIVE_SCHEMA_VERSION, testArchive: true, application: 'employee-management-portal', firebaseProjectId: process.env.FIREBASE_ADMIN_PROJECT_ID, archiveKey, sourceWeekKey: window.key, archiveKind: 'weekly', timezone: 'Asia/Ho_Chi_Minh', weekStart: window.start.toISOString(), weekEndExclusive: window.end.toISOString(), exportedAt: new Date().toISOString(), counts, records }, null, 2)
  const checksum = createHash('sha256').update(json).digest('hex')
  const driveFile = await storeWeeklyArchive({ archiveKey, checksum, json })
  return { state: documentCount ? 'verified' : 'empty', archiveKey, documentCount, counts, driveFileId: driveFile.id, driveWebViewLink: driveFile.webViewLink, driveFileName: driveFile.name, driveFileSize: Number(driveFile.size || 0), deleted: false }
}
