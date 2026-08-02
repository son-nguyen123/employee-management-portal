import { auth } from '@/lib/firebase'
import type { EmployeeReviewContext } from '@/lib/models/employeeReview'

export async function getEmployeeReviewContext(
  employeeId: string,
  referenceDate: Date
): Promise<EmployeeReviewContext> {
  const user = auth.currentUser
  if (!user) throw new Error('Bạn cần đăng nhập để kiểm tra nhân viên.')
  const token = await user.getIdToken()
  const response = await fetch('/api/employee-review', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ employeeId, referenceDate: referenceDate.toISOString() }),
    cache: 'no-store',
  })
  const body = await response.json().catch(() => null) as
    | { ok: true; result: EmployeeReviewContext }
    | { ok: false; error: string }
    | null
  if (!response.ok || !body?.ok) {
    throw new Error(body && 'error' in body ? body.error : 'Chưa thể tải đánh giá nhân viên.')
  }
  return body.result
}
