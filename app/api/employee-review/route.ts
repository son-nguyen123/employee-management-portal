import { NextResponse } from 'next/server'
import { ApiError, authenticateRequest, requireManager } from '@/lib/server/api-auth'
import { buildEmployeeReviewContext } from '@/lib/server/employee-review'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request)
    requireManager(actor)
    const body = await request.json() as { employeeId?: unknown; referenceDate?: unknown }
    if (typeof body.employeeId !== 'string' || !/^[^\s/]{1,128}$/.test(body.employeeId)) {
      throw new ApiError(400, 'Nhân viên cần kiểm tra không hợp lệ.')
    }
    if (typeof body.referenceDate !== 'string') throw new ApiError(400, 'Ngày tham chiếu không hợp lệ.')
    const referenceDate = new Date(body.referenceDate)
    if (Number.isNaN(referenceDate.getTime())) throw new ApiError(400, 'Ngày tham chiếu không hợp lệ.')

    const result = await buildEmployeeReviewContext(body.employeeId, referenceDate)
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500
    if (!(error instanceof ApiError)) console.error('Employee review failed:', error)
    return NextResponse.json({
      ok: false,
      error: error instanceof ApiError ? error.message : 'Chưa thể tổng hợp dữ liệu kiểm tra nhân viên.',
    }, { status })
  }
}
