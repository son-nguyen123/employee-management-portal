import { NextResponse } from 'next/server'
import { runWeeklyArchive } from '@/lib/server/weekly-archive'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET chưa được cấu hình.' },
      { status: 503 },
    )
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Không có quyền chạy lưu trữ.' }, { status: 401 })
  }

  try {
    const result = await runWeeklyArchive()
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    console.error('Weekly archive failed:', error)
    return NextResponse.json(
      {
        ok: false,
        error: 'Không thể lưu dữ liệu tuần lên Google Drive. Firestore chưa bị xóa.',
      },
      { status: 500 },
    )
  }
}
