import { NextResponse } from 'next/server'
import { ApiError, authenticateRequest } from '@/lib/server/api-auth'
import {
  cancelRequest,
  cancelScheduleBatch,
  createForgottenDutyPenalty,
  managePenalty,
  reviewRequest,
  reviewScheduleBatch,
  getWeeklyScheduleTarget,
  updateWeeklyScheduleTarget,
  getManagementContact,
  replaceSchedules,
  reviseRequest,
  setScheduleBatchEditing,
  submitLate,
  submitLeave,
  submitSalaryAdvance,
  submitStaffRequest,
  submitSchedules,
} from '@/lib/server/workflows'

export const runtime = 'nodejs'

const handlers = {
  submitSchedules,
  replaceSchedules,
  submitLeave,
  submitLate,
  submitSalaryAdvance,
  submitStaffRequest,
  reviseRequest,
  cancelRequest,
  cancelScheduleBatch,
  setScheduleBatchEditing,
  createForgottenDutyPenalty,
  managePenalty,
  reviewRequest,
  reviewScheduleBatch,
  getWeeklyScheduleTarget,
  updateWeeklyScheduleTarget,
  getManagementContact,
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

  const normalizedDetails = details.toLowerCase()
  const credentialError = [
    'firebase admin private key không hợp lệ',
    'failed to parse private key',
    'invalid pem formatted message',
    'app/invalid-credential',
    'could not load the default credentials',
    'invalid_grant',
    'invalid jwt signature',
    'failed to fetch a valid google oauth2 access token',
    'credential implementation provided to initializeapp',
  ].some((fragment) => normalizedDetails.includes(fragment))

  if (credentialError) {
    return {
      status: 503,
      message: 'Firebase Admin không xác thực được. Project ID, client email và private key phải lấy cùng một file service account; sau đó redeploy Vercel.',
    }
  }

  const firestorePermissionError =
    normalizedDetails.includes('permission_denied') ||
    normalizedDetails.includes('permission denied') ||
    normalizedDetails.includes('missing or insufficient permissions')

  if (firestorePermissionError) {
    return {
      status: 503,
      message: 'Service account của backend chưa có quyền truy cập Firestore trong project này.',
    }
  }

  const firestoreTargetError =
    normalizedDetails.includes('database (default) does not exist') ||
    normalizedDetails.includes('the database (default) does not exist') ||
    normalizedDetails.includes('project was not found')

  if (firestoreTargetError) {
    return {
      status: 503,
      message: 'Firebase Admin đang trỏ sai project hoặc không tìm thấy Firestore database (default).',
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
