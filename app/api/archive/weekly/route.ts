import { NextResponse } from 'next/server'
import { runWeeklyArchive } from '@/lib/server/weekly-archive'
import { recordOperationalJobFailure, recordOperationalJobSuccess } from '@/lib/server/operational-health'

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
    await recordOperationalJobSuccess('weekly-archive', { state: result.state, archiveKey: result.archiveKey })
      .catch((alertError) => console.error('Operational success record failed:', alertError))
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    console.error('Weekly archive failed:', error)
    await recordOperationalJobFailure('weekly-archive', error).catch((alertError) => console.error('Operational alert failed:', alertError))
    return NextResponse.json(
      {
        ok: false,
        error: 'Không thể lưu dữ liệu tuần lên Google Drive. Firestore chưa bị xóa.',
      },
      { status: 500 },
    )
  }
}
