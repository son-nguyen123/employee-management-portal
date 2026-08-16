import { NextResponse } from 'next/server'
import { runFixedScheduleMaterialization } from '@/lib/server/fixed-schedule-cron'
import { recordOperationalJobFailure, recordOperationalJobSuccess } from '@/lib/server/operational-health'

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
    if (result.failures.length) {
      await recordOperationalJobFailure('fixed-schedules', new Error(`${result.failures.length} nhân viên chưa tạo được lịch cố định.`))
        .catch((alertError) => console.error('Operational alert failed:', alertError))
    } else {
      await recordOperationalJobSuccess('fixed-schedules', { targetWeekStart: result.targetWeekStart, createdSchedules: result.createdSchedules })
        .catch((alertError) => console.error('Operational success record failed:', alertError))
    }
    return NextResponse.json({ ok: result.failures.length === 0, result }, { status: result.failures.length ? 207 : 200 })
  } catch (error) {
    console.error('Fixed schedule materialization failed:', error)
    await recordOperationalJobFailure('fixed-schedules', error).catch((alertError) => console.error('Operational alert failed:', alertError))
    return NextResponse.json({ ok: false, error: 'Không thể tự tạo lịch cố định tuần kế tiếp.' }, { status: 500 })
  }
}
