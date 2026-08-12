import { NextResponse } from 'next/server'
import { ApiError, authenticateRequest } from '@/lib/server/api-auth'
import { getAuthorizedMonthData } from '@/lib/server/month-data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request)
    const params = new URL(request.url).searchParams
    const month = params.get('month')?.trim() || ''
    const resource = params.get('resource')?.trim()
    if (!/^\d{4}-\d{2}$/.test(month)) throw new ApiError(400, 'Tháng cần có định dạng YYYY-MM.')
    if (resource !== 'penalties' && resource !== 'salaryAdvances') throw new ApiError(400, 'Loại dữ liệu không hợp lệ.')

    return NextResponse.json({ ok: true, result: await getAuthorizedMonthData(actor, month, resource) })
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500
    if (!(error instanceof ApiError)) console.error('Month data failed:', error)
    return NextResponse.json({ ok: false, error: error instanceof ApiError ? error.message : 'Chưa thể tải dữ liệu theo tháng.' }, { status })
  }
}
