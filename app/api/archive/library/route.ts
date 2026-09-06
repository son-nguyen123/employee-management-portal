import { NextResponse } from 'next/server'
import { ApiError, authenticateRequest, requireManager } from '@/lib/server/api-auth'
import { listAllArchives, readArchive } from '@/lib/server/google-drive-archive'
import { runArchivePreview } from '@/lib/server/weekly-archive'
import { runMonthlyArchive } from '@/lib/server/monthly-archive'
import { getCurrentMonthSnapshot } from '@/lib/server/current-month-snapshot'
import { invalidateMonthDataCache } from '@/lib/server/month-data-cache'
import { scopeArchivePayload, type ArchivePayload } from '@/lib/server/archive-scope'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request)
    requireManager(actor)
    const searchParams = new URL(request.url).searchParams
    const fileId = searchParams.get('fileId')?.trim()
    const liveMonth = searchParams.get('liveMonth')?.trim()
    if (liveMonth && !/^\d{4}-\d{2}$/.test(liveMonth)) throw new ApiError(400, 'Tháng cần có định dạng YYYY-MM.')
    const result = fileId
      ? scopeArchivePayload(actor, await readArchive(fileId) as ArchivePayload)
      : liveMonth
        ? scopeArchivePayload(actor, await getCurrentMonthSnapshot(liveMonth))
        : await listAllArchives()
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

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request)
    requireManager(actor)
    const body = await request.json() as { referenceDate?: unknown; action?: unknown }
    if (body.action === 'archive-previous-month') {
      const result = await runMonthlyArchive()
      invalidateMonthDataCache()
      return NextResponse.json({ ok: true, result })
    }
    if (typeof body.referenceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.referenceDate)) {
      throw new ApiError(400, 'Ngày kiểm thử không hợp lệ.')
    }
    const referenceDate = new Date(`${body.referenceDate}T12:00:00+07:00`)
    if (Number.isNaN(referenceDate.getTime())) throw new ApiError(400, 'Ngày kiểm thử không hợp lệ.')
    const result = await runArchivePreview(referenceDate)
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500
    if (!(error instanceof ApiError)) console.error('Archive preview failed:', error)
    return NextResponse.json({ ok: false, error: error instanceof ApiError ? error.message : 'Chưa thể tạo bản lưu thử trên Google Drive.' }, { status })
  }
}
