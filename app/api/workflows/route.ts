import { NextResponse } from 'next/server'
import { ApiError, authenticateRequest } from '@/lib/server/api-auth'
import {
  reviewRequest,
  submitLate,
  submitLeave,
  submitSalaryAdvance,
  submitSchedules,
} from '@/lib/server/workflows'

export const runtime = 'nodejs'

const handlers = {
  submitSchedules,
  submitLeave,
  submitLate,
  submitSalaryAdvance,
  reviewRequest,
} as const

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request)
    const body = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ApiError(400, 'Dữ liệu gửi lên không hợp lệ.')
    }
    const { action, ...payload } = body as Record<string, unknown>
    if (typeof action !== 'string' || !(action in handlers)) {
      throw new ApiError(400, 'Nghiệp vụ không hợp lệ.')
    }
    const result = await handlers[action as keyof typeof handlers](actor, payload)
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500
    const message = error instanceof ApiError
      ? error.message
      : 'Backend chưa sẵn sàng hoặc đã xảy ra lỗi máy chủ.'
    if (!(error instanceof ApiError)) console.error('Workflow API error:', error)
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
