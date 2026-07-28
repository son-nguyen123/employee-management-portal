import 'server-only'

import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb, adminMessaging } from '@/lib/server/firebase-admin'
import { ApiError, type RequestActor, requireManager, requireStaff } from '@/lib/server/api-auth'
import { workflowPolicy } from '@/lib/server/workflow-policy'

type Shift = 'Morning' | 'Afternoon' | 'Evening'
type ReviewStatus = 'Approved' | 'Rejected' | 'ChangesRequested'
type RequestReviewStatus = Exclude<ReviewStatus, 'ChangesRequested'>

const shifts: Shift[] = ['Morning', 'Afternoon', 'Evening']
const shiftStartHour: Record<Shift, number> = {
  Morning: 6,
  Afternoon: 14,
  Evening: 22,
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
        createdAt: now,
        updatedAt: now,
        lockedAt: null,
      })
    })

    if (isLate && workflowPolicy.scheduleLatePenalty > 0) {
      transaction.create(penaltyRef, penaltyData({
        employeeId: actor.uid,
        title: 'Đăng ký lịch trễ hạn',
        description: `Lịch được gửi sau hạn Chủ nhật ${workflowPolicy.scheduleDeadlineHour}:00.`,
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

    transaction.create(workflow, {
      employeeId: actor.uid,
      action: 'submitSchedules',
      targetIds: scheduleRefs.map((ref) => ref.id),
      penaltyId: isLate ? penaltyRef.id : null,
      createdAt: now,
    })
  })

  return {
    ids: scheduleRefs.map((ref) => ref.id),
    penalty: isLate ? workflowPolicy.scheduleLatePenalty : 0,
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
      !['Pending', 'Registered', 'ChangesRequested', 'Rejected'].includes(schedule.status)
    )) {
      throw new ApiError(403, 'Bạn không thể điều chỉnh lịch này.')
    }

    const oldWeeks = new Set(oldData.map((schedule) =>
      mondayFor((schedule.date as Timestamp).toDate()).toISOString()
    ))
    const newWeeks = new Set(schedules.map((schedule) => mondayFor(schedule.date).toISOString()))
    if (oldWeeks.size !== 1 || newWeeks.size !== 1 || [...oldWeeks][0] !== [...newWeeks][0]) {
      throw new ApiError(400, 'Bản điều chỉnh phải thuộc cùng tuần với lịch đã gửi.')
    }

    const now = FieldValue.serverTimestamp()
    oldRefs.forEach((ref) => transaction.delete(ref))
    schedules.forEach((schedule, index) => {
      transaction.create(newRefs[index], {
        employeeId: actor.uid,
        date: Timestamp.fromDate(schedule.date),
        shift: schedule.shift,
        status: 'Pending',
        note: schedule.note,
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
  })

  return { ids: newRefs.map((ref) => ref.id), penalty: 0 }
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

  await adminDb.runTransaction(async (transaction) => {
    if ((await transaction.get(workflow)).exists) throw new ApiError(409, 'Yêu cầu nghỉ này đã được gửi.')
    const now = FieldValue.serverTimestamp()
    transaction.create(leaveRef, {
      employeeId: actor.uid,
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
      penaltyId: isLate ? penaltyRef.id : null,
      createdAt: now,
    })
  })

  return { id: leaveRef.id, penalty: isLate ? workflowPolicy.leaveLatePenalty : 0 }
}

function shiftStart(date: Date, shift: Shift): Date {
  const day = date.toISOString().slice(0, 10)
  return new Date(`${day}T${String(shiftStartHour[shift]).padStart(2, '0')}:00:00+07:00`)
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
    const [hour, minute] = arrivalTime.split(':').map(Number)
    let arrival = new Date(`${date.toISOString().slice(0, 10)}T${arrivalTime}:00+07:00`)
    if (shift === 'Evening' && hour < 12) arrival = new Date(arrival.getTime() + 24 * 60 * 60 * 1000)
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
        description: 'Thông báo đi trễ được gửi dưới 60 phút trước giờ bắt đầu ca.',
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
  })

  return { id: lateRef.id, penalty: computedPenalty }
}

export async function submitSalaryAdvance(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  const body = objectBody(raw)
  const id = requestId(body)
  const amount = numberValue(body.amount, 'Số tiền', 1, 1_000_000_000)
  const reason = text(body.reason, 'Lý do', 1000)
  const workflow = workflowRef(actor, id)
  const advanceRef = adminDb.collection('salaryAdvances').doc()

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
  })

  return { id: advanceRef.id }
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

  await adminDb.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)))
    if (snapshots.some((snapshot) => !snapshot.exists)) {
      throw new ApiError(404, 'Không tìm thấy đầy đủ bảng lịch.')
    }
    const schedules = snapshots.map((snapshot) => snapshot.data()!)
    employeeId = schedules[0].employeeId
    const week = mondayFor((schedules[0].date as Timestamp).toDate()).toISOString()
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
