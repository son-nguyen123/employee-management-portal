import { NextResponse } from 'next/server'
import { runMonthlyArchive } from '@/lib/server/monthly-archive'
import { invalidateMonthDataCache } from '@/lib/server/month-data-cache'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return NextResponse.json({ ok: false, error: 'CRON_SECRET chưa được cấu hình.' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: 'Không có quyền chạy lưu trữ.' }, { status: 401 })
  try {
    const result = await runMonthlyArchive()
    invalidateMonthDataCache()
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    console.error('Monthly archive failed:', error)
    return NextResponse.json({ ok: false, error: 'Không thể lưu dữ liệu tháng lên Google Drive. Firestore chỉ được xóa sau khi bản lưu được xác minh.' }, { status: 500 })
  }
}
