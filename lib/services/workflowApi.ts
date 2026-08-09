import { auth } from '@/lib/firebase'

type WorkflowAction =
  | 'submitSchedules'
  | 'replaceSchedules'
  | 'submitLeave'
  | 'submitLate'
  | 'submitSalaryAdvance'
  | 'submitStaffRequest'
  | 'reviseRequest'
  | 'cancelRequest'
  | 'cancelScheduleBatch'
  | 'adminCancelSchedules'
  | 'setScheduleBatchEditing'
  | 'createForgottenDutyPenalty'
  | 'createManualPenalty'
  | 'managePenalty'
  | 'reviewRequest'
  | 'reviewScheduleBatch'
  | 'getWeeklyScheduleTarget'
  | 'getDutyAvailability'
  | 'normalizeLeaveRequests'
  | 'updateWeeklyScheduleTarget'
  | 'getManagementContact'
  | 'getPushDiagnostics'
  | 'sendTestPush'
  | 'getAuditReceiptSettings'
  | 'updateAuditReceiptSettings'
  | 'manageEmployeeStatus'
  | 'setEmployeeScheduleMode'
  | 'ensureFixedSchedule'
  | 'getAccountRegistrationWindow'
  | 'updateAccountRegistrationWindow'
  | 'respondPenaltyConsent'

export async function callWorkflowApi<T>(
  action: WorkflowAction,
  payload: Record<string, unknown>
): Promise<T> {
  const user = auth.currentUser
  if (!user) throw new Error('Bạn cần đăng nhập để thực hiện thao tác này.')
  const idToken = await user.getIdToken()
  const response = await fetch('/api/workflows', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ action, ...payload }),
  })
  const data = await response.json().catch(() => null) as
    | { ok: true; result: T }
    | { ok: false; error: string }
    | null
  if (!response.ok || !data?.ok) {
    if (response.status === 404) {
      throw new Error(
        'Bản triển khai đang mở chưa có backend nghiệp vụ. Hãy đưa deployment mới nhất lên Production trên Vercel.'
      )
    }
    throw new Error(data && 'error' in data ? data.error : 'Không thể xử lý yêu cầu.')
  }
  return data.result
}

export function newWorkflowRequestId(): string {
  return crypto.randomUUID()
}
