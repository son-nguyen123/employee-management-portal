import { NextResponse } from 'next/server'
import { ApiError, authenticateRequest, requireManager } from '@/lib/server/api-auth'
import { listWeeklyArchives, readWeeklyArchive } from '@/lib/server/google-drive-archive'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request)
    requireManager(actor)
    const fileId = new URL(request.url).searchParams.get('fileId')?.trim()
    const result = fileId
      ? await readWeeklyArchive(fileId)
      : await listWeeklyArchives()
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500
    const details = error instanceof Error ? error.message : ''
    const notConfigured = details.includes('Missing server environment variable')
    if (!(error instanceof ApiError)) console.error('Archive library failed:', error)
    return NextResponse.json({
      ok: false,
      error: notConfigured
        ? 'Kho dữ liệu chưa được cấu hình kết nối Google Drive trên server.'
        : status === 401 || status === 403
          ? details
          : 'Chưa thể đọc kho dữ liệu Google Drive.',
    }, { status: notConfigured ? 503 : status })
  }
}
