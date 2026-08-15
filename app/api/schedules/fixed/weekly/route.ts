import { NextResponse } from 'next/server'
import { runFixedScheduleMaterialization } from '@/lib/server/fixed-schedule-cron'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET chưa được cấu hình.' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Không có quyền tạo lịch cố định.' }, { status: 401 })
  }

  try {
    const result = await runFixedScheduleMaterialization()
    return NextResponse.json({ ok: result.failures.length === 0, result }, { status: result.failures.length ? 207 : 200 })
  } catch (error) {
    console.error('Fixed schedule materialization failed:', error)
    return NextResponse.json({ ok: false, error: 'Không thể tự tạo lịch cố định tuần kế tiếp.' }, { status: 500 })
  }
}
