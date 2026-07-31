import 'server-only'

import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminAuth, adminDb, adminMessaging } from '@/lib/server/firebase-admin'
import { ApiError, type RequestActor, requireManager, requireStaff } from '@/lib/server/api-auth'
import { workflowPolicy } from '@/lib/server/workflow-policy'
import { auditReceiptCapability } from '@/lib/server/audit-trail'
import { cancelQueuedAuditEmails } from '@/lib/server/audit-email'

type Shift = 'Morning' | 'Afternoon' | 'Evening'
type ReviewStatus = 'Approved' | 'Rejected' | 'ChangesRequested'
type RequestReviewStatus = Exclude<ReviewStatus, 'ChangesRequested'>

const shifts: Shift[] = ['Morning', 'Afternoon', 'Evening']
const shiftStartTime: Record<Shift, string> = {
  Morning: '07:30',
  Afternoon: '13:00',
  Evening: '18:00',
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'Dữ liệu gửi lên không hợp lệ.')
  }
  return value as Record<string, unknown>
}

function text(value: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string') throw new ApiError(400, `${field} không hợp lệ.`)
  const result = value.trim()
  if ((!allowEmpty && !result) || result.length > max) {
    throw new ApiError(400, `${field} không hợp lệ.`)
  }
  return result
}

function numberValue(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ApiError(400, `${field} không hợp lệ.`)
  }
  return value
}

function dateValue(value: unknown, field: string): Date {
  if (typeof value !== 'string') throw new ApiError(400, `${field} không hợp lệ.`)
  const result = new Date(value)
  if (Number.isNaN(result.getTime())) throw new ApiError(400, `${field} không hợp lệ.`)
  return result
}

function requestId(body: Record<string, unknown>): string {
  const id = text(body.requestId, 'Mã yêu cầu', 100)
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new ApiError(400, 'Mã yêu cầu không hợp lệ.')
  return id
}

function weekKey(value: unknown): string {
  const result = text(value, 'Tuần áp dụng', 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) {
    throw new ApiError(400, 'Tuần áp dụng không hợp lệ.')
  }
  return result
}

export async function getWeeklyScheduleTarget(actor: RequestActor, raw: unknown) {
  requireManager(actor)
  const body = objectBody(raw)
  const weekStart = weekKey(body.weekStart)
  const snapshot = await adminDb.collection('weeklyScheduleTargets').doc(weekStart).get()
  return {
    weekStart,
    expectedEmployees: snapshot.exists ? Number(snapshot.get('expectedEmployees') || 0) : 0,
  }
}

export async function updateWeeklyScheduleTarget(actor: RequestActor, raw: unknown) {
  requireManager(actor)
  const body = objectBody(raw)
  const weekStart = weekKey(body.weekStart)
  const expectedEmployees = numberValue(body.expectedEmployees, 'Số nhân viên', 1, 1000)
  if (!Number.isInteger(expectedEmployees)) {
    throw new ApiError(400, 'Số nhân viên phải là số nguyên.')
  }
  const ref = adminDb.collection('weeklyScheduleTargets').doc(weekStart)
  const current = await ref.get()
  await ref.set({
    weekStart,
    expectedEmployees,
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: current.exists ? current.get('createdAt') : FieldValue.serverTimestamp(),
  }, { merge: true })
  return { weekStart, expectedEmployees }
}

export async function getManagementContact(actor: RequestActor) {
  requireStaff(actor)
  const snapshot = await adminDb.collection('employees').where('status', '==', 'active').get()
  const managers = snapshot.docs
    .map((document): Record<string, unknown> & { uid: string } => ({
      uid: document.id,
      ...(document.data() as Record<string, unknown>),
    }))
    .filter((employee) => ['manager', 'admin'].includes(String(employee.role)))
    .sort((left, right) => Number(right.role === 'manager') - Number(left.role === 'manager'))
  const contact = managers.find((employee) =>
    typeof employee.facebookUrl === 'string' && /^https?:\/\//i.test(employee.facebookUrl)
  )
  return {
    uid: contact?.uid || '',
    fullName: contact && typeof contact.fullName === 'string' ? contact.fullName : 'Quản lý',
    photoURL: contact && typeof contact.photoURL === 'string' ? contact.photoURL : '',
    facebookUrl: contact && typeof contact.facebookUrl === 'string' ? contact.facebookUrl : '',
  }
}

export async function getAuditReceiptSettings(actor: RequestActor) {
  requireManager(actor)
  const snapshot = await adminDb.collection('managementSettings').doc('auditReceipts').get()
  return {
    emailEnabled: snapshot.get('emailEnabled') === true,
    ...auditReceiptCapability(),
  }
}

export async function updateAuditReceiptSettings(actor: RequestActor, raw: unknown) {
  requireManager(actor)
  const body = objectBody(raw)
  if (typeof body.emailEnabled !== 'boolean') {
    throw new ApiError(400, 'Trạng thái gửi email không hợp lệ.')
  }
  const capability = auditReceiptCapability()
  if (body.emailEnabled && !capability.emailConfigured) {
    throw new ApiError(503, 'Gmail chưa được cấu hình đầy đủ hoặc công tắc môi trường đang tắt.')
  }

  await adminDb.collection('managementSettings').doc('auditReceipts').set({
    emailEnabled: body.emailEnabled,
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  const cancelledQueuedEmails = body.emailEnabled ? 0 : await cancelQueuedAuditEmails()
  return {
    emailEnabled: body.emailEnabled,
    cancelledQueuedEmails,
    ...capability,
  }
}

export async function manageEmployeeStatus(actor: RequestActor, raw: unknown) {
  requireManager(actor)
  if (actor.role !== 'admin') throw new ApiError(403, 'Chỉ admin được duyệt hoặc khóa tài khoản.')
  const body = objectBody(raw)
  const employeeId = text(body.employeeId, 'Nhân viên', 128)
  const status = text(body.status, 'Trạng thái', 20) as 'active' | 'inactive'
  if (!['active', 'inactive'].includes(status)) throw new ApiError(400, 'Trạng thái tài khoản không hợp lệ.')
  if (employeeId === actor.uid && status === 'inactive') throw new ApiError(409, 'Bạn không thể tự khóa tài khoản admin đang dùng.')
  const employeeRef = adminDb.collection('employees').doc(employeeId)
  await adminDb.runTransaction(async (transaction) => {
    const employee = await transaction.get(employeeRef)
    if (!employee.exists) throw new ApiError(404, 'Không tìm thấy nhân viên.')
    const now = FieldValue.serverTimestamp()
    transaction.set(employeeRef, { status, statusChangedBy: actor.uid, statusChangedAt: now, updatedAt: now }, { merge: true })
    transaction.set(adminDb.collection('notifications').doc(`account-status-${employeeId}`), {
      employeeId,
      title: status === 'active' ? 'Tài khoản đã được chấp nhận' : 'Tài khoản đã bị vô hiệu hóa',
      message: status === 'active' ? 'Quản lý đã duyệt hồ sơ. Bạn có thể sử dụng đầy đủ các tính năng.' : 'Quản lý đã tạm khóa quyền sử dụng tài khoản này.',
      type: status === 'active' ? 'success' : 'warning',
      isRead: false,
      createdAt: now,
    })
  })
  if (status === 'inactive') await adminAuth.revokeRefreshTokens(employeeId)
  return { employeeId, status }
}

export async function respondPenaltyConsent(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  const body = objectBody(raw)
  const id = text(body.id, 'Mã yêu cầu nghỉ', 128)
  if (typeof body.accepted !== 'boolean') throw new ApiError(400, 'Lựa chọn xác nhận không hợp lệ.')
  const accepted = body.accepted
  const leaveRef = adminDb.collection('leaveRequests').doc(id)
  const penaltyRef = adminDb.collection('penalties').doc(`leave-decision-${id}`)
  const managerIds = await activeManagerIds()
  let amount = 0

  await adminDb.runTransaction(async (transaction) => {
    const leave = await transaction.get(leaveRef)
    if (!leave.exists || leave.get('employeeId') !== actor.uid) throw new ApiError(404, 'Không tìm thấy yêu cầu nghỉ.')
    if (leave.get('status') !== 'AwaitingEmployeeConsent' || leave.get('penaltyConsentStatus') !== 'Pending') {
      throw new ApiError(409, 'Đề nghị mức trừ này đã được xử lý.')
    }
    amount = Number(leave.get('proposedPenaltyAmount') || 0)
    if (amount <= 0) throw new ApiError(409, 'Yêu cầu này không có mức trừ cần xác nhận.')
    const affectedSchedules = accepted && leave.get('duration') === 'long'
      ? await transaction.get(adminDb.collection('workSchedules').where('employeeId', '==', actor.uid))
      : null
    const now = FieldValue.serverTimestamp()
    if (accepted) {
      transaction.set(penaltyRef, {
        ...penaltyData({
          employeeId: actor.uid,
          title: 'Nghỉ được duyệt kèm mức trừ',
          description: 'Nhân viên đã đồng ý mức trừ do quản lý đề xuất khi duyệt yêu cầu nghỉ.',
          category: 'Late',
          amount,
          sourceType: 'leaveRequest',
          sourceId: id,
        }),
        status: 'Active',
        decisionStatus: 'Approved',
        updatedAt: now,
      }, { merge: true })
      if (affectedSchedules) {
        const start = (leave.get('leaveDate') as Timestamp).toDate()
        const end = (leave.get('endDate') as Timestamp | undefined)?.toDate() ?? start
        affectedSchedules.docs.forEach((snapshot) => {
          const date = (snapshot.get('date') as Timestamp).toDate()
          if (snapshot.get('status') === 'Approved' && vietnamDateKey(date) >= vietnamDateKey(start) && vietnamDateKey(date) <= vietnamDateKey(end)) {
            transaction.set(snapshot.ref, { status: 'Cancelled', cancellationReason: `Tự động hủy do nghỉ dài hạn được duyệt (${id}).`, cancelledBy: actor.uid, cancelledAt: now, lockedAt: null, updatedAt: now }, { merge: true })
          }
        })
      }
    }
    transaction.set(leaveRef, {
      status: accepted ? 'Approved' : 'ConsentDeclined',
      penaltyConsentStatus: accepted ? 'Accepted' : 'Declined',
      consentRespondedAt: now,
      updatedAt: now,
    }, { merge: true })
    transaction.set(adminDb.collection('notifications').doc(`leave-consent-result-${actor.uid}-${id}`), {
      employeeId: actor.uid,
      title: accepted ? 'Đã đồng ý mức trừ' : 'Đã từ chối mức trừ',
      message: accepted ? `Yêu cầu nghỉ đã được chốt và ghi nhận mức trừ ${amount.toLocaleString('vi-VN')}đ.` : 'Bạn đã không đồng ý mức trừ; yêu cầu nghỉ chưa được chấp thuận.',
      type: accepted ? 'success' : 'warning',
      isRead: false,
      createdAt: now,
    })
    managerIds.forEach((managerId) => transaction.set(
      managerNotificationRef(managerId, `leave-consent-${id}`),
      managerNotification(managerId, accepted ? 'Nhân viên đã đồng ý mức trừ' : 'Nhân viên từ chối mức trừ', `Mức đề xuất: ${amount.toLocaleString('vi-VN')}đ.`, accepted ? 'info' : 'warning')
    ))
  })

  return { id, accepted, amount, status: accepted ? 'Approved' : 'ConsentDeclined' }
}

function workflowRef(actor: RequestActor, id: string) {
  return adminDb.collection('workflowRequests').doc(`${actor.uid}-${id}`)
}

function penaltyData(params: {
  employeeId: string
  title: string
  description: string
  category: 'Late' | 'Other'
  amount: number
  sourceType: string
  sourceId: string
}) {
  return {
    ...params,
    penaltyDate: FieldValue.serverTimestamp(),
    createdBy: 'system',
    createdAt: FieldValue.serverTimestamp(),
  }
}

function warningNotification(employeeId: string, title: string, message: string) {
  return {
    employeeId,
    title,
    message,
    type: 'warning',
    isRead: false,
    createdAt: FieldValue.serverTimestamp(),
  }
}

async function sendPenaltyPush(params: {
  employeeId: string
  penaltyId: string
  event: 'created' | 'adjusted' | 'cancelled'
  title: string
  body: string
}) {
  const dispatchId = `penalty-${params.penaltyId}-${params.event}`
  const dispatchRef = adminDb.collection('pushDispatches').doc(dispatchId)
  const existing = await dispatchRef.get()
  if (!existing.exists) {
    await dispatchRef.set({
      source: 'penalties',
      sourceId: params.penaltyId,
      employeeId: params.employeeId,
      status: params.event,
      state: 'queued',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
  return sendEmployeePush({
    employeeId: params.employeeId,
    dispatchId,
    title: params.title,
    body: params.body,
    link: '/penalties',
    source: 'penalties',
    sourceId: params.penaltyId,
    status: params.event,
  })
}

async function activeManagerIds(): Promise<string[]> {
  const snapshot = await adminDb.collection('employees').where('status', '==', 'active').get()
  return snapshot.docs
    .filter((item) => ['admin', 'manager'].includes(String(item.get('role'))))
    .map((item) => item.id)
}

function scheduleBatchKey(employeeId: string, weekStart: Date): string {
  return `${employeeId}-${weekStart.toISOString().slice(0, 10)}`
}

function managerNotificationRef(managerId: string, sourceKey: string) {
  return adminDb.collection('notifications').doc(`manager-${managerId}-${sourceKey}`)
}

function managerNotification(
  managerId: string,
  title: string,
  message: string,
  type: 'info' | 'warning' = 'warning',
  isRead = false
) {
  return {
    employeeId: managerId,
    title,
    message,
    type,
    isRead,
    createdAt: FieldValue.serverTimestamp(),
  }
}

async function sendManagerPushes(params: {
  managerIds: string[]
  sourceKey: string
  title: string
  body: string
  link: string
  source: string
  sourceId: string
}) {
  return Promise.all(params.managerIds.map(async (managerId) => {
    const dispatchId = `manager-${managerId}-${params.sourceKey}`
    await adminDb.collection('pushDispatches').doc(dispatchId).set({
      source: params.source,
      sourceId: params.sourceId,
      employeeId: managerId,
      status: 'pending',
      state: 'queued',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return sendEmployeePush({
      employeeId: managerId,
      dispatchId,
      title: params.title,
      body: params.body,
      link: params.link,
      source: params.source,
      sourceId: params.sourceId,
      status: 'pending',
    })
  }))
}

const managerRequestCopy = {
  leave: { title: 'Yêu cầu nghỉ chờ xử lý', message: 'Một nhân viên vừa gửi yêu cầu xin nghỉ.' },
  late: { title: 'Thông báo đi trễ chờ xử lý', message: 'Một nhân viên vừa gửi thông báo đi trễ.' },
  salary: { title: 'Yêu cầu ứng lương chờ xử lý', message: 'Một nhân viên vừa gửi yêu cầu ứng lương.' },
} as const

function mondayFor(date: Date): Date {
  const result = new Date(date)
  const day = result.getUTCDay()
  result.setUTCDate(result.getUTCDate() - ((day + 6) % 7))
  result.setUTCHours(0, 0, 0, 0)
  return result
}

function vietnamDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function scheduleDeadline(firstShift: Date): Date {
  const monday = mondayFor(firstShift)
  // Hết Thứ Sáu là hạn cuối: gửi từ 00:00 Thứ Bảy (giờ Việt Nam) được tính là trễ.
  return new Date(
    Date.UTC(
      monday.getUTCFullYear(),
      monday.getUTCMonth(),
      monday.getUTCDate() - 2,
      -7,
      0,
      0
    )
  )
}

function leaveNoticeDeadline(firstShift: Date): Date {
  const dateKey = vietnamDateKey(firstShift)
  const deadline = new Date(`${dateKey}T${String(workflowPolicy.leaveNoticeDeadlineHour).padStart(2, '0')}:00:00+07:00`)
  deadline.setDate(deadline.getDate() - 1)
  return deadline
}

function rejectedScheduleResubmissionDeadline(firstShift: Date): Date {
  const mondayKey = vietnamDateKey(mondayFor(firstShift))
  const deadline = new Date(`${mondayKey}T00:00:00+07:00`)
  deadline.setDate(deadline.getDate() - 1)
  return deadline
}

export async function submitSchedules(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  const body = objectBody(raw)
  const id = requestId(body)
  if (!Array.isArray(body.schedules) || body.schedules.length < 1 || body.schedules.length > 21) {
    throw new ApiError(400, 'Mỗi lần gửi cần từ 1 đến 21 ca làm.')
  }

  const schedules = body.schedules.map((item, index) => {
    const row = objectBody(item)
    const date = dateValue(row.date, `Ngày ca ${index + 1}`)
    const shift = row.shift
    if (!shifts.includes(shift as Shift)) throw new ApiError(400, `Ca ${index + 1} không hợp lệ.`)
    return {
      date,
      shift: shift as Shift,
      note: text(row.note ?? '', `Ghi chú ca ${index + 1}`, 500, true),
    }
  })
  const actualShiftCount = schedules.filter((row) => !row.note.includes('[NO_SHIFTS]') && !row.note.includes('[DUTY_ONLY]')).length
  const underMinimum = actualShiftCount < workflowPolicy.minimumWeeklyShifts
  if (underMinimum && body.confirmUnderMinimum !== true) {
    throw new ApiError(409, `Bạn mới đăng ký ${actualShiftCount} ca, dưới mức tối thiểu ${workflowPolicy.minimumWeeklyShifts} ca/tuần. Vui lòng xác nhận trước khi gửi.`)
  }

  const firstDate = schedules.reduce((min, row) => row.date < min ? row.date : min, schedules[0].date)
  const isLate = new Date() > scheduleDeadline(firstDate)
  const weekStart = mondayFor(firstDate)
  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
  weekEnd.setUTCHours(23, 59, 59, 999)
  const longLeaveSnapshots = await adminDb.collection('leaveRequests')
    .where('employeeId', '==', actor.uid)
    .where('duration', '==', 'long')
    .get()
  const hasCoveringLongLeave = longLeaveSnapshots.docs.some((snapshot) => {
    const leave = snapshot.data()
    if (!['Pending', 'Approved'].includes(leave.status)) return false
    const start = (leave.leaveDate as Timestamp).toDate()
    const end = (leave.endDate as Timestamp | undefined)?.toDate() ?? start
    start.setUTCHours(0, 0, 0, 0)
    end.setUTCHours(23, 59, 59, 999)
    return start <= weekStart && end >= weekEnd
  })
  const shouldPenalize = isLate && !hasCoveringLongLeave
  const batchKey = scheduleBatchKey(actor.uid, weekStart)
  const [managerIds, existingSchedules] = await Promise.all([
    activeManagerIds(),
    adminDb.collection('workSchedules').where('employeeId', '==', actor.uid).get(),
  ])
  const alreadyHasWeek = existingSchedules.docs.some((snapshot) => {
    const data = snapshot.data()
    if (data.status === 'Cancelled') return false
    const date = (data.date as Timestamp).toDate()
    return date >= weekStart && date <= weekEnd
  })
  if (alreadyHasWeek) {
    throw new ApiError(409, 'Bạn đã có một bảng lịch cho tuần này. Hãy mở bảng hiện tại để điều chỉnh.')
  }
  const workflow = workflowRef(actor, id)
  const scheduleRefs = schedules.map(() => adminDb.collection('workSchedules').doc())
  const penaltyRef = adminDb.collection('penalties').doc(`schedule-${actor.uid}-${id}`)
  const notificationRef = adminDb.collection('notifications').doc(`schedule-penalty-${actor.uid}-${id}`)

  await adminDb.runTransaction(async (transaction) => {
    if ((await transaction.get(workflow)).exists) throw new ApiError(409, 'Lịch này đã được gửi trước đó.')

    const now = FieldValue.serverTimestamp()
    schedules.forEach((schedule, index) => {
      transaction.create(scheduleRefs[index], {
        employeeId: actor.uid,
        date: Timestamp.fromDate(schedule.date),
        shift: schedule.shift,
        status: 'Pending',
        note: schedule.note,
        batchKey,
        requiresReapproval: false,
        revisionCount: 0,
        weeklyShiftCount: actualShiftCount,
        underMinimumWarning: underMinimum,
        createdAt: now,
        updatedAt: now,
        lockedAt: null,
      })
    })

    if (shouldPenalize && workflowPolicy.scheduleLatePenalty > 0) {
      transaction.create(penaltyRef, penaltyData({
        employeeId: actor.uid,
        title: 'Đăng ký lịch trễ hạn',
        description: `Gửi lịch sau hạn quy định. Khấu trừ ${workflowPolicy.scheduleLatePenalty.toLocaleString('vi-VN')}đ.`,
        category: 'Late',
        amount: workflowPolicy.scheduleLatePenalty,
        sourceType: 'scheduleSubmission',
        sourceId: id,
      }))
      transaction.create(notificationRef, warningNotification(
        actor.uid,
        'Phát sinh khoản phạt đăng ký lịch trễ',
        `Khoản phạt ${workflowPolicy.scheduleLatePenalty.toLocaleString('vi-VN')}đ đã được ghi nhận.`
      ))
    }
    transaction.set(adminDb.collection('notifications').doc(`schedule-status-${scheduleRefs[0].id}`), {
      employeeId: actor.uid,
      title: 'Yêu cầu gửi lịch đang xử lý',
      message: `Bảng lịch gồm ${scheduleRefs.length} ca đã được gửi và đang chờ quản lý xử lý.`,
      type: 'info',
      isRead: false,
      createdAt: now,
    })

    managerIds.forEach((managerId) => {
      transaction.set(
        managerNotificationRef(managerId, `schedule-${batchKey}`),
        managerNotification(
          managerId,
          'Bảng lịch mới chờ xác nhận',
          `Một nhân viên vừa gửi bảng lịch tuần ${weekStart.toLocaleDateString('vi-VN')}.${underMinimum ? ` Cảnh báo: chỉ có ${actualShiftCount}/${workflowPolicy.minimumWeeklyShifts} ca tối thiểu.` : ''}`
        )
      )
    })

    transaction.create(workflow, {
      employeeId: actor.uid,
      action: 'submitSchedules',
      targetIds: scheduleRefs.map((ref) => ref.id),
      penaltyId: shouldPenalize ? penaltyRef.id : null,
      createdAt: now,
    })
  })

  await sendManagerPushes({
    managerIds,
    sourceKey: `schedule-${batchKey}`,
    title: 'Bảng lịch mới chờ xác nhận',
    body: underMinimum
      ? `Cảnh báo: lịch chỉ có ${actualShiftCount}/${workflowPolicy.minimumWeeklyShifts} ca tối thiểu.`
      : 'Một nhân viên vừa gửi bảng lịch tuần. Mở Trí Candy để xử lý.',
    link: '/notifications',
    source: 'workSchedules',
    sourceId: scheduleRefs[0].id,
  })

  if (shouldPenalize && workflowPolicy.scheduleLatePenalty > 0) {
    await sendPenaltyPush({
      employeeId: actor.uid,
      penaltyId: penaltyRef.id,
      event: 'created',
      title: 'Phát sinh khoản phạt đăng ký lịch trễ',
      body: `Khoản phạt ${workflowPolicy.scheduleLatePenalty.toLocaleString('vi-VN')}đ đã được ghi nhận.`,
    })
  }

  return {
    ids: scheduleRefs.map((ref) => ref.id),
    penalty: shouldPenalize ? workflowPolicy.scheduleLatePenalty : 0,
  }
}

export async function submitStaffRequest(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  const body = objectBody(raw)
  const id = requestId(body)
  const type = text(body.type, 'Loại yêu cầu', 30) as 'overtime' | 'note' | 'scheduleChange'
  if (!['overtime', 'note', 'scheduleChange'].includes(type)) throw new ApiError(400, 'Loại yêu cầu không hợp lệ.')
  const content = text(body.content ?? '', 'Nội dung', 1000, type === 'overtime' || type === 'scheduleChange')
  const managerIds = await activeManagerIds()
  const requestRef = adminDb.collection('staffRequests').doc()
  const workflow = workflowRef(actor, id)
  let weekStart: Date | null = null
  let requestedShifts: Array<{ date: Date; shift: Shift }> = []
  let removedShifts: Array<{ scheduleId: string; date: Date; shift: Shift }> = []
  let shouldPenalizeSameDayChange = false

  if (type === 'overtime' || type === 'scheduleChange') {
    if (!Array.isArray(body.shifts) || body.shifts.length > 21) {
      throw new ApiError(400, 'Danh sách ca mới không hợp lệ.')
    }
    if (type === 'overtime' && body.shifts.length < 1) {
      throw new ApiError(400, 'Vui lòng chọn ít nhất một ca muốn làm thêm.')
    }
    requestedShifts = body.shifts.map((item, index) => {
      const row = objectBody(item)
      const date = dateValue(row.date, `Ngày làm thêm ${index + 1}`)
      const shift = row.shift
      if (!shifts.includes(shift as Shift)) throw new ApiError(400, `Ca làm thêm ${index + 1} không hợp lệ.`)
      return { date, shift: shift as Shift }
    })
    if (type === 'scheduleChange') {
      if (!Array.isArray(body.removedShifts) || body.removedShifts.length > 21) {
        throw new ApiError(400, 'Danh sách ca xin hủy không hợp lệ.')
      }
      removedShifts = body.removedShifts.map((item, index) => {
        const row = objectBody(item)
        const scheduleId = text(row.scheduleId, `Mã ca hủy ${index + 1}`, 128)
        const date = dateValue(row.date, `Ngày ca hủy ${index + 1}`)
        const shift = row.shift
        if (!shifts.includes(shift as Shift)) throw new ApiError(400, `Ca hủy ${index + 1} không hợp lệ.`)
        return { scheduleId, date, shift: shift as Shift }
      })
      if (!requestedShifts.length && !removedShifts.length) {
        throw new ApiError(400, 'Vui lòng chọn ít nhất một ca cần đổi, hủy hoặc đăng ký thêm.')
      }
      if (removedShifts.length && !requestedShifts.length) {
        throw new ApiError(400, 'Khi xin hủy ca cũ, bạn phải chọn ít nhất một ca mới để thay thế.')
      }
      if ([...requestedShifts, ...removedShifts].some((item) =>
        vietnamDateKey(item.date) < vietnamDateKey(new Date())
      )) {
        throw new ApiError(400, 'Không thể đổi hoặc đăng ký thêm cho ngày đã qua.')
      }
      shouldPenalizeSameDayChange = removedShifts.some((item) =>
        vietnamDateKey(item.date) === vietnamDateKey(new Date())
      )
    }
    const firstRequestDate = (requestedShifts[0]?.date || removedShifts[0]?.date)!
    weekStart = mondayFor(firstRequestDate)
    if ([...requestedShifts, ...removedShifts].some((item) => mondayFor(item.date).getTime() !== weekStart!.getTime())) {
      throw new ApiError(400, 'Các ca làm thêm phải thuộc cùng một tuần.')
    }
    const [existing, existingStaffRequests] = await Promise.all([
      adminDb.collection('workSchedules').where('employeeId', '==', actor.uid).get(),
      adminDb.collection('staffRequests').where('employeeId', '==', actor.uid).get(),
    ])
    const removedIds = new Set(removedShifts.map((item) => item.scheduleId))
    if (removedShifts.some((removed) => !existing.docs.some((snapshot) => {
      const schedule = snapshot.data()
      return snapshot.id === removed.scheduleId &&
        schedule.status === 'Approved' &&
        (schedule.date as Timestamp).toDate().toISOString().slice(0, 10) === removed.date.toISOString().slice(0, 10) &&
        schedule.shift === removed.shift
    }))) {
      throw new ApiError(409, 'Một ca xin hủy không còn đúng với lịch đã duyệt. Vui lòng tải lại lịch.')
    }
    const duplicated = requestedShifts.some((requested) => existing.docs.some((snapshot) => {
      const schedule = snapshot.data()
      if (schedule.status === 'Cancelled' || removedIds.has(snapshot.id)) return false
      return (schedule.date as Timestamp).toDate().toISOString().slice(0, 10) === requested.date.toISOString().slice(0, 10) &&
        schedule.shift === requested.shift
    }))
    if (duplicated) throw new ApiError(409, 'Một ca làm thêm đã có trong lịch hiện tại. Vui lòng tải lại và chọn ca khác.')
    const alreadyPending = existingStaffRequests.docs.some((snapshot) => {
      const request = snapshot.data()
      return request.type === type && request.status === 'Pending' &&
        request.weekStart instanceof Timestamp && request.weekStart.toDate().getTime() === weekStart!.getTime()
    })
    if (alreadyPending) throw new ApiError(409, 'Bạn đã có một yêu cầu làm thêm đang chờ xử lý cho tuần này.')
  }

  await adminDb.runTransaction(async (transaction) => {
    if ((await transaction.get(workflow)).exists) throw new ApiError(409, 'Yêu cầu này đã được gửi trước đó.')
    const now = FieldValue.serverTimestamp()
    transaction.create(requestRef, {
      employeeId: actor.uid,
      type,
      content,
      ...(weekStart ? { weekStart: Timestamp.fromDate(weekStart) } : {}),
      ...(requestedShifts.length ? {
        shifts: requestedShifts.map((item) => ({ date: Timestamp.fromDate(item.date), shift: item.shift })),
      } : {}),
      ...(removedShifts.length ? {
        removedShifts: removedShifts.map((item) => ({
          scheduleId: item.scheduleId,
          date: Timestamp.fromDate(item.date),
          shift: item.shift,
        })),
      } : {}),
      status: 'Pending',
      createdAt: now,
      updatedAt: now,
    })
    if (shouldPenalizeSameDayChange && workflowPolicy.sameDayScheduleChangePenalty > 0) {
      const penaltyRef = adminDb.collection('penalties').doc(`schedule-change-${actor.uid}-${id}`)
      transaction.create(penaltyRef, penaltyData({
        employeeId: actor.uid,
        title: 'Đổi lịch trong ngày',
        description: 'Yêu cầu có hủy ca đã đăng ký của chính hôm nay. Đổi từ ngày mai trở đi không phát sinh khoản phạt này.',
        category: 'Late',
        amount: workflowPolicy.sameDayScheduleChangePenalty,
        sourceType: 'scheduleChange',
        sourceId: requestRef.id,
      }))
      transaction.create(
        adminDb.collection('notifications').doc(`schedule-change-penalty-${actor.uid}-${id}`),
        warningNotification(
          actor.uid,
          'Phát sinh khoản phạt đổi lịch trong ngày',
          `Khoản phạt ${workflowPolicy.sameDayScheduleChangePenalty.toLocaleString('vi-VN')}đ đã được ghi nhận.`
        )
      )
    }
    managerIds.forEach((managerId) => {
      transaction.set(
        managerNotificationRef(managerId, `staff-${requestRef.id}`),
        managerNotification(
          managerId,
          type === 'scheduleChange' ? 'Yêu cầu đổi / thêm ca chờ xử lý' : type === 'overtime' ? 'Yêu cầu làm thêm chờ xử lý' : 'Ghi chú mới từ nhân viên',
          type === 'scheduleChange' ? 'Một nhân viên vừa gửi các ca xin hủy và ca mới / ca thêm.' : type === 'overtime' ? 'Một nhân viên vừa gửi các ca muốn làm thêm.' : 'Một nhân viên vừa gửi ghi chú cho quản lý.'
        )
      )
    })
    transaction.create(workflow, {
      employeeId: actor.uid,
      action: 'submitStaffRequest',
      targetIds: [requestRef.id],
      createdAt: now,
    })
  })

  await sendManagerPushes({
    managerIds,
    sourceKey: `staff-${requestRef.id}`,
    title: type === 'scheduleChange' ? 'Yêu cầu đổi / thêm ca chờ xử lý' : type === 'overtime' ? 'Yêu cầu làm thêm chờ xử lý' : 'Ghi chú mới từ nhân viên',
    body: type === 'scheduleChange' ? 'Một nhân viên vừa gửi các ca xin hủy và ca mới / ca thêm.' : type === 'overtime' ? 'Một nhân viên vừa gửi các ca muốn làm thêm.' : 'Một nhân viên vừa gửi ghi chú cho quản lý.',
    link: '/notifications',
    source: 'staffRequests',
    sourceId: requestRef.id,
  })

  if (shouldPenalizeSameDayChange && workflowPolicy.sameDayScheduleChangePenalty > 0) {
    await sendPenaltyPush({
      employeeId: actor.uid,
      penaltyId: `schedule-change-${actor.uid}-${id}`,
      event: 'created',
      title: 'Phát sinh khoản phạt đổi lịch trong ngày',
      body: `Khoản phạt ${workflowPolicy.sameDayScheduleChangePenalty.toLocaleString('vi-VN')}đ đã được ghi nhận.`,
    })
  }

  return {
    id: requestRef.id,
    penalty: shouldPenalizeSameDayChange ? workflowPolicy.sameDayScheduleChangePenalty : 0,
  }
}

export async function replaceSchedules(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  const body = objectBody(raw)
  const id = requestId(body)
  if (!Array.isArray(body.scheduleIds) || body.scheduleIds.length < 1 || body.scheduleIds.length > 21) {
    throw new ApiError(400, 'Danh sách lịch cũ không hợp lệ.')
  }
  if (!Array.isArray(body.schedules) || body.schedules.length < 1 || body.schedules.length > 21) {
    throw new ApiError(400, 'Mỗi lần gửi cần từ 1 đến 21 ca làm.')
  }

  const scheduleIds = body.scheduleIds.map((value, index) =>
    text(value, `Mã lịch ${index + 1}`, 128)
  )
  const schedules = body.schedules.map((item, index) => {
    const row = objectBody(item)
    const date = dateValue(row.date, `Ngày ca ${index + 1}`)
    const shift = row.shift
    if (!shifts.includes(shift as Shift)) throw new ApiError(400, `Ca ${index + 1} không hợp lệ.`)
    return {
      date,
      shift: shift as Shift,
      note: text(row.note ?? '', `Ghi chú ca ${index + 1}`, 500, true),
    }
  })

  const revisedShiftCount = schedules.filter((row) => !row.note.includes('[NO_SHIFTS]') && !row.note.includes('[DUTY_ONLY]')).length
  const oldRefs = scheduleIds.map((scheduleId) => adminDb.collection('workSchedules').doc(scheduleId))
  const newRefs = schedules.map(() => adminDb.collection('workSchedules').doc())
  const workflow = workflowRef(actor, id)
  const managerIds = await activeManagerIds()
  const resubmissionPenaltyRef = adminDb.collection('penalties').doc(`schedule-resubmission-${actor.uid}-${id}`)
  let penalizedRejectedResubmission = false

  await adminDb.runTransaction(async (transaction) => {
    const [workflowSnapshot, ...oldSnapshots] = await Promise.all([
      transaction.get(workflow),
      ...oldRefs.map((ref) => transaction.get(ref)),
    ])
    if (workflowSnapshot.exists) throw new ApiError(409, 'Bản điều chỉnh này đã được gửi trước đó.')
    if (oldSnapshots.some((snapshot) => !snapshot.exists)) {
      throw new ApiError(404, 'Không tìm thấy đầy đủ lịch cần điều chỉnh.')
    }
    const oldData = oldSnapshots.map((snapshot) => snapshot.data()!)
    if (oldData.some((schedule) =>
      schedule.employeeId !== actor.uid ||
      !['Pending', 'Registered', 'ChangesRequested', 'Rejected', 'Approved', 'Editing'].includes(schedule.status)
    )) {
      throw new ApiError(403, 'Bạn không thể điều chỉnh lịch này.')
    }

    const newWeeks = new Set(schedules.map((schedule) => mondayFor(schedule.date).toISOString()))
    if (newWeeks.size !== 1) {
      throw new ApiError(400, 'Các ca trong bản điều chỉnh phải thuộc cùng một tuần.')
    }

    const now = FieldValue.serverTimestamp()
    const weekStart = mondayFor(schedules[0].date)
    const batchKey = scheduleBatchKey(actor.uid, weekStart)
    const requiresReapproval = oldData.some((schedule) =>
      schedule.status === 'Approved' ||
      schedule.editPreviousStatus === 'Approved' ||
      schedule.requiresReapproval === true
    )
    const revisionCount = Math.max(0, ...oldData.map((schedule) => Number(schedule.revisionCount || 0))) + 1
    penalizedRejectedResubmission = oldData.some((schedule) => schedule.status === 'Rejected') &&
      Date.now() >= rejectedScheduleResubmissionDeadline(schedules[0].date).getTime()
    oldRefs.forEach((ref) => transaction.delete(ref))
    schedules.forEach((schedule, index) => {
      transaction.create(newRefs[index], {
        employeeId: actor.uid,
        date: Timestamp.fromDate(schedule.date),
        shift: schedule.shift,
        status: 'Pending',
        note: schedule.note,
        batchKey,
        requiresReapproval,
        revisionCount,
        weeklyShiftCount: revisedShiftCount,
        underMinimumWarning: revisedShiftCount < workflowPolicy.minimumWeeklyShifts,
        createdAt: now,
        updatedAt: now,
        lockedAt: null,
      })
    })
    transaction.create(workflow, {
      employeeId: actor.uid,
      action: 'replaceSchedules',
      targetIds: newRefs.map((ref) => ref.id),
      replacedIds: scheduleIds,
      penaltyId: penalizedRejectedResubmission ? resubmissionPenaltyRef.id : null,
      createdAt: now,
    })
    if (penalizedRejectedResubmission && workflowPolicy.scheduleLatePenalty > 0) {
      transaction.create(resubmissionPenaltyRef, penaltyData({
        employeeId: actor.uid,
        title: 'Gửi lại lịch bị từ chối quá hạn',
        description: 'Lịch bị từ chối nhưng được gửi lại từ Chủ Nhật hoặc sau khi tuần làm việc đã bắt đầu.',
        category: 'Late',
        amount: workflowPolicy.scheduleLatePenalty,
        sourceType: 'scheduleResubmission',
        sourceId: newRefs[0].id,
      }))
    }
    transaction.set(adminDb.collection('notifications').doc(`schedule-status-${newRefs[0].id}`), {
      employeeId: actor.uid,
      title: 'Yêu cầu gửi lịch đang xử lý',
      message: `Bảng lịch điều chỉnh gồm ${newRefs.length} ca đã được gửi và đang chờ quản lý xử lý.`,
      type: 'info',
      isRead: false,
      createdAt: now,
    })
    managerIds.forEach((managerId) => {
      transaction.set(
        managerNotificationRef(managerId, `schedule-${batchKey}`),
        managerNotification(
          managerId,
          requiresReapproval ? 'Lịch đã sửa, cần xác nhận lại' : 'Bảng lịch đã được điều chỉnh',
          requiresReapproval
            ? 'Nhân viên đã sửa bảng lịch từng được xác nhận. Vui lòng kiểm tra lại.'
            : 'Nhân viên đã gửi lại bảng lịch sau khi điều chỉnh.'
        )
      )
    })
  })

  await sendManagerPushes({
    managerIds,
    sourceKey: `schedule-revised-${newRefs[0].id}`,
    title: 'Bảng lịch đã được điều chỉnh',
    body: 'Nhân viên vừa gửi lại bảng lịch. Vui lòng kiểm tra và xác nhận.',
    link: '/notifications',
    source: 'workSchedules',
    sourceId: newRefs[0].id,
  })

  return { ids: newRefs.map((ref) => ref.id), penalty: penalizedRejectedResubmission ? workflowPolicy.scheduleLatePenalty : 0 }
}

export async function setScheduleBatchEditing(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  const body = objectBody(raw)
  if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 21) {
    throw new ApiError(400, 'Bảng lịch cần từ 1 đến 21 ca.')
  }
  const editing = body.editing === true
  const ids = body.ids.map((value, index) => text(value, `Mã ca ${index + 1}`, 128))
  const refs = ids.map((id) => adminDb.collection('workSchedules').doc(id))
  let resultStatus = ''

  await adminDb.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)))
    if (snapshots.some((snapshot) => !snapshot.exists)) throw new ApiError(404, 'Không tìm thấy đầy đủ bảng lịch.')
    const schedules = snapshots.map((snapshot) => snapshot.data()!)
    if (schedules.some((schedule) => schedule.employeeId !== actor.uid)) {
      throw new ApiError(403, 'Bạn không thể điều chỉnh bảng lịch này.')
    }
    const weekStart = mondayFor((schedules[0].date as Timestamp).toDate())
    if (schedules.some((schedule) =>
      mondayFor((schedule.date as Timestamp).toDate()).toISOString() !== weekStart.toISOString()
    )) throw new ApiError(409, 'Bảng lịch không cùng một tuần.')

    const now = FieldValue.serverTimestamp()
    const batchKey = schedules[0].batchKey || scheduleBatchKey(actor.uid, weekStart)
    if (editing) {
      if (schedules.some((schedule) => !['Pending', 'Registered', 'Rejected', 'Approved'].includes(schedule.status))) {
        throw new ApiError(409, 'Bảng lịch hiện không thể chuyển sang chế độ chỉnh sửa.')
      }
      refs.forEach((ref, index) => transaction.set(ref, {
        status: 'Editing',
        editPreviousStatus: schedules[index].status,
        editingAt: now,
        updatedAt: now,
        batchKey,
        lockedAt: null,
      }, { merge: true }))
      resultStatus = 'Editing'
      return
    }

    if (schedules.some((schedule) => schedule.status !== 'Editing')) {
      throw new ApiError(409, 'Bảng lịch không ở chế độ chỉnh sửa.')
    }
    const restoredStatuses = schedules.map((schedule) => String(schedule.editPreviousStatus || 'Pending'))
    refs.forEach((ref, index) => transaction.set(ref, {
      status: restoredStatuses[index],
      editPreviousStatus: FieldValue.delete(),
      editingAt: FieldValue.delete(),
      updatedAt: now,
    }, { merge: true }))
    resultStatus = restoredStatuses[0]
  })

  return { ids, status: resultStatus }
}

export async function submitLeave(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  const body = objectBody(raw)
  const id = requestId(body)
  const duration = body.duration
  if (!['short', 'long'].includes(String(duration))) throw new ApiError(400, 'Hình thức nghỉ không hợp lệ.')
  const leaveDate = dateValue(body.leaveDate, 'Ngày nghỉ')
  const endDate = dateValue(body.endDate ?? body.leaveDate, 'Ngày kết thúc')
  if (endDate < leaveDate) throw new ApiError(400, 'Ngày kết thúc phải từ ngày bắt đầu trở đi.')
  const reason = text(body.reason, 'Lý do', 1000)
  const legacyScheduleId = body.workScheduleId == null
    ? ''
    : text(body.workScheduleId, 'Mã ca làm', 128)
  const rawScheduleIds = Array.isArray(body.workScheduleIds)
    ? body.workScheduleIds
    : legacyScheduleId ? [legacyScheduleId] : []
  if (rawScheduleIds.length > 21) throw new ApiError(400, 'Mỗi yêu cầu nghỉ chỉ được chọn tối đa 21 ca.')
  const workScheduleIds = [...new Set(rawScheduleIds.map((value, index) =>
    text(value, `Mã ca làm ${index + 1}`, 128)
  ))]
  if (duration === 'short' && workScheduleIds.length < 1) {
    throw new ApiError(400, 'Vui lòng chọn ít nhất một ca muốn nghỉ.')
  }
  const leaveType = text(body.leaveType ?? 'personal', 'Loại nghỉ', 30)
  if (!['sick', 'casual', 'earned', 'personal'].includes(leaveType)) {
    throw new ApiError(400, 'Loại nghỉ không hợp lệ.')
  }

  const workflow = workflowRef(actor, id)
  const leaveRef = adminDb.collection('leaveRequests').doc()
  const managerIds = await activeManagerIds()
  let isLate = false
  let penaltyIfApproved = 0
  let penaltyIfRejected = workflowPolicy.leaveOnTimeRejectedPenalty
  let weeklyShiftCount = 0
  let weeklyShiftCountAfterLeave = 0

  await adminDb.runTransaction(async (transaction) => {
    if ((await transaction.get(workflow)).exists) throw new ApiError(409, 'Yêu cầu nghỉ này đã được gửi.')
    const now = FieldValue.serverTimestamp()
    const scheduleRefs = workScheduleIds.map((scheduleId) => adminDb.collection('workSchedules').doc(scheduleId))
    const scheduleSnapshots = await Promise.all(scheduleRefs.map((ref) => transaction.get(ref)))
    const selectedShiftStarts: Date[] = []
    scheduleSnapshots.forEach((schedule) => {
      if (!schedule.exists ||
        schedule.get('employeeId') !== actor.uid ||
        schedule.get('status') !== 'Approved') {
        throw new ApiError(403, 'Bạn chỉ được xin nghỉ trên ca đã được duyệt của mình.')
      }
      const scheduleDate = (schedule.get('date') as Timestamp).toDate()
      if (vietnamDateKey(scheduleDate) < vietnamDateKey(leaveDate) ||
        vietnamDateKey(scheduleDate) > vietnamDateKey(endDate)) {
        throw new ApiError(400, 'Ca được chọn phải nằm trong khoảng ngày xin nghỉ.')
      }
      selectedShiftStarts.push(shiftStart(scheduleDate, schedule.get('shift') as Shift))
    })
    const noticeTarget = selectedShiftStarts.length
      ? selectedShiftStarts.reduce((earliest, value) => value < earliest ? value : earliest, selectedShiftStarts[0])
      : leaveDate
    isLate = Date.now() > leaveNoticeDeadline(noticeTarget).getTime()
    penaltyIfApproved = isLate ? workflowPolicy.leaveLateApprovedPenalty : 0
    penaltyIfRejected = isLate
      ? workflowPolicy.leaveLateRejectedPenalty
      : workflowPolicy.leaveOnTimeRejectedPenalty
    const weekStart = mondayFor(noticeTarget)
    const weekEnd = new Date(weekStart)
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7)
    const weeklySchedules = await transaction.get(
      adminDb.collection('workSchedules').where('employeeId', '==', actor.uid)
    )
    const selectedIds = new Set(workScheduleIds)
    weeklyShiftCount = weeklySchedules.docs.filter((snapshot) => {
      const data = snapshot.data()
      const date = (data.date as Timestamp).toDate()
      return data.status === 'Approved' && date >= weekStart && date < weekEnd && !String(data.note || '').includes('[DUTY_ONLY]')
    }).length
    weeklyShiftCountAfterLeave = Math.max(0, weeklyShiftCount - selectedIds.size)
    transaction.create(leaveRef, {
      employeeId: actor.uid,
      ...(workScheduleIds.length ? {
        workScheduleId: workScheduleIds[0],
        workScheduleIds,
      } : {}),
      leaveDate: Timestamp.fromDate(leaveDate),
      endDate: Timestamp.fromDate(endDate),
      duration,
      noticeClass: isLate ? 'late' : 'onTime',
      penaltyIfApproved,
      penaltyIfRejected,
      weeklyShiftCount,
      weeklyShiftCountAfterLeave,
      underMinimumWarning: weeklyShiftCountAfterLeave < workflowPolicy.minimumWeeklyShifts,
      leaveType,
      reason,
      status: 'Pending',
      createdAt: now,
      updatedAt: now,
    })
    transaction.create(workflow, {
      employeeId: actor.uid,
      action: 'submitLeave',
      targetIds: [leaveRef.id],
      penaltyId: null,
      createdAt: now,
    })
    managerIds.forEach((managerId) => {
      transaction.set(
        managerNotificationRef(managerId, `leave-${leaveRef.id}`),
        managerNotification(
          managerId,
          managerRequestCopy.leave.title,
          `${managerRequestCopy.leave.message}${weeklyShiftCountAfterLeave < workflowPolicy.minimumWeeklyShifts ? ` Cảnh báo: sau khi nghỉ còn ${weeklyShiftCountAfterLeave}/${workflowPolicy.minimumWeeklyShifts} ca.` : ''}`
        )
      )
    })
  })

  await sendManagerPushes({
    managerIds,
    sourceKey: `leave-${leaveRef.id}`,
    title: managerRequestCopy.leave.title,
    body: managerRequestCopy.leave.message,
    link: '/notifications',
    source: 'leaveRequests',
    sourceId: leaveRef.id,
  })

  return { id: leaveRef.id, penalty: 0, penaltyIfApproved, penaltyIfRejected }
}

function shiftStart(date: Date, shift: Shift): Date {
  const day = date.toISOString().slice(0, 10)
  return new Date(`${day}T${shiftStartTime[shift]}:00+07:00`)
}

export async function submitLate(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  const body = objectBody(raw)
  const id = requestId(body)
  const scheduleId = text(body.workScheduleId, 'Mã ca làm', 128)
  const arrivalTime = text(body.expectedArrival, 'Giờ dự kiến', 5)
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(arrivalTime)) {
    throw new ApiError(400, 'Giờ dự kiến không hợp lệ.')
  }
  const reason = text(body.reason, 'Lý do', 1000)
  const managerMessageStatus = text(body.managerMessageStatus, 'Xác nhận nhắn quản lý', 30) as
    | 'messagedTri'
    | 'notMessaged'
    | 'messagedOtherManager'
  if (!['messagedTri', 'notMessaged', 'messagedOtherManager'].includes(managerMessageStatus)) {
    throw new ApiError(400, 'Vui lòng xác nhận bạn đã nhắn cho ai trước khi gửi.')
  }
  const scheduleRef = adminDb.collection('workSchedules').doc(scheduleId)
  const workflow = workflowRef(actor, id)
  const lateRef = adminDb.collection('lateRequests').doc()
  const managerIds = await activeManagerIds()
  let computedPenalty = 0

  await adminDb.runTransaction(async (transaction) => {
    const [workflowSnapshot, scheduleSnapshot] = await Promise.all([
      transaction.get(workflow),
      transaction.get(scheduleRef),
    ])
    if (workflowSnapshot.exists) throw new ApiError(409, 'Thông báo đi trễ này đã được gửi.')
    if (!scheduleSnapshot.exists) throw new ApiError(404, 'Không tìm thấy ca làm.')
    const schedule = scheduleSnapshot.data()!
    if (schedule.employeeId !== actor.uid || schedule.status !== 'Approved') {
      throw new ApiError(403, 'Bạn chỉ được báo trễ cho ca đã được duyệt của mình.')
    }
    const shift = schedule.shift as Shift
    if (!shifts.includes(shift)) throw new ApiError(400, 'Ca làm không hợp lệ.')
    const date = (schedule.date as Timestamp).toDate()
    if (vietnamDateKey(date) !== vietnamDateKey(new Date())) {
      throw new ApiError(400, 'Bạn chỉ được báo đi trễ cho ca làm trong hôm nay.')
    }
    const start = shiftStart(date, shift)
    const arrival = new Date(`${date.toISOString().slice(0, 10)}T${arrivalTime}:00+07:00`)
    const lateMinutes = Math.ceil((arrival.getTime() - start.getTime()) / 60_000)
    if (lateMinutes < 1 || lateMinutes > 720) throw new ApiError(400, 'Giờ dự kiến phải sau giờ bắt đầu ca.')
    const noticeMinutes = (start.getTime() - Date.now()) / 60_000
    const isLateNotice = noticeMinutes < workflowPolicy.lateNoticeMinutes
    const contactPenalty = managerMessageStatus === 'messagedOtherManager'
      ? workflowPolicy.lateWrongManagerMessagePenalty
      : managerMessageStatus === 'notMessaged'
        ? workflowPolicy.lateMissingManagerMessagePenalty
        : 0
    computedPenalty = Math.max(isLateNotice ? workflowPolicy.lateNoticePenalty : 0, contactPenalty)
    const now = FieldValue.serverTimestamp()
    transaction.create(lateRef, {
      employeeId: actor.uid,
      workScheduleId: scheduleId,
      date: schedule.date,
      shift,
      lateMinutes,
      expectedArrival: arrivalTime,
      noticeMinutes: Math.floor(noticeMinutes),
      noticeClass: isLateNotice ? 'late' : 'onTime',
      managerMessageStatus,
      penaltyIfApproved: computedPenalty,
      penaltyIfRejected: computedPenalty > 0 ? computedPenalty * 2 : 0,
      reason,
      status: 'Pending',
      createdAt: now,
      updatedAt: now,
    })
    transaction.create(workflow, {
      employeeId: actor.uid,
      action: 'submitLate',
      targetIds: [lateRef.id],
      penaltyId: null,
      createdAt: now,
    })
    managerIds.forEach((managerId) => {
      transaction.set(
        managerNotificationRef(managerId, `late-${lateRef.id}`),
        managerNotification(managerId, managerRequestCopy.late.title, managerRequestCopy.late.message)
      )
    })
  })

  await sendManagerPushes({
    managerIds,
    sourceKey: `late-${lateRef.id}`,
    title: managerRequestCopy.late.title,
    body: managerRequestCopy.late.message,
    link: '/notifications',
    source: 'lateRequests',
    sourceId: lateRef.id,
  })

  return { id: lateRef.id, penalty: 0, suggestedPenalty: computedPenalty }
}

export async function submitSalaryAdvance(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  const body = objectBody(raw)
  const id = requestId(body)
  const amount = numberValue(body.amount, 'Số tiền', 1, 1_000_000_000)
  const reason = text(body.reason ?? '', 'Ghi chú', 1000, true)
  const workflow = workflowRef(actor, id)
  const advanceRef = adminDb.collection('salaryAdvances').doc()
  const managerIds = await activeManagerIds()

  await adminDb.runTransaction(async (transaction) => {
    if ((await transaction.get(workflow)).exists) throw new ApiError(409, 'Yêu cầu ứng lương này đã được gửi.')
    const now = FieldValue.serverTimestamp()
    transaction.create(advanceRef, {
      employeeId: actor.uid,
      amount,
      reason,
      status: 'Pending',
      createdAt: now,
      updatedAt: now,
    })
    transaction.create(workflow, {
      employeeId: actor.uid,
      action: 'submitSalaryAdvance',
      targetIds: [advanceRef.id],
      penaltyId: null,
      createdAt: now,
    })
    managerIds.forEach((managerId) => {
      transaction.set(
        managerNotificationRef(managerId, `salary-${advanceRef.id}`),
        managerNotification(managerId, managerRequestCopy.salary.title, managerRequestCopy.salary.message)
      )
    })
  })

  await sendManagerPushes({
    managerIds,
    sourceKey: `salary-${advanceRef.id}`,
    title: managerRequestCopy.salary.title,
    body: managerRequestCopy.salary.message,
    link: '/notifications',
    source: 'salaryAdvances',
    sourceId: advanceRef.id,
  })

  return { id: advanceRef.id }
}

const employeeRequestCollections = {
  leave: 'leaveRequests',
  late: 'lateRequests',
  salary: 'salaryAdvances',
} as const

export async function cancelRequest(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  const body = objectBody(raw)
  const resource = text(body.resource, 'Loại yêu cầu', 20) as keyof typeof employeeRequestCollections
  const collectionName = employeeRequestCollections[resource]
  if (!collectionName) throw new ApiError(400, 'Loại yêu cầu không hợp lệ.')
  const id = text(body.id, 'Mã yêu cầu', 128)
  const targetRef = adminDb.collection(collectionName).doc(id)
  const managerIds = await activeManagerIds()

  await adminDb.runTransaction(async (transaction) => {
    const target = await transaction.get(targetRef)
    if (!target.exists) throw new ApiError(404, 'Không tìm thấy yêu cầu.')
    const data = target.data()!
    if (data.employeeId !== actor.uid) throw new ApiError(403, 'Bạn không thể hủy yêu cầu này.')
    if (data.status !== 'Pending') throw new ApiError(409, 'Chỉ có thể hủy yêu cầu đang chờ duyệt.')
    const now = FieldValue.serverTimestamp()
    transaction.set(targetRef, {
      status: 'Cancelled',
      cancelledBy: actor.uid,
      cancelledAt: now,
      updatedAt: now,
    }, { merge: true })
    managerIds.forEach((managerId) => {
      transaction.set(
        managerNotificationRef(managerId, `${resource}-${id}`),
        managerNotification(managerId, 'Yêu cầu đã được rút', 'Nhân viên đã hủy yêu cầu trước khi quản lý xử lý.', 'info', true)
      )
    })
  })

  return { id, status: 'Cancelled' }
}

export async function cancelScheduleBatch(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  const body = objectBody(raw)
  if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 21) {
    throw new ApiError(400, 'Bảng lịch cần từ 1 đến 21 ca.')
  }
  const ids = body.ids.map((value, index) => text(value, `Mã ca ${index + 1}`, 128))
  const refs = ids.map((id) => adminDb.collection('workSchedules').doc(id))
  const managerIds = await activeManagerIds()

  await adminDb.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)))
    if (snapshots.some((snapshot) => !snapshot.exists)) throw new ApiError(404, 'Không tìm thấy đầy đủ bảng lịch.')
    const schedules = snapshots.map((snapshot) => snapshot.data()!)
    if (schedules.some((schedule) => schedule.employeeId !== actor.uid || schedule.status !== 'Pending')) {
      throw new ApiError(409, 'Chỉ có thể hủy bảng lịch của bạn khi đang chờ xác nhận.')
    }
    const now = FieldValue.serverTimestamp()
    const weekStart = mondayFor((schedules[0].date as Timestamp).toDate())
    const batchKey = schedules[0].batchKey || scheduleBatchKey(actor.uid, weekStart)
    refs.forEach((ref) => transaction.set(ref, {
      status: 'Cancelled',
      cancelledBy: actor.uid,
      cancelledAt: now,
      updatedAt: now,
      lockedAt: null,
    }, { merge: true }))
    managerIds.forEach((managerId) => {
      transaction.set(
        managerNotificationRef(managerId, `schedule-${batchKey}`),
        managerNotification(managerId, 'Bảng lịch đã được rút', 'Nhân viên đã hủy bảng lịch đang chờ xác nhận.', 'info', true)
      )
    })
  })

  return { ids, status: 'Cancelled' }
}

export async function adminCancelSchedules(actor: RequestActor, raw: unknown) {
  if (actor.role !== 'admin') throw new ApiError(403, 'Chỉ admin được điều chỉnh lịch đã công bố.')
  const body = objectBody(raw)
  const id = requestId(body)
  if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 21) {
    throw new ApiError(400, 'Vui lòng chọn từ 1 đến 21 ca cần hủy.')
  }
  const ids = [...new Set(body.ids.map((value, index) => text(value, `Mã ca ${index + 1}`, 128)))]
  const reason = text(body.reason, 'Lý do điều chỉnh', 500)
  const refs = ids.map((scheduleId) => adminDb.collection('workSchedules').doc(scheduleId))
  const workflow = workflowRef(actor, id)
  let employeeId = ''

  await adminDb.runTransaction(async (transaction) => {
    const [workflowSnapshot, ...snapshots] = await Promise.all([
      transaction.get(workflow),
      ...refs.map((ref) => transaction.get(ref)),
    ])
    if (workflowSnapshot.exists) throw new ApiError(409, 'Thao tác điều chỉnh lịch này đã được xử lý.')
    if (snapshots.some((snapshot) => !snapshot.exists)) throw new ApiError(404, 'Không tìm thấy đầy đủ các ca đã chọn.')
    employeeId = String(snapshots[0].get('employeeId') || '')
    if (!employeeId || snapshots.some((snapshot) =>
      snapshot.get('employeeId') !== employeeId || snapshot.get('status') === 'Cancelled'
    )) {
      throw new ApiError(409, 'Các ca phải thuộc cùng một nhân viên và chưa bị hủy.')
    }
    const now = FieldValue.serverTimestamp()
    refs.forEach((ref) => transaction.set(ref, {
      status: 'Cancelled',
      lockedAt: null,
      cancelledBy: actor.uid,
      cancelledAt: now,
      cancellationReason: reason,
      updatedAt: now,
    }, { merge: true }))
    transaction.create(workflow, {
      employeeId,
      action: 'adminCancelSchedules',
      targetIds: ids,
      createdAt: now,
    })
    transaction.set(adminDb.collection('notifications').doc(`admin-schedule-cancel-${id}`), {
      employeeId,
      title: 'Lịch làm đã được điều chỉnh',
      message: `${ids.length} ca đã được quản lý hủy. Lý do: ${reason}`,
      type: 'warning',
      isRead: false,
      createdAt: now,
    })
  })

  return { ids }
}

export async function reviseRequest(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  const body = objectBody(raw)
  const resource = text(body.resource, 'Loại yêu cầu', 20) as keyof typeof employeeRequestCollections
  const collectionName = employeeRequestCollections[resource]
  if (!collectionName) throw new ApiError(400, 'Loại yêu cầu không hợp lệ.')
  const id = text(body.id, 'Mã yêu cầu', 128)
  const targetRef = adminDb.collection(collectionName).doc(id)
  const managerIds = await activeManagerIds()

  await adminDb.runTransaction(async (transaction) => {
    const target = await transaction.get(targetRef)
    if (!target.exists) throw new ApiError(404, 'Không tìm thấy yêu cầu.')
    const current = target.data()!
    if (current.employeeId !== actor.uid) throw new ApiError(403, 'Bạn không thể điều chỉnh yêu cầu này.')
    if (current.status !== 'Pending') throw new ApiError(409, 'Chỉ có thể điều chỉnh yêu cầu đang chờ duyệt.')

    const updates: Record<string, unknown> = {}
    if (resource === 'salary') {
      updates.amount = numberValue(body.amount, 'Số tiền', 1, 1_000_000_000)
      updates.reason = text(body.reason ?? '', 'Ghi chú', 1000, true)
    } else if (resource === 'leave') {
      const duration = String(body.duration)
      if (!['short', 'long'].includes(duration)) throw new ApiError(400, 'Hình thức nghỉ không hợp lệ.')
      const leaveDate = dateValue(body.leaveDate, 'Ngày nghỉ')
      const endDate = dateValue(body.endDate ?? body.leaveDate, 'Ngày kết thúc')
      if (endDate < leaveDate) throw new ApiError(400, 'Ngày kết thúc phải từ ngày bắt đầu trở đi.')
      const legacyScheduleId = body.workScheduleId == null ? '' : text(body.workScheduleId, 'Mã ca làm', 128)
      const rawScheduleIds = Array.isArray(body.workScheduleIds)
        ? body.workScheduleIds
        : legacyScheduleId ? [legacyScheduleId] : []
      if (rawScheduleIds.length > 21) throw new ApiError(400, 'Mỗi yêu cầu nghỉ chỉ được chọn tối đa 21 ca.')
      const scheduleIds = [...new Set(rawScheduleIds.map((value, index) =>
        text(value, `Mã ca làm ${index + 1}`, 128)
      ))]
      if (duration === 'short' && !scheduleIds.length) throw new ApiError(400, 'Vui lòng chọn ít nhất một ca muốn nghỉ.')
      const schedules = await Promise.all(scheduleIds.map((scheduleId) =>
        transaction.get(adminDb.collection('workSchedules').doc(scheduleId))
      ))
      const selectedShiftStarts: Date[] = []
      schedules.forEach((schedule) => {
        if (!schedule.exists || schedule.get('employeeId') !== actor.uid || schedule.get('status') !== 'Approved') {
          throw new ApiError(403, 'Bạn chỉ được xin nghỉ trên ca đã được duyệt của mình.')
        }
        const scheduleDate = (schedule.get('date') as Timestamp).toDate()
        if (vietnamDateKey(scheduleDate) < vietnamDateKey(leaveDate) ||
          vietnamDateKey(scheduleDate) > vietnamDateKey(endDate)) {
          throw new ApiError(400, 'Ca được chọn phải nằm trong khoảng ngày xin nghỉ.')
        }
        selectedShiftStarts.push(shiftStart(scheduleDate, schedule.get('shift') as Shift))
      })
      const noticeTarget = selectedShiftStarts.length
        ? selectedShiftStarts.reduce((earliest, value) => value < earliest ? value : earliest, selectedShiftStarts[0])
        : leaveDate
      const isLate = Date.now() > leaveNoticeDeadline(noticeTarget).getTime()
      updates.duration = duration
      updates.leaveDate = Timestamp.fromDate(leaveDate)
      updates.endDate = Timestamp.fromDate(endDate)
      updates.reason = text(body.reason, 'Lý do', 1000)
      updates.noticeClass = isLate ? 'late' : 'onTime'
      updates.penaltyIfApproved = isLate ? workflowPolicy.leaveLateApprovedPenalty : 0
      updates.penaltyIfRejected = isLate
        ? workflowPolicy.leaveLateRejectedPenalty
        : workflowPolicy.leaveOnTimeRejectedPenalty
      updates.workScheduleId = scheduleIds[0] || FieldValue.delete()
      updates.workScheduleIds = scheduleIds.length ? scheduleIds : FieldValue.delete()
    } else {
      const scheduleId = text(body.workScheduleId, 'Mã ca làm', 128)
      const expectedArrival = text(body.expectedArrival, 'Giờ dự kiến', 5)
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(expectedArrival)) throw new ApiError(400, 'Giờ dự kiến không hợp lệ.')
      const schedule = await transaction.get(adminDb.collection('workSchedules').doc(scheduleId))
      if (!schedule.exists || schedule.get('employeeId') !== actor.uid || schedule.get('status') !== 'Approved') {
        throw new ApiError(403, 'Bạn chỉ được báo trễ cho ca đã được duyệt của mình.')
      }
      const shift = schedule.get('shift') as Shift
      const date = (schedule.get('date') as Timestamp).toDate()
      const start = shiftStart(date, shift)
      const arrival = new Date(`${date.toISOString().slice(0, 10)}T${expectedArrival}:00+07:00`)
      const lateMinutes = Math.ceil((arrival.getTime() - start.getTime()) / 60_000)
      if (lateMinutes < 1 || lateMinutes > 720) throw new ApiError(400, 'Giờ dự kiến phải sau giờ bắt đầu ca.')
      updates.workScheduleId = scheduleId
      updates.date = schedule.get('date')
      updates.shift = shift
      updates.expectedArrival = expectedArrival
      updates.lateMinutes = lateMinutes
      updates.reason = text(body.reason, 'Lý do', 1000)
    }

    const now = FieldValue.serverTimestamp()
    transaction.set(targetRef, {
      ...updates,
      status: 'Pending',
      revisedAt: now,
      updatedAt: now,
    }, { merge: true })
    managerIds.forEach((managerId) => {
      const copy = managerRequestCopy[resource]
      transaction.set(
        managerNotificationRef(managerId, `${resource}-${id}`),
        managerNotification(managerId, `${copy.title.replace(' chờ xử lý', '')} đã điều chỉnh`, 'Nhân viên vừa cập nhật nội dung. Vui lòng kiểm tra lại.')
      )
    })
  })

  const copy = managerRequestCopy[resource]
  await sendManagerPushes({
    managerIds,
    sourceKey: `${resource}-revised-${id}`,
    title: `${copy.title.replace(' chờ xử lý', '')} đã điều chỉnh`,
    body: 'Nhân viên vừa cập nhật nội dung. Vui lòng kiểm tra lại.',
    link: '/notifications',
    source: collectionName,
    sourceId: id,
  })

  return { id, status: 'Pending' }
}

export async function createForgottenDutyPenalty(actor: RequestActor, raw: unknown) {
  requireManager(actor)
  const body = objectBody(raw)
  const employeeId = text(body.employeeId, 'Nhân viên', 128)
  const dutyDate = dateValue(body.date, 'Ngày quên trực')
  const note = text(body.note ?? '', 'Ghi chú', 500, true)
  const employeeRef = adminDb.collection('employees').doc(employeeId)
  const penaltyRef = adminDb.collection('penalties').doc()
  const notificationRef = adminDb.collection('notifications').doc()

  await adminDb.runTransaction(async (transaction) => {
    const employee = await transaction.get(employeeRef)
    if (!employee.exists || employee.get('status') !== 'active') {
      throw new ApiError(404, 'Không tìm thấy nhân viên đang hoạt động.')
    }
    const now = FieldValue.serverTimestamp()
    transaction.create(penaltyRef, {
      employeeId,
      title: 'Quên trực',
      description: `Quên lịch trực ngày ${dutyDate.toLocaleDateString('vi-VN')}. Khấu trừ 1.000đ vào tiền công của 1 giờ làm.${note ? ` Ghi chú: ${note}` : ''}`,
      category: 'Other',
      amount: 1000,
      penaltyDate: Timestamp.fromDate(dutyDate),
      createdBy: actor.uid,
      sourceType: 'forgottenDuty',
      createdAt: now,
    })
    transaction.create(notificationRef, warningNotification(
      employeeId,
      'Ghi nhận phạt quên trực',
      'Khấu trừ 1.000đ vào tiền công của 1 giờ làm. Mở Khoản phạt để xem chi tiết.'
    ))
  })

  const push = await sendPenaltyPush({
    employeeId,
    penaltyId: penaltyRef.id,
    event: 'created',
    title: 'Ghi nhận phạt quên trực',
    body: 'Khoản phạt 1.000đ đã được quản lý ghi nhận. Mở Khoản phạt để xem chi tiết.',
  })

  return { id: penaltyRef.id, amount: 1000, push }
}

export async function createManualPenalty(actor: RequestActor, raw: unknown) {
  requireManager(actor)
  const body = objectBody(raw)
  const operationId = requestId(body)
  const employeeId = text(body.employeeId, 'Nhân viên', 128)
  const penaltyDate = dateValue(body.date, 'Ngày phạt')
  const amount = numberValue(body.amount, 'Số tiền phạt', 1, 1_000_000_000)
  const reason = text(body.reason, 'Lý do phạt', 1000)
  const employeeRef = adminDb.collection('employees').doc(employeeId)
  const penaltyRef = adminDb.collection('penalties').doc()
  const notificationRef = adminDb.collection('notifications').doc(`manual-penalty-${operationId}`)
  const workflow = workflowRef(actor, operationId)

  await adminDb.runTransaction(async (transaction) => {
    const [employee, existingWorkflow] = await Promise.all([
      transaction.get(employeeRef),
      transaction.get(workflow),
    ])
    if (existingWorkflow.exists) throw new ApiError(409, 'Khoản phạt này đã được ghi nhận trước đó.')
    if (!employee.exists || employee.get('status') !== 'active') {
      throw new ApiError(404, 'Không tìm thấy nhân viên đang hoạt động.')
    }
    const now = FieldValue.serverTimestamp()
    transaction.create(penaltyRef, {
      employeeId,
      title: 'Phạt do quản lý ghi nhận',
      description: reason,
      category: 'Other',
      amount,
      penaltyDate: Timestamp.fromDate(penaltyDate),
      createdBy: actor.uid,
      sourceType: 'manual',
      status: 'Active',
      createdAt: now,
      updatedAt: now,
    })
    transaction.create(notificationRef, warningNotification(
      employeeId,
      'Quản lý đã ghi nhận khoản phạt',
      `${amount.toLocaleString('vi-VN')}đ · Lý do: ${reason}`
    ))
    transaction.create(workflow, {
      employeeId,
      action: 'createManualPenalty',
      targetIds: [penaltyRef.id],
      amount,
      createdAt: now,
    })
  })

  const push = await sendPenaltyPush({
    employeeId,
    penaltyId: penaltyRef.id,
    event: 'created',
    title: 'Quản lý đã ghi nhận khoản phạt',
    body: `${amount.toLocaleString('vi-VN')}đ · ${reason}`,
  })
  return { id: penaltyRef.id, amount, push }
}

export async function managePenalty(actor: RequestActor, raw: unknown) {
  requireManager(actor)
  const body = objectBody(raw)
  const operationId = requestId(body)
  const id = text(body.id, 'Mã khoản phạt', 128)
  const mode = text(body.mode, 'Thao tác', 20)
  if (!['adjust', 'cancel'].includes(mode)) {
    throw new ApiError(400, 'Thao tác khoản phạt không hợp lệ.')
  }
  const reason = text(body.reason, 'Lý do', 1000)
  const adjustedAmount = mode === 'adjust'
    ? numberValue(body.amount, 'Số tiền', 1, 1_000_000_000)
    : 0

  const penaltyRef = adminDb.collection('penalties').doc(id)
  const workflow = workflowRef(actor, operationId)
  const notificationRef = adminDb.collection('notifications').doc(`penalty-${id}-${operationId}`)
  const dispatchRef = adminDb.collection('pushDispatches').doc(`penalty-${id}-${operationId}`)
  let employeeId = ''
  let previousAmount = 0

  await adminDb.runTransaction(async (transaction) => {
    const [workflowSnapshot, penaltySnapshot] = await Promise.all([
      transaction.get(workflow),
      transaction.get(penaltyRef),
    ])
    if (workflowSnapshot.exists) throw new ApiError(409, 'Thao tác khoản phạt này đã được gửi.')
    if (!penaltySnapshot.exists) throw new ApiError(404, 'Không tìm thấy khoản phạt.')
    const penalty = penaltySnapshot.data()!
    if (penalty.status === 'Cancelled') {
      throw new ApiError(409, 'Khoản phạt này đã được hủy.')
    }

    employeeId = String(penalty.employeeId || '')
    previousAmount = Number(penalty.amount || 0)
    if (!employeeId || previousAmount < 0) throw new ApiError(409, 'Dữ liệu khoản phạt không hợp lệ.')
    if (mode === 'adjust' && adjustedAmount === previousAmount) {
      throw new ApiError(409, 'Số tiền mới phải khác số tiền hiện tại.')
    }

    const now = FieldValue.serverTimestamp()
    const title = mode === 'adjust' ? 'Khoản phạt đã được điều chỉnh' : 'Khoản phạt đã được hủy'
    const message = mode === 'adjust'
      ? `Quản lý đã điều chỉnh khoản phạt từ ${previousAmount.toLocaleString('vi-VN')}đ thành ${adjustedAmount.toLocaleString('vi-VN')}đ. Lý do: ${reason}`
      : `Quản lý đã hủy khoản phạt ${previousAmount.toLocaleString('vi-VN')}đ. Lý do: ${reason}`

    transaction.set(penaltyRef, mode === 'adjust' ? {
      amount: adjustedAmount,
      status: 'Active',
      originalAmount: penalty.originalAmount ?? previousAmount,
      adjustmentReason: reason,
      adjustedBy: actor.uid,
      adjustedAt: now,
      updatedAt: now,
    } : {
      amount: 0,
      status: 'Cancelled',
      originalAmount: penalty.originalAmount ?? previousAmount,
      cancelledAmount: previousAmount,
      cancellationReason: reason,
      cancelledBy: actor.uid,
      cancelledAt: now,
      updatedAt: now,
    }, { merge: true })
    transaction.create(notificationRef, warningNotification(employeeId, title, message))
    transaction.create(dispatchRef, {
      source: 'penalties',
      sourceId: id,
      employeeId,
      status: mode === 'adjust' ? 'adjusted' : 'cancelled',
      state: 'queued',
      createdAt: now,
      updatedAt: now,
    })
    transaction.create(workflow, {
      employeeId,
      action: mode === 'adjust' ? 'adjustPenalty' : 'cancelPenalty',
      targetIds: [id],
      previousAmount,
      amount: adjustedAmount,
      createdAt: now,
    })
  })

  const title = mode === 'adjust' ? 'Khoản phạt đã được điều chỉnh' : 'Khoản phạt đã được hủy'
  const bodyText = mode === 'adjust'
    ? `Số tiền đã đổi từ ${previousAmount.toLocaleString('vi-VN')}đ thành ${adjustedAmount.toLocaleString('vi-VN')}đ.`
    : `Khoản phạt ${previousAmount.toLocaleString('vi-VN')}đ đã được hủy.`
  const push = await sendEmployeePush({
    employeeId,
    dispatchId: dispatchRef.id,
    title,
    body: bodyText,
    link: '/penalties',
    source: 'penalties',
    sourceId: id,
    status: mode === 'adjust' ? 'adjusted' : 'cancelled',
  })

  return {
    id,
    status: mode === 'adjust' ? 'Active' : 'Cancelled',
    amount: adjustedAmount,
    previousAmount,
    push,
  }
}

const reviewConfig = {
  schedule: {
    collection: 'workSchedules',
    statuses: ['Approved', 'Rejected', 'ChangesRequested'],
    title: 'Lịch làm đã được xử lý',
    label: 'Lịch làm',
    link: '/schedule',
  },
  leave: {
    collection: 'leaveRequests',
    statuses: ['Approved', 'Rejected'],
    title: 'Yêu cầu nghỉ đã được xử lý',
    label: 'Yêu cầu nghỉ',
    link: '/leave-request',
  },
  late: {
    collection: 'lateRequests',
    statuses: ['Approved', 'Rejected'],
    title: 'Yêu cầu đi trễ đã được xử lý',
    label: 'Yêu cầu đi trễ',
    link: '/late-arrival',
  },
  salary: {
    collection: 'salaryAdvances',
    statuses: ['Approved', 'Rejected'],
    title: 'Yêu cầu ứng lương đã được xử lý',
    label: 'Yêu cầu ứng lương',
    link: '/salary-advance',
  },
  staff: {
    collection: 'staffRequests',
    statuses: ['Approved', 'Rejected'],
    title: 'Yêu cầu gửi quản lý đã được xử lý',
    label: 'Yêu cầu',
    link: '/schedule',
  },
} as const

function statusText(status: ReviewStatus): string {
  if (status === 'Approved') return 'đã được duyệt'
  if (status === 'Rejected') return 'đã bị từ chối'
  return 'cần chỉnh sửa'
}

export async function reviewRequest(actor: RequestActor, raw: unknown) {
  requireManager(actor)
  const body = objectBody(raw)
  const resource = text(body.resource, 'Loại yêu cầu', 20) as keyof typeof reviewConfig
  const config = reviewConfig[resource]
  if (!config) throw new ApiError(400, 'Loại yêu cầu không hợp lệ.')
  const id = text(body.id, 'Mã yêu cầu', 128)
  const status = text(body.status, 'Trạng thái', 30) as ReviewStatus
  if (!(config.statuses as readonly string[]).includes(status)) {
    throw new ApiError(400, 'Trạng thái xử lý không hợp lệ.')
  }
  const note = text(body.note ?? '', 'Phản hồi', 1000, true)
  if (status !== 'Approved' && !note) throw new ApiError(400, 'Vui lòng nhập lý do hoặc nội dung cần sửa.')
  const managerPenaltyAmount = body.penaltyAmount == null
    ? null
    : numberValue(body.penaltyAmount, 'Khoản trừ', 0, 100_000_000)

  const targetRef = adminDb.collection(config.collection).doc(id)
  const decisionPenaltyRef = resource === 'leave' || resource === 'late'
    ? adminDb.collection('penalties').doc(`${resource}-decision-${id}`)
    : null
  const notificationRef = adminDb.collection('notifications').doc(`${config.collection}-${id}-${status}`)
  const dispatchRef = adminDb.collection('pushDispatches').doc(`${config.collection}-${id}-${status}`)
  const managerIds = await activeManagerIds()
  let employeeId = ''
  let reviewedLabel: string = config.label
  let reviewedLink: string = config.link
  let reviewedEmployee = 'Nhân viên'
  let requiresEmployeeConsent = false
  let appliedPenaltyAmount = 0

  await adminDb.runTransaction(async (transaction) => {
    const [target, existingLeavePenalty] = await Promise.all([
      transaction.get(targetRef),
      decisionPenaltyRef ? transaction.get(decisionPenaltyRef) : Promise.resolve(null),
    ])
    if (!target.exists) throw new ApiError(404, 'Không tìm thấy yêu cầu.')
    const data = target.data()!
    if (!['Pending', 'Registered', 'Approved', 'Rejected'].includes(data.status)) {
      throw new ApiError(409, 'Yêu cầu này đang bị khóa hoặc đã bị hủy.')
    }
    if (data.status === status) {
      throw new ApiError(409, 'Yêu cầu đã ở trạng thái này.')
    }
    employeeId = data.employeeId
    const employeeSnapshot = await transaction.get(adminDb.collection('employees').doc(employeeId))
    const employeeName = String(employeeSnapshot.get('fullName') || 'Nhân viên')
    const employeeCode = String(employeeSnapshot.get('employeeCode') || employeeId.slice(0, 8))
    reviewedEmployee = `${employeeName} · ${employeeCode}`
    const isLate = data.noticeClass === 'late'
    const suggestedAmount = status === 'Approved'
      ? Number(data.penaltyIfApproved ?? (isLate ? workflowPolicy.leaveLateApprovedPenalty : 0))
      : Number(data.penaltyIfRejected ?? (isLate ? workflowPolicy.leaveLateRejectedPenalty : workflowPolicy.leaveOnTimeRejectedPenalty))
    appliedPenaltyAmount = resource === 'leave' || resource === 'late' ? managerPenaltyAmount ?? suggestedAmount : 0
    requiresEmployeeConsent = resource === 'leave' && status === 'Approved' && appliedPenaltyAmount > 0
    const longLeaveSchedules = resource === 'leave' && status === 'Approved' && !requiresEmployeeConsent && data.duration === 'long'
      ? await transaction.get(adminDb.collection('workSchedules').where('employeeId', '==', employeeId))
      : null
    const now = FieldValue.serverTimestamp()
    if ((resource === 'leave' || resource === 'late') && decisionPenaltyRef) {
      const amount = appliedPenaltyAmount
      if (amount > 0 && !requiresEmployeeConsent) {
        transaction.set(decisionPenaltyRef, {
          ...penaltyData({
            employeeId,
            title: resource === 'late'
              ? 'Xử lý thông báo đi trễ'
              : isLate ? 'Xin nghỉ sau 16:00 hôm trước' : 'Yêu cầu nghỉ không được duyệt',
            description: resource === 'late'
              ? `Quản lý ${status === 'Approved' ? 'xác nhận' : 'từ chối'} thông báo đi trễ và áp dụng mức trừ đã xác nhận.`
              : status === 'Approved'
                ? 'Yêu cầu nghỉ được duyệt kèm mức trừ do quản lý xác nhận.'
                : `Yêu cầu nghỉ ${isLate ? 'trễ hạn ' : ''}đã bị từ chối.`,
            category: 'Late',
            amount,
            sourceType: resource === 'late' ? 'lateRequest' : 'leaveRequest',
            sourceId: id,
          }),
          status: 'Active',
          decisionStatus: status,
          updatedAt: now,
          ...((existingLeavePenalty?.exists && existingLeavePenalty.get('createdAt'))
            ? { createdAt: existingLeavePenalty.get('createdAt') }
            : {}),
        }, { merge: true })
      } else if (existingLeavePenalty?.exists) {
        transaction.set(decisionPenaltyRef, {
          amount: 0,
          status: 'Cancelled',
          decisionStatus: status,
          cancellationReason: requiresEmployeeConsent ? 'Tạm dừng chờ nhân viên đồng ý mức trừ mới.' : 'Quyết định hiện tại không phát sinh khấu trừ.',
          cancelledBy: actor.uid,
          cancelledAt: now,
          updatedAt: now,
        }, { merge: true })
      }
    }
    if (resource === 'leave' && status === 'Approved' && !requiresEmployeeConsent && data.duration === 'long') {
      const leaveStart = (data.leaveDate as Timestamp).toDate()
      const leaveEnd = (data.endDate as Timestamp | undefined)?.toDate() ?? leaveStart
      longLeaveSchedules?.docs.forEach((snapshot) => {
        const scheduleDate = (snapshot.get('date') as Timestamp).toDate()
        if (snapshot.get('status') === 'Approved' &&
          vietnamDateKey(scheduleDate) >= vietnamDateKey(leaveStart) &&
          vietnamDateKey(scheduleDate) <= vietnamDateKey(leaveEnd)) {
          transaction.set(snapshot.ref, {
            status: 'Cancelled',
            cancellationReason: `Tự động hủy do nghỉ dài hạn được duyệt (${id}).`,
            cancelledBy: actor.uid,
            cancelledAt: now,
            lockedAt: null,
            updatedAt: now,
          }, { merge: true })
        }
      })
    }
    if (resource === 'staff' && status === 'Approved' && ['overtime', 'scheduleChange'].includes(data.type)) {
      const removedItems = data.type === 'scheduleChange' && Array.isArray(data.removedShifts)
        ? data.removedShifts as Array<{ scheduleId: string; date: Timestamp; shift: Shift }>
        : []
      const removedRefs = removedItems
        .filter((item) => typeof item?.scheduleId === 'string')
        .map((item) => adminDb.collection('workSchedules').doc(item.scheduleId))
      const removedSnapshots = await Promise.all(removedRefs.map((ref) => transaction.get(ref)))
      removedSnapshots.forEach((snapshot, index) => {
        if (!snapshot.exists || snapshot.get('employeeId') !== employeeId || snapshot.get('status') !== 'Approved') {
          throw new ApiError(409, 'Một ca xin hủy đã thay đổi. Vui lòng từ chối yêu cầu và bảo nhân viên tải lại lịch.')
        }
      })
      const currentSchedules = await transaction.get(
        adminDb.collection('workSchedules').where('employeeId', '==', employeeId)
      )
      removedRefs.forEach((ref) => transaction.set(ref, {
        status: 'Cancelled',
        lockedAt: null,
        reviewedBy: actor.uid,
        reviewedAt: now,
        updatedAt: now,
      }, { merge: true }))
      const existingKeys = new Set(currentSchedules.docs
        .filter((snapshot) => snapshot.get('status') !== 'Cancelled' && !removedRefs.some((ref) => ref.id === snapshot.id))
        .map((snapshot) => {
          const schedule = snapshot.data()
          return `${(schedule.date as Timestamp).toDate().toISOString().slice(0, 10)}-${schedule.shift}`
        }))
      const overtimeShifts = (Array.isArray(data.shifts) ? data.shifts : [] as Array<{ date: Timestamp; shift: Shift }>).filter((item: { date: Timestamp; shift: Shift }) =>
        item?.date instanceof Timestamp && shifts.includes(item.shift)
      )
      const firstDate = overtimeShifts[0]?.date.toDate() || removedItems[0]?.date?.toDate()
      overtimeShifts.forEach((item, index) => {
        const key = `${item.date.toDate().toISOString().slice(0, 10)}-${item.shift}`
        if (existingKeys.has(key) || !firstDate) return
        transaction.set(adminDb.collection('workSchedules').doc(`${data.type === 'scheduleChange' ? 'schedule-change' : 'overtime'}-${id}-${index}`), {
          employeeId,
          date: item.date,
          shift: item.shift,
          status: 'Approved',
          note: `${data.type === 'scheduleChange' ? '[SCHEDULE_CHANGE_APPROVED]' : '[OVERTIME_APPROVED]'}${data.content ? ` ${String(data.content).slice(0, 450)}` : ''}`,
          batchKey: scheduleBatchKey(employeeId, mondayFor(firstDate)),
          requiresReapproval: false,
          revisionCount: 0,
          createdAt: now,
          updatedAt: now,
          lockedAt: now,
          reviewedBy: actor.uid,
          reviewedAt: now,
        }, { merge: true })
        existingKeys.add(key)
      })
    }
    if (resource === 'staff' && status === 'Rejected' && data.type === 'overtime' && Array.isArray(data.shifts)) {
      const generatedRefs = data.shifts.map((_: unknown, index: number) =>
        adminDb.collection('workSchedules').doc(`overtime-${id}-${index}`)
      )
      const generatedSnapshots = await Promise.all(generatedRefs.map((ref) => transaction.get(ref)))
      generatedSnapshots.forEach((snapshot, index) => {
        if (!snapshot.exists) return
        transaction.set(generatedRefs[index], {
          status: 'Cancelled',
          lockedAt: null,
          reviewedBy: actor.uid,
          reviewedAt: now,
          updatedAt: now,
        }, { merge: true })
      })
    }
    const updates: Record<string, unknown> = {
      status: requiresEmployeeConsent ? 'AwaitingEmployeeConsent' : status,
      updatedAt: now,
      reviewedBy: actor.uid,
      reviewedAt: now,
    }
    if (resource === 'schedule') {
      updates.reviewNote = note
      updates.lockedAt = status === 'Approved' ? now : null
    } else {
      updates.approvedBy = actor.uid
      updates.reviewNote = note
      if (requiresEmployeeConsent) {
        updates.proposedPenaltyAmount = appliedPenaltyAmount
        updates.penaltyConsentStatus = 'Pending'
      }
    }
    transaction.set(targetRef, updates, { merge: true })
    const requestLabel = resource === 'staff'
      ? data.type === 'scheduleChange' ? 'Yêu cầu đổi / thêm ca' : data.type === 'overtime' ? 'Yêu cầu làm thêm' : 'Ghi chú'
      : config.label
    reviewedLabel = requestLabel
    reviewedLink = resource === 'staff' && data.type === 'note' ? '/staff-note' : config.link
    transaction.set(notificationRef, {
      employeeId,
      title: config.title,
      message: requiresEmployeeConsent
        ? `${requestLabel} được quản lý đồng ý với mức trừ ${appliedPenaltyAmount.toLocaleString('vi-VN')}đ. Vui lòng mở mục Xin nghỉ để chấp nhận hoặc từ chối.`
        : `${requestLabel} của bạn ${statusText(status)}.${appliedPenaltyAmount > 0 ? ` Mức trừ được quản lý xác nhận: ${appliedPenaltyAmount.toLocaleString('vi-VN')}đ.` : ''}${note ? ` Phản hồi: ${note}` : ''}`,
      type: requiresEmployeeConsent ? 'warning' : status === 'Approved' ? 'success' : 'warning',
      isRead: false,
      createdAt: now,
    })
    transaction.set(dispatchRef, {
      source: config.collection,
      sourceId: id,
      employeeId,
      status,
      state: 'queued',
      createdAt: now,
      updatedAt: now,
    })
    managerIds.forEach((managerId) => {
      transaction.set(
        managerNotificationRef(managerId, `${resource}-${id}`),
        managerNotification(
          managerId,
          requiresEmployeeConsent ? `${requestLabel} đang chờ nhân viên đồng ý mức trừ` : `${requestLabel} đã ${status === 'Approved' ? 'được duyệt' : 'bị từ chối'}`,
          `Nhân viên: ${reviewedEmployee}.`,
          'info',
          true
        )
      )
    })
  })

  const push = await sendEmployeePush({
    employeeId,
    dispatchId: dispatchRef.id,
    title: config.title,
    body: requiresEmployeeConsent ? `${reviewedLabel} đang chờ bạn đồng ý mức trừ ${appliedPenaltyAmount.toLocaleString('vi-VN')}đ.` : `${reviewedLabel} của bạn ${statusText(status)}.`,
    link: reviewedLink,
    source: config.collection,
    sourceId: id,
    status,
  })
  return { id, status: requiresEmployeeConsent ? 'AwaitingEmployeeConsent' : status, push }
}

export async function reviewScheduleBatch(actor: RequestActor, raw: unknown) {
  requireManager(actor)
  const body = objectBody(raw)
  if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 21) {
    throw new ApiError(400, 'Bảng lịch cần từ 1 đến 21 ca.')
  }
  const ids = body.ids.map((value, index) => text(value, `Mã ca ${index + 1}`, 128))
  if (new Set(ids).size !== ids.length) throw new ApiError(400, 'Bảng lịch có ca bị trùng.')
  const status = text(body.status, 'Trạng thái', 30) as ReviewStatus
  if (!['Approved', 'Rejected'].includes(status)) {
    throw new ApiError(400, 'Trạng thái xử lý không hợp lệ.')
  }
  const note = text(body.note ?? '', 'Phản hồi', 1000, true)
  if (status === 'Rejected' && !note) throw new ApiError(400, 'Vui lòng nhập lý do từ chối.')

  const refs = ids.map((id) => adminDb.collection('workSchedules').doc(id))
  let employeeId = ''
  const notificationRef = adminDb.collection('notifications').doc(`schedule-status-${ids[0]}`)
  const dispatchRef = adminDb.collection('pushDispatches').doc(`schedule-batch-${ids[0]}-${status}`)
  const managerIds = await activeManagerIds()
  let reviewedEmployee = 'Nhân viên'

  await adminDb.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)))
    if (snapshots.some((snapshot) => !snapshot.exists)) {
      throw new ApiError(404, 'Không tìm thấy đầy đủ bảng lịch.')
    }
    const schedules = snapshots.map((snapshot) => snapshot.data()!)
    employeeId = schedules[0].employeeId
    const employeeSnapshot = await transaction.get(adminDb.collection('employees').doc(employeeId))
    const employeeName = String(employeeSnapshot.get('fullName') || 'Nhân viên')
    const employeeCode = String(employeeSnapshot.get('employeeCode') || employeeId.slice(0, 8))
    reviewedEmployee = `${employeeName} · ${employeeCode}`
    const week = mondayFor((schedules[0].date as Timestamp).toDate()).toISOString()
    const batchKey = schedules[0].batchKey || scheduleBatchKey(employeeId, mondayFor((schedules[0].date as Timestamp).toDate()))
    if (schedules.some((schedule) =>
      schedule.employeeId !== employeeId ||
      mondayFor((schedule.date as Timestamp).toDate()).toISOString() !== week ||
      !['Pending', 'Registered', 'Approved', 'Rejected'].includes(schedule.status)
    )) {
      throw new ApiError(409, 'Bảng lịch không đồng nhất hoặc đã được xử lý.')
    }
    if (schedules.every((schedule) => schedule.status === status)) {
      throw new ApiError(409, 'Bảng lịch đã ở trạng thái này.')
    }

    const now = FieldValue.serverTimestamp()
    refs.forEach((ref) => transaction.set(ref, {
      status,
      requiresReapproval: false,
      reviewNote: note,
      reviewedBy: actor.uid,
      reviewedAt: now,
      updatedAt: now,
      lockedAt: status === 'Approved' ? now : null,
    }, { merge: true }))
    transaction.set(notificationRef, {
      employeeId,
      title: 'Yêu cầu gửi lịch đã được xử lý',
      message: status === 'Approved'
        ? `Toàn bộ ${ids.length} ca trong bảng tuần của bạn đã được quản lý xác nhận.`
        : `Bảng lịch tuần của bạn đã bị từ chối. Phản hồi: ${note}`,
      type: status === 'Approved' ? 'success' : 'warning',
      isRead: false,
      createdAt: now,
    }, { merge: true })
    transaction.set(dispatchRef, {
      source: 'workSchedules',
      sourceId: ids[0],
      employeeId,
      status,
      state: 'queued',
      createdAt: now,
      updatedAt: now,
    })
    managerIds.forEach((managerId) => {
      transaction.set(
        managerNotificationRef(managerId, `schedule-${batchKey}`),
        managerNotification(
          managerId,
          `Bảng lịch đã ${status === 'Approved' ? 'được duyệt' : 'bị từ chối'}`,
          `Nhân viên: ${reviewedEmployee}.`,
          'info',
          true
        )
      )
    })
  })

  const push = await sendEmployeePush({
    employeeId,
    dispatchId: dispatchRef.id,
    title: status === 'Approved' ? 'Lịch làm đã được xác nhận' : 'Lịch làm đã bị từ chối',
    body: status === 'Approved'
      ? 'Toàn bộ bảng lịch tuần của bạn đã được duyệt.'
      : `Bảng lịch tuần của bạn đã bị từ chối. ${note}`,
    link: '/schedule',
    source: 'workSchedules',
    sourceId: ids[0],
    status,
  })
  return { ids, status, push }
}

async function sendEmployeePush(params: {
  employeeId: string
  dispatchId: string
  title: string
  body: string
  link: string
  source: string
  sourceId: string
  status: string
}) {
  const dispatchRef = adminDb.collection('pushDispatches').doc(params.dispatchId)
  const devices = await adminDb.collection('employees').doc(params.employeeId)
    .collection('notificationDevices').limit(500).get()
  const fids = devices.docs.map((item) => item.get('fid')).filter((fid): fid is string => typeof fid === 'string' && !!fid)
  if (!fids.length) {
    await dispatchRef.update({ state: 'no-devices', updatedAt: FieldValue.serverTimestamp() })
    return { state: 'no-devices', successCount: 0, failureCount: 0 }
  }

  try {
    const response = await adminMessaging.sendEachForMulticast({
      fids,
      notification: {
        title: params.title,
        body: params.body,
      },
      data: {
        title: params.title,
        body: params.body,
        link: params.link,
        source: params.source,
        sourceId: params.sourceId,
        status: params.status,
      },
      webpush: {
        notification: {
          icon: '/pwa-icon-192.png',
          badge: '/pwa-icon-192.png',
        },
        fcmOptions: { link: params.link },
      },
    })
    const invalidCodes = new Set([
      'messaging/registration-token-not-registered',
      'messaging/invalid-registration-token',
      'messaging/invalid-argument',
    ])
    const batch = adminDb.batch()
    response.responses.forEach((item, index) => {
      if (!item.success && item.error?.code && invalidCodes.has(item.error.code)) {
        batch.delete(devices.docs[index].ref)
      }
    })
    batch.update(dispatchRef, {
      state: response.failureCount ? 'partial' : 'sent',
      successCount: response.successCount,
      failureCount: response.failureCount,
      updatedAt: FieldValue.serverTimestamp(),
    })
    await batch.commit()
    return {
      state: response.failureCount ? 'partial' : 'sent',
      successCount: response.successCount,
      failureCount: response.failureCount,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : 'Lỗi FCM không xác định'
    await dispatchRef.update({ state: 'failed', error: message, updatedAt: FieldValue.serverTimestamp() })
    return { state: 'failed', successCount: 0, failureCount: fids.length }
  }
}
