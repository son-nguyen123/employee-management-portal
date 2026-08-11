import { auth } from '@/lib/firebase'

export interface ArchiveFileSummary {
  id: string
  name: string
  archiveKey: string
  size: number
  createdTime?: string
  modifiedTime?: string
  webViewLink?: string
  archiveKind: 'weekly' | 'monthly'
}

export interface ArchivedRecord {
  path: string
  id: string
  data: Record<string, unknown>
}

export interface WeeklyArchivePayload {
  schemaVersion: number
  archiveKey: string
  timezone: string
  archiveKind?: 'weekly' | 'monthly' | 'live'
  weekStart?: string
  weekEndExclusive?: string
  monthStart?: string
  monthEndExclusive?: string
  exportedAt: string
  counts: Record<string, number>
  records: Record<string, ArchivedRecord[]>
}

async function archiveRequest<T>(fileId?: string): Promise<T> {
  const user = auth.currentUser
  if (!user) throw new Error('Bạn cần đăng nhập để mở kho dữ liệu.')
  const token = await user.getIdToken()
  const suffix = fileId ? `?fileId=${encodeURIComponent(fileId)}` : ''
  const response = await fetch(`/api/archive/library${suffix}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  const body = await response.json().catch(() => null) as
    | { ok: true; result: T }
    | { ok: false; error: string }
    | null
  if (!response.ok || !body?.ok) {
    throw new Error(body && 'error' in body ? body.error : 'Chưa thể đọc kho dữ liệu.')
  }
  return body.result
}

export function listArchiveFiles(): Promise<ArchiveFileSummary[]> {
  return archiveRequest<ArchiveFileSummary[]>()
}

export function readArchiveFile(fileId: string): Promise<WeeklyArchivePayload> {
  return archiveRequest<WeeklyArchivePayload>(fileId)
}

export function readCurrentMonthSnapshot(month: string): Promise<WeeklyArchivePayload> {
  const user = auth.currentUser
  if (!user) return Promise.reject(new Error('Bạn cần đăng nhập để đọc dữ liệu hiện tại.'))
  return user.getIdToken().then(async (token) => {
    const response = await fetch(`/api/archive/library?liveMonth=${encodeURIComponent(month)}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    const body = await response.json().catch(() => null) as { ok: boolean; result?: WeeklyArchivePayload; error?: string } | null
    if (!response.ok || !body?.ok || !body.result) throw new Error(body?.error || 'Chưa thể đọc dữ liệu Firestore hiện tại.')
    return body.result
  })
}

export interface ArchivePreviewResult {
  archiveKey: string
  documentCount: number
  deleted: false
  driveFileId?: string
  driveWebViewLink?: string
  driveFileName?: string
  driveFileSize?: number
}

export async function createArchivePreview(referenceDate: string): Promise<ArchivePreviewResult> {
  const user = auth.currentUser
  if (!user) throw new Error('Bạn cần đăng nhập để tạo bản lưu thử.')
  const token = await user.getIdToken()
  const response = await fetch('/api/archive/library', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ referenceDate }),
  })
  const body = await response.json().catch(() => null) as { ok: boolean; result?: ArchivePreviewResult; error?: string } | null
  if (!response.ok || !body?.ok || !body.result) throw new Error(body?.error || 'Chưa thể tạo bản lưu thử.')
  return body.result
}

export async function archivePreviousMonth(): Promise<{ archiveKey: string; state: string; documentCount: number; deletedDocumentCount: number }> {
  const user = auth.currentUser
  if (!user) throw new Error('Bạn cần đăng nhập để lưu dữ liệu tháng.')
  const token = await user.getIdToken()
  const response = await fetch('/api/archive/library', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'archive-previous-month' }),
  })
  const body = await response.json().catch(() => null) as { ok: boolean; result?: { archiveKey: string; state: string; documentCount: number; deletedDocumentCount: number }; error?: string } | null
  if (!response.ok || !body?.ok || !body.result) throw new Error(body?.error || 'Chưa thể lưu dữ liệu tháng trước.')
  return body.result
}
