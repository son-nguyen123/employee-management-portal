import { auth } from '@/lib/firebase'

export interface ArchiveFileSummary {
  id: string
  name: string
  archiveKey: string
  size: number
  createdTime?: string
  modifiedTime?: string
  webViewLink?: string
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
  weekStart: string
  weekEndExclusive: string
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
