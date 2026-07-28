import 'server-only'

import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb, adminMessaging } from '@/lib/server/firebase-admin'
import { ApiError, type RequestActor, requireManager, requireStaff } from '@/lib/server/api-auth'
import { workflowPolicy } from '@/lib/server/workflow-policy'

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

function scheduleDeadline(firstShift: Date): Date {
  const monday = mondayFor(firstShift)
  // Sunday before the work week at the configured hour in Vietnam (UTC+7).
  return new Date(
    Date.UTC(
      monday.getUTCFullYear(),
      monday.getUTCMonth(),
      monday.getUTCDate() - 1,
      workflowPolicy.scheduleDeadlineHour - 7,
      0,
      0
    )
  )
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
        createdAt: now,
        updatedAt: now,
        lockedAt: null,
      })
    })

    if (shouldPenalize && workflowPolicy.scheduleLatePenalty > 0) {
      transaction.create(penaltyRef, penaltyData({
        employeeId: actor.uid,
        title: 'Đăng ký lịch trễ hạn',
        description: `Gửi lịch sau hạn Chủ nhật ${workflowPolicy.scheduleDeadlineHour}:00. Khấu trừ 1.000đ vào tiền công của 1 giờ làm.`,
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

    managerIds.forEach((managerId) => {
      transaction.set(
        managerNotificationRef(managerId, `schedule-${batchKey}`),
        managerNotification(
          managerId,
          'Bảng lịch mới chờ xác nhận',
          `Một nhân viên vừa gửi bảng lịch tuần ${weekStart.toLocaleDateString('vi-VN')}.`
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
    body: 'Một nhân viên vừa gửi bảng lịch tuần. Mở Trí Candy để xử lý.',
    link: '/admin/dashboard',
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

  const oldRefs = scheduleIds.map((scheduleId) => adminDb.collection('workSchedules').doc(scheduleId))
  const newRefs = schedules.map(() => adminDb.collection('workSchedules').doc())
  const workflow = workflowRef(actor, id)
  const managerIds = await activeManagerIds()

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
      penaltyId: null,
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
    link: '/admin/dashboard',
    source: 'workSchedules',
    sourceId: newRefs[0].id,
  })

  return { ids: newRefs.map((ref) => ref.id), penalty: 0 }
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
  const managerIds = await activeManagerIds()
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
      managerIds.forEach((managerId) => {
        transaction.set(
          managerNotificationRef(managerId, `schedule-${batchKey}`),
          managerNotification(
            managerId,
            'Nhân viên đang sửa bảng lịch',
            'Bảng này tạm thời chưa thể xác nhận. Nội dung mới sẽ tự cập nhật khi nhân viên gửi lại.',
            'info'
          )
        )
      })
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
    const actionRequired = restoredStatuses.some((status) => ['Pending', 'Registered', 'Rejected'].includes(status))
    managerIds.forEach((managerId) => {
      transaction.set(
        managerNotificationRef(managerId, `schedule-${batchKey}`),
        managerNotification(
          managerId,
          actionRequired ? 'Bảng lịch chờ xác nhận' : 'Nhân viên đã hủy chỉnh sửa lịch',
          actionRequired ? 'Bảng lịch đã trở lại trạng thái chờ xử lý.' : 'Bảng lịch giữ nguyên nội dung đã xác nhận.',
          actionRequired ? 'warning' : 'info',
          !actionRequired
        )
      )
    })
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
  const workScheduleId = body.workScheduleId == null
    ? ''
    : text(body.workScheduleId, 'Mã ca làm', 128)
  const leaveType = text(body.leaveType ?? 'personal', 'Loại nghỉ', 30)
  if (!['sick', 'casual', 'earned', 'personal'].includes(leaveType)) {
    throw new ApiError(400, 'Loại nghỉ không hợp lệ.')
  }

  const noticeMs = leaveDate.getTime() - Date.now()
  const isLate = noticeMs < workflowPolicy.leaveNoticeHours * 60 * 60 * 1000
  const workflow = workflowRef(actor, id)
  const leaveRef = adminDb.collection('leaveRequests').doc()
  const penaltyRef = adminDb.collection('penalties').doc(`leave-${actor.uid}-${id}`)
  const notificationRef = adminDb.collection('notifications').doc(`leave-penalty-${actor.uid}-${id}`)
  const managerIds = await activeManagerIds()

  await adminDb.runTransaction(async (transaction) => {
    if ((await transaction.get(workflow)).exists) throw new ApiError(409, 'Yêu cầu nghỉ này đã được gửi.')
    const now = FieldValue.serverTimestamp()
    if (workScheduleId) {
      const schedule = await transaction.get(adminDb.collection('workSchedules').doc(workScheduleId))
      if (!schedule.exists ||
        schedule.get('employeeId') !== actor.uid ||
        schedule.get('status') !== 'Approved') {
        throw new ApiError(403, 'Bạn chỉ được xin nghỉ trên ca đã được duyệt của mình.')
      }
    }
    transaction.create(leaveRef, {
      employeeId: actor.uid,
      ...(workScheduleId ? { workScheduleId } : {}),
      leaveDate: Timestamp.fromDate(leaveDate),
      endDate: Timestamp.fromDate(endDate),
      duration,
      leaveType,
      reason,
      status: 'Pending',
      createdAt: now,
      updatedAt: now,
    })
    if (isLate && workflowPolicy.leaveLatePenalty > 0) {
      transaction.create(penaltyRef, penaltyData({
        employeeId: actor.uid,
        title: 'Báo nghỉ trễ',
        description: `Yêu cầu được gửi dưới ${workflowPolicy.leaveNoticeHours} giờ trước ngày nghỉ.`,
        category: 'Late',
        amount: workflowPolicy.leaveLatePenalty,
        sourceType: 'leaveRequest',
        sourceId: leaveRef.id,
      }))
      transaction.create(notificationRef, warningNotification(
        actor.uid,
        'Phát sinh khoản phạt báo nghỉ trễ',
        `Khoản phạt ${workflowPolicy.leaveLatePenalty.toLocaleString('vi-VN')}đ đã được ghi nhận.`
      ))
    }
    transaction.create(workflow, {
      employeeId: actor.uid,
      action: 'submitLeave',
      targetIds: [leaveRef.id],
      penaltyId: isLate && workflowPolicy.leaveLatePenalty > 0 ? penaltyRef.id : null,
      createdAt: now,
    })
    managerIds.forEach((managerId) => {
      transaction.set(
        managerNotificationRef(managerId, `leave-${leaveRef.id}`),
        managerNotification(managerId, managerRequestCopy.leave.title, managerRequestCopy.leave.message)
      )
    })
  })

  await sendManagerPushes({
    managerIds,
    sourceKey: `leave-${leaveRef.id}`,
    title: managerRequestCopy.leave.title,
    body: managerRequestCopy.leave.message,
    link: '/admin/requests',
    source: 'leaveRequests',
    sourceId: leaveRef.id,
  })

  if (isLate && workflowPolicy.leaveLatePenalty > 0) {
    await sendPenaltyPush({
      employeeId: actor.uid,
      penaltyId: penaltyRef.id,
      event: 'created',
      title: 'Phát sinh khoản phạt báo nghỉ trễ',
      body: `Khoản phạt ${workflowPolicy.leaveLatePenalty.toLocaleString('vi-VN')}đ đã được ghi nhận.`,
    })
  }

  return { id: leaveRef.id, penalty: isLate && workflowPolicy.leaveLatePenalty > 0 ? workflowPolicy.leaveLatePenalty : 0 }
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
  const scheduleRef = adminDb.collection('workSchedules').doc(scheduleId)
  const workflow = workflowRef(actor, id)
  const lateRef = adminDb.collection('lateRequests').doc()
  const penaltyRef = adminDb.collection('penalties').doc(`late-${actor.uid}-${id}`)
  const notificationRef = adminDb.collection('notifications').doc(`late-penalty-${actor.uid}-${id}`)
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
    const start = shiftStart(date, shift)
    const arrival = new Date(`${date.toISOString().slice(0, 10)}T${arrivalTime}:00+07:00`)
    const lateMinutes = Math.ceil((arrival.getTime() - start.getTime()) / 60_000)
    if (lateMinutes < 1 || lateMinutes > 720) throw new ApiError(400, 'Giờ dự kiến phải sau giờ bắt đầu ca.')
    const noticeMinutes = (start.getTime() - Date.now()) / 60_000
    const isLateNotice = noticeMinutes < workflowPolicy.lateNoticeMinutes
    computedPenalty = isLateNotice ? workflowPolicy.lateNoticePenalty : 0
    const now = FieldValue.serverTimestamp()
    transaction.create(lateRef, {
      employeeId: actor.uid,
      workScheduleId: scheduleId,
      date: schedule.date,
      shift,
      lateMinutes,
      expectedArrival: arrivalTime,
      reason,
      status: 'Pending',
      createdAt: now,
      updatedAt: now,
    })
    if (computedPenalty > 0) {
      transaction.create(penaltyRef, penaltyData({
        employeeId: actor.uid,
        title: 'Báo đi trễ dưới 1 giờ trước ca',
        description: 'Báo đi trễ dưới 60 phút trước giờ bắt đầu ca. Khấu trừ 500đ vào tiền công của 1 giờ làm.',
        category: 'Late',
        amount: computedPenalty,
        sourceType: 'lateRequest',
        sourceId: lateRef.id,
      }))
      transaction.create(notificationRef, warningNotification(
        actor.uid,
        'Phát sinh khoản phạt báo đi trễ',
        `Khoản phạt ${computedPenalty.toLocaleString('vi-VN')}đ đã được ghi nhận.`
      ))
    }
    transaction.create(workflow, {
      employeeId: actor.uid,
      action: 'submitLate',
      targetIds: [lateRef.id],
      penaltyId: computedPenalty ? penaltyRef.id : null,
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
    link: '/admin/requests',
    source: 'lateRequests',
    sourceId: lateRef.id,
  })

  if (computedPenalty > 0) {
    await sendPenaltyPush({
      employeeId: actor.uid,
      penaltyId: penaltyRef.id,
      event: 'created',
      title: 'Phát sinh khoản phạt báo đi trễ',
      body: `Khoản phạt ${computedPenalty.toLocaleString('vi-VN')}đ đã được ghi nhận.`,
    })
  }

  return { id: lateRef.id, penalty: computedPenalty }
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
    link: '/admin/requests',
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
      const scheduleId = body.workScheduleId == null ? '' : text(body.workScheduleId, 'Mã ca làm', 128)
      if (scheduleId) {
        const schedule = await transaction.get(adminDb.collection('workSchedules').doc(scheduleId))
        if (!schedule.exists || schedule.get('employeeId') !== actor.uid || schedule.get('status') !== 'Approved') {
          throw new ApiError(403, 'Bạn chỉ được xin nghỉ trên ca đã được duyệt của mình.')
        }
      }
      updates.duration = duration
      updates.leaveDate = Timestamp.fromDate(leaveDate)
      updates.endDate = Timestamp.fromDate(endDate)
      updates.reason = text(body.reason, 'Lý do', 1000)
      updates.workScheduleId = scheduleId || FieldValue.delete()
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
    link: '/admin/requests',
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

  const targetRef = adminDb.collection(config.collection).doc(id)
  const notificationRef = adminDb.collection('notifications').doc(`${config.collection}-${id}-${status}`)
  const dispatchRef = adminDb.collection('pushDispatches').doc(`${config.collection}-${id}-${status}`)
  const managerIds = await activeManagerIds()
  let employeeId = ''

  await adminDb.runTransaction(async (transaction) => {
    const target = await transaction.get(targetRef)
    if (!target.exists) throw new ApiError(404, 'Không tìm thấy yêu cầu.')
    const data = target.data()!
    if (!['Pending', 'Registered'].includes(data.status)) {
      throw new ApiError(409, 'Yêu cầu này đã được xử lý hoặc đang bị khóa.')
    }
    employeeId = data.employeeId
    const now = FieldValue.serverTimestamp()
    const updates: Record<string, unknown> = {
      status,
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
    }
    transaction.set(targetRef, updates, { merge: true })
    transaction.set(notificationRef, {
      employeeId,
      title: config.title,
      message: `${config.label} của bạn ${statusText(status)}.${note ? ` Phản hồi: ${note}` : ''}`,
      type: status === 'Approved' ? 'success' : 'warning',
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
        managerNotification(managerId, 'Yêu cầu đã được xử lý', `${config.label} đã ${status === 'Approved' ? 'được xác nhận' : 'bị từ chối'}.`, 'info', true)
      )
    })
  })

  const push = await sendEmployeePush({
    employeeId,
    dispatchId: dispatchRef.id,
    title: config.title,
    body: `${config.label} của bạn ${statusText(status)}.`,
    link: config.link,
    source: config.collection,
    sourceId: id,
    status,
  })
  return { id, status, push }
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
  const notificationRef = adminDb.collection('notifications').doc(`schedule-batch-${ids[0]}-${status}`)
  const dispatchRef = adminDb.collection('pushDispatches').doc(`schedule-batch-${ids[0]}-${status}`)
  const managerIds = await activeManagerIds()

  await adminDb.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)))
    if (snapshots.some((snapshot) => !snapshot.exists)) {
      throw new ApiError(404, 'Không tìm thấy đầy đủ bảng lịch.')
    }
    const schedules = snapshots.map((snapshot) => snapshot.data()!)
    employeeId = schedules[0].employeeId
    const week = mondayFor((schedules[0].date as Timestamp).toDate()).toISOString()
    const batchKey = schedules[0].batchKey || scheduleBatchKey(employeeId, mondayFor((schedules[0].date as Timestamp).toDate()))
    if (schedules.some((schedule) =>
      schedule.employeeId !== employeeId ||
      mondayFor((schedule.date as Timestamp).toDate()).toISOString() !== week ||
      !['Pending', 'Registered'].includes(schedule.status)
    )) {
      throw new ApiError(409, 'Bảng lịch không đồng nhất hoặc đã được xử lý.')
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
      title: status === 'Approved' ? 'Lịch làm đã được xác nhận' : 'Lịch làm đã bị từ chối',
      message: status === 'Approved'
        ? `Toàn bộ ${ids.length} ca trong bảng tuần của bạn đã được quản lý xác nhận.`
        : `Bảng lịch tuần của bạn đã bị từ chối. Phản hồi: ${note}`,
      type: status === 'Approved' ? 'success' : 'warning',
      isRead: false,
      createdAt: now,
    })
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
        managerNotification(managerId, 'Bảng lịch đã được xử lý', `Bảng lịch đã ${status === 'Approved' ? 'được xác nhận' : 'bị từ chối'}.`, 'info', true)
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
      data: {
        title: params.title,
        body: params.body,
        link: params.link,
        source: params.source,
        sourceId: params.sourceId,
        status: params.status,
      },
      webpush: { fcmOptions: { link: params.link } },
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
