import { NextResponse } from 'next/server'
import { recordOperationalJobFailure, recordOperationalJobSuccess, runOperationalHealthCheck } from '@/lib/server/operational-health'
import { cleanupExpiredWorkflowRequests } from '@/lib/server/workflow-retention'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return NextResponse.json({ ok: false, error: 'CRON_SECRET chưa được cấu hình.' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Không có quyền kiểm tra hệ thống.' }, { status: 401 })
  }
  try {
    let workflowRequestsDeleted = 0
    try {
      const cleanup = await cleanupExpiredWorkflowRequests()
      workflowRequestsDeleted = cleanup.deleted
      if (cleanup.deleted) console.info(`Cleaned ${cleanup.deleted} expired workflow requests.`)
    } catch (error) {
      console.error('Workflow request cleanup failed:', error)
    }
    const result = await runOperationalHealthCheck()
    await recordOperationalJobSuccess('operational-health', { overall: result.overall, workflowRequestsDeleted })
      .catch((alertError) => console.error('Operational success record failed:', alertError))
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    console.error('Operational health check failed:', error)
    await recordOperationalJobFailure('operational-health', error).catch((alertError) => console.error('Operational alert failed:', alertError))
    return NextResponse.json({ ok: false, error: 'Không thể hoàn tất kiểm tra tình trạng hệ thống.' }, { status: 500 })
  }
}
