import 'server-only'

import { createHash } from 'node:crypto'
import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore'
import { adminDb } from '@/lib/server/firebase-admin'
import { storeWeeklyArchive } from '@/lib/server/google-drive-archive'

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const MAX_ARCHIVE_DOCUMENTS = 4_000
const FINAL_SCHEDULE_STATUSES = new Set(['Approved', 'Rejected', 'Cancelled'])
const FINAL_REQUEST_STATUSES = new Set(['Approved', 'Rejected'])

interface ArchivedDocument {
  path: string
  id: string
  data: unknown
}

interface ArchiveWindow {
  key: string
  start: Date
  end: Date
}

export interface WeeklyArchiveResult {
  state: 'already-completed' | 'verified' | 'completed' | 'empty'
  archiveKey: string
  documentCount: number
  counts: Record<string, number>
  driveFileId?: string
  driveWebViewLink?: string
  deleted: boolean
}

function formatVietnamDate(date: Date): string {
  const shifted = new Date(date.getTime() + VIETNAM_OFFSET_MS)
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

function previousVietnamWeek(now: Date): ArchiveWindow {
  const shifted = new Date(now.getTime() + VIETNAM_OFFSET_MS)
  const weekday = shifted.getUTCDay() || 7
  const currentMondayShifted = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() - weekday + 1,
  )
  const currentMonday = new Date(currentMondayShifted - VIETNAM_OFFSET_MS)
  const previousMonday = new Date(currentMonday.getTime() - WEEK_MS)

  return {
    key: formatVietnamDate(previousMonday),
    start: previousMonday,
    end: currentMonday,
  }
}

function normalizeForJson(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(normalizeForJson)
  if (typeof value === 'object') {
    const candidate = value as { toDate?: () => Date }
    if (typeof candidate.toDate === 'function') {
      return candidate.toDate().toISOString()
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, nested]) => [key, normalizeForJson(nested)]),
    )
  }
  return value
}

function archiveDocument(snapshot: QueryDocumentSnapshot<DocumentData>): ArchivedDocument {
  return {
    path: snapshot.ref.path,
    id: snapshot.id,
    data: normalizeForJson(snapshot.data()),
  }
}

function timestampWithin(value: unknown, window: ArchiveWindow): boolean {
  const date = value instanceof Timestamp
    ? value.toDate()
    : value instanceof Date
      ? value
      : null
  return Boolean(date && date >= window.start && date < window.end)
}

async function collectDocuments(window: ArchiveWindow): Promise<{
  records: Record<string, ArchivedDocument[]>
  paths: string[]
  counts: Record<string, number>
}> {
  const start = Timestamp.fromDate(window.start)
  const end = Timestamp.fromDate(window.end)
  const [schedules, leaveCandidates, lateRequests] = await Promise.all([
    adminDb.collection('workSchedules')
      .where('date', '>=', start)
      .where('date', '<', end)
      .get(),
    adminDb.collection('leaveRequests')
      .where('leaveDate', '<', end)
      .get(),
    adminDb.collection('lateRequests')
      .where('date', '>=', start)
      .where('date', '<', end)
      .get(),
  ])

  const records = {
    workSchedules: schedules.docs
      .filter((doc) => FINAL_SCHEDULE_STATUSES.has(String(doc.get('status'))))
      .map(archiveDocument),
    leaveRequests: leaveCandidates.docs
      .filter((doc) => {
        if (!FINAL_REQUEST_STATUSES.has(String(doc.get('status')))) return false
        return timestampWithin(doc.get('endDate') ?? doc.get('leaveDate'), window)
      })
      .map(archiveDocument),
    lateRequests: lateRequests.docs
      .filter((doc) => FINAL_REQUEST_STATUSES.has(String(doc.get('status'))))
      .map(archiveDocument),
  }
  const counts = Object.fromEntries(
    Object.entries(records).map(([collection, documents]) => [collection, documents.length]),
  )
  const paths = Object.values(records).flat().map((record) => record.path)

  if (paths.length > MAX_ARCHIVE_DOCUMENTS) {
    throw new Error(
      `Archive contains ${paths.length} documents; maximum safe batch is ${MAX_ARCHIVE_DOCUMENTS}.`,
    )
  }
  return { records, paths, counts }
}

async function deleteArchivedDocuments(paths: string[]): Promise<void> {
  for (let offset = 0; offset < paths.length; offset += 450) {
    const batch = adminDb.batch()
    for (const path of paths.slice(offset, offset + 450)) {
      batch.delete(adminDb.doc(path))
    }
    await batch.commit()
  }
}

export async function runWeeklyArchive(now = new Date()): Promise<WeeklyArchiveResult> {
  const window = previousVietnamWeek(now)
  const manifestRef = adminDb.collection('archiveRuns').doc(window.key)
  const deleteEnabled = process.env.WEEKLY_ARCHIVE_DELETE_ENABLED === 'true'
  const existing = await manifestRef.get()

  if (existing.get('state') === 'completed') {
    return {
      state: 'already-completed',
      archiveKey: window.key,
      documentCount: Number(existing.get('documentCount') ?? 0),
      counts: existing.get('counts') ?? {},
      driveFileId: existing.get('driveFileId'),
      driveWebViewLink: existing.get('driveWebViewLink'),
      deleted: true,
    }
  }

  if (existing.get('state') === 'verified' && !deleteEnabled) {
    return {
      state: 'verified',
      archiveKey: window.key,
      documentCount: Number(existing.get('documentCount') ?? 0),
      counts: existing.get('counts') ?? {},
      driveFileId: existing.get('driveFileId'),
      driveWebViewLink: existing.get('driveWebViewLink'),
      deleted: false,
    }
  }

  if (existing.get('state') === 'verified' && deleteEnabled) {
    const savedPaths = existing.get('documentPaths')
    if (!Array.isArray(savedPaths) || savedPaths.some((path) => typeof path !== 'string')) {
      throw new Error('Verified archive manifest has invalid document paths.')
    }
    await deleteArchivedDocuments(savedPaths)
    await manifestRef.set({
      state: 'completed',
      deletedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return {
      state: 'completed',
      archiveKey: window.key,
      documentCount: Number(existing.get('documentCount') ?? 0),
      counts: existing.get('counts') ?? {},
      driveFileId: existing.get('driveFileId'),
      driveWebViewLink: existing.get('driveWebViewLink'),
      deleted: true,
    }
  }

  const { records, paths, counts } = await collectDocuments(window)
  if (paths.length === 0) {
    await manifestRef.set({
      state: 'completed',
      archiveKey: window.key,
      weekStart: Timestamp.fromDate(window.start),
      weekEndExclusive: Timestamp.fromDate(window.end),
      documentCount: 0,
      counts,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return {
      state: 'empty',
      archiveKey: window.key,
      documentCount: 0,
      counts,
      deleted: false,
    }
  }

  const payload = {
    schemaVersion: 1,
    application: 'employee-management-portal',
    firebaseProjectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    archiveKey: window.key,
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
    if (
      current.get('state') === 'exporting' &&
      leaseUntil instanceof Timestamp &&
      leaseUntil.toMillis() > Date.now()
    ) {
      return false
    }
    if (current.get('state') === 'completed' || current.get('state') === 'verified') {
      return false
    }

    transaction.set(manifestRef, {
      state: 'exporting',
      archiveKey: window.key,
      weekStart: Timestamp.fromDate(window.start),
      weekEndExclusive: Timestamp.fromDate(window.end),
      documentCount: paths.length,
      documentPaths: paths,
      counts,
      checksum,
      leaseUntil: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: current.get('createdAt') ?? FieldValue.serverTimestamp(),
    }, { merge: true })
    return true
  })
  if (!lockAcquired) {
    throw new Error('This weekly archive is already running or has already been verified.')
  }

  try {
    const driveFile = await storeWeeklyArchive({
      archiveKey: window.key,
      checksum,
      json,
    })
    await manifestRef.set({
      state: 'verified',
      driveFileId: driveFile.id,
      driveFileName: driveFile.name,
      driveFileSize: Number(driveFile.size ?? 0),
      driveMd5Checksum: driveFile.md5Checksum ?? null,
      driveWebViewLink: driveFile.webViewLink ?? null,
      leaseUntil: null,
      verifiedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })

    if (!deleteEnabled) {
      return {
        state: 'verified',
        archiveKey: window.key,
        documentCount: paths.length,
        counts,
        driveFileId: driveFile.id,
        driveWebViewLink: driveFile.webViewLink,
        deleted: false,
      }
    }

    await deleteArchivedDocuments(paths)
    await manifestRef.set({
      state: 'completed',
      deletedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return {
      state: 'completed',
      archiveKey: window.key,
      documentCount: paths.length,
      counts,
      driveFileId: driveFile.id,
      driveWebViewLink: driveFile.webViewLink,
      deleted: true,
    }
  } catch (error) {
    await manifestRef.set({
      state: 'failed',
      leaseUntil: null,
      error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown archive error',
      failedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    throw error
  }
}
