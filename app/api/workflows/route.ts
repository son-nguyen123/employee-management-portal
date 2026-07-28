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

function safeServerError(error: unknown): { status: number; message: string } {
  if (error instanceof ApiError) {
    return { status: error.status, message: error.message }
  }

  const details = error instanceof Error ? error.message : ''
  if (details.startsWith('Thiếu biến môi trường server ')) {
    return {
      status: 503,
      message: 'Backend chưa cấu hình đủ biến Firebase Admin trên môi trường đang chạy.',
    }
  }

  const credentialError =
    details.includes('Firebase Admin private key không hợp lệ') ||
    details.includes('Failed to parse private key') ||
    details.includes('Invalid PEM formatted message') ||
    details.includes('app/invalid-credential') ||
    details.includes('Could not load the default credentials')

  if (credentialError) {
    return {
      status: 503,
      message: 'Thông tin Firebase Admin trên máy chủ không hợp lệ. Hãy kiểm tra lại service account rồi redeploy Vercel.',
    }
  }

  return {
    status: 500,
    message: 'Backend chưa sẵn sàng hoặc đã xảy ra lỗi máy chủ.',
  }
}

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
    const { status, message } = safeServerError(error)
    if (!(error instanceof ApiError)) console.error('Workflow API error:', error)
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
