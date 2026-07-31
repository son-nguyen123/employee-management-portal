import 'server-only'

import type { DecodedIdToken } from 'firebase-admin/auth'
import { adminAuth, adminDb } from '@/lib/server/firebase-admin'

export type AppRole = 'admin' | 'manager' | 'employee'

export interface RequestActor {
  token: DecodedIdToken
  uid: string
  role: AppRole
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export async function authenticateRequest(request: Request): Promise<RequestActor> {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    throw new ApiError(401, 'Bạn cần đăng nhập để thực hiện thao tác này.')
  }

  let token: DecodedIdToken
  try {
    token = await adminAuth.verifyIdToken(authorization.slice(7), true)
  } catch {
    throw new ApiError(401, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.')
  }

  const profile = await adminDb.collection('employees').doc(token.uid).get()
  if (!profile.exists) {
    throw new ApiError(403, 'Tài khoản chưa có hồ sơ nhân viên.')
  }

  const role = profile.get('role')
  if (!['admin', 'manager', 'employee'].includes(role)) {
    throw new ApiError(403, 'Tài khoản không hoạt động hoặc chưa được phân quyền.')
  }

  if (role === 'employee' && profile.get('status') !== 'active') {
    throw new ApiError(403, profile.get('status') === 'inactive'
      ? 'Tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ quản lý.'
      : 'Hồ sơ đang chờ admin duyệt. Tiện ích sẽ mở sau khi được chấp nhận.')
  }

  return { token, uid: token.uid, role: role as AppRole }
}

export function requireStaff(actor: RequestActor): void {
  if (!['employee', 'manager', 'admin'].includes(actor.role)) {
    throw new ApiError(403, 'Bạn không có quyền gửi yêu cầu.')
  }
}

export function requireManager(actor: RequestActor): void {
  if (!['manager', 'admin'].includes(actor.role)) {
    throw new ApiError(403, 'Chỉ quản lý hoặc admin được xử lý yêu cầu.')
  }
}
