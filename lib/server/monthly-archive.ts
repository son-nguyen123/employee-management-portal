import 'server-only'

import { createHash } from 'node:crypto'
import { FieldValue, Timestamp, type DocumentData, type DocumentSnapshot } from 'firebase-admin/firestore'
import { previousVietnamMonth } from '@/lib/archive/retention'
import { adminDb } from '@/lib/server/firebase-admin'
import { storeMonthlyArchive } from '@/lib/server/google-drive-archive'

const FINAL_ADVANCE_STATUSES = new Set(['Approved', 'Rejected', 'Cancelled'])

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

function archived(snapshot: DocumentSnapshot<DocumentData>) {
  return { path: snapshot.ref.path, id: snapshot.id, data: normalizeForJson(snapshot.data()) }
}

async function deletePaths(paths: string[]) {
  for (let offset = 0; offset < paths.length; offset += 450) {
    const batch = adminDb.batch()
    paths.slice(offset, offset + 450).forEach((path) => batch.delete(adminDb.doc(path)))
    await batch.commit()
  }
}

export interface MonthlyArchiveResult {
  state: 'already-completed' | 'completed' | 'verified'
  archiveKey: string
  documentCount: number
  deletedDocumentCount: number
  counts: Record<string, number>
  driveFileId?: string
  driveWebViewLink?: string
}

export async function runMonthlyArchive(now = new Date()): Promise<MonthlyArchiveResult> {
  const window = previousVietnamMonth(now)
  const manifestRef = adminDb.collection('archiveRuns').doc(`monthly-${window.key}`)
  const existing = await manifestRef.get()
  if (existing.get('state') === 'completed') {
    return { state: 'already-completed', archiveKey: window.key, documentCount: Number(existing.get('documentCount') ?? 0), deletedDocumentCount: Number(existing.get('deletedDocumentCount') ?? 0), counts: existing.get('counts') ?? {}, driveFileId: existing.get('driveFileId'), driveWebViewLink: existing.get('driveWebViewLink') }
  }

  if (existing.get('state') === 'verified') {
    const paths = existing.get('documentPaths')
    if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string')) throw new Error(`Monthly archive ${window.key} has invalid saved document paths.`)
    if (process.env.MONTHLY_ARCHIVE_DELETE_ENABLED !== 'true') {
      return { state: 'verified', archiveKey: window.key, documentCount: Number(existing.get('documentCount') ?? 0), deletedDocumentCount: 0, counts: existing.get('counts') ?? {}, driveFileId: existing.get('driveFileId'), driveWebViewLink: existing.get('driveWebViewLink') }
    }
    await deletePaths(paths)
    await manifestRef.set({ state: 'completed', deletedDocumentCount: paths.length, deletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return { state: 'completed', archiveKey: window.key, documentCount: Number(existing.get('documentCount') ?? 0), deletedDocumentCount: paths.length, counts: existing.get('counts') ?? {}, driveFileId: existing.get('driveFileId'), driveWebViewLink: existing.get('driveWebViewLink') }
  }

  const start = Timestamp.fromDate(window.start)
  const end = Timestamp.fromDate(window.end)
  const [penaltySnapshots, advanceSnapshots] = await Promise.all([
    adminDb.collection('penalties').where('penaltyDate', '>=', start).where('penaltyDate', '<', end).get(),
    adminDb.collection('salaryAdvances').where('createdAt', '>=', start).where('createdAt', '<', end).get(),
  ])
  const penalties = penaltySnapshots.docs.map(archived)
  const salaryAdvances = advanceSnapshots.docs.map(archived)
  const employeeIds = new Set<string>()
  ;[...penalties, ...salaryAdvances].forEach((record) => {
    const employeeId = (record.data as Record<string, unknown>).employeeId
    if (typeof employeeId === 'string') employeeIds.add(employeeId)
  })
  const employeeSnapshots = await Promise.all(Array.from(employeeIds).map((uid) => adminDb.collection('employees').doc(uid).get()))
  const employeeProfiles = employeeSnapshots.filter((snapshot) => snapshot.exists).map(archived)
  const records = { penalties, salaryAdvances, employeeProfiles }
  const counts = Object.fromEntries(Object.entries(records).map(([key, value]) => [key, value.length]))
  const documentCount = penalties.length + salaryAdvances.length + employeeProfiles.length
  const documentPaths = [
    ...penalties.map((record) => record.path),
    ...salaryAdvances.filter((record) => FINAL_ADVANCE_STATUSES.has(String((record.data as Record<string, unknown>).status))).map((record) => record.path),
  ]
  const payload = { schemaVersion: 1, application: 'employee-management-portal', firebaseProjectId: process.env.FIREBASE_ADMIN_PROJECT_ID, archiveKind: 'monthly', archiveKey: window.key, timezone: 'Asia/Ho_Chi_Minh', monthStart: window.start.toISOString(), monthEndExclusive: window.end.toISOString(), exportedAt: now.toISOString(), counts, records }
  const json = JSON.stringify(payload, null, 2)
  const checksum = createHash('sha256').update(json).digest('hex')

  await manifestRef.set({ state: 'exporting', archiveKind: 'monthly', archiveKey: window.key, monthStart: start, monthEndExclusive: end, documentCount, documentPaths, counts, checksum, updatedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp() }, { merge: true })
  try {
    const driveFile = await storeMonthlyArchive({ archiveKey: window.key, checksum, json })
    await manifestRef.set({ state: 'verified', driveFileId: driveFile.id, driveFileName: driveFile.name, driveFileSize: Number(driveFile.size ?? 0), driveMd5Checksum: driveFile.md5Checksum ?? null, driveWebViewLink: driveFile.webViewLink ?? null, verifiedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    if (process.env.MONTHLY_ARCHIVE_DELETE_ENABLED !== 'true') return { state: 'verified', archiveKey: window.key, documentCount, deletedDocumentCount: 0, counts, driveFileId: driveFile.id, driveWebViewLink: driveFile.webViewLink }
    await deletePaths(documentPaths)
    await manifestRef.set({ state: 'completed', deletedDocumentCount: documentPaths.length, deletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return { state: 'completed', archiveKey: window.key, documentCount, deletedDocumentCount: documentPaths.length, counts, driveFileId: driveFile.id, driveWebViewLink: driveFile.webViewLink }
  } catch (error) {
    await manifestRef.set({ state: 'failed', error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown archive error', failedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    throw error
  }
}
