import 'server-only'

import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminAuth, adminDb, adminMessaging } from '@/lib/server/firebase-admin'
import { ApiError, type RequestActor, requireManager, requireStaff } from '@/lib/server/api-auth'
import { workflowPolicy } from '@/lib/server/workflow-policy'
import { auditReceiptCapability } from '@/lib/server/audit-trail'
import { cancelQueuedAuditEmails } from '@/lib/server/audit-email'
import { deleteAllProfileImages } from '@/lib/server/google-drive-archive'
import { defaultUserFeatureSettings, userFeatureKeys, type UserFeatureKey, type UserFeatureSettings } from '@/lib/models/userFeatureSettings'
import { vietnamWeekContaining } from '@/lib/archive/retention'
import { isPastRegistrationDate, reactivationWaiverApplies, restrictPastRegistration } from '@/lib/schedule/registration-policy'

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
  const normalized = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d[\d\s,.]*$/.test(value.trim())
      ? Number(value.replace(/[\s,.]/g, ''))
      : Number.NaN
  if (!Number.isFinite(normalized) || !Number.isSafeInteger(normalized) || normalized < min || normalized > max) {
    throw new ApiError(400, `${field} không hợp lệ.`)
  }
  return normalized
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

function calendarDateKey(value: unknown, field: string): string {
  const result = text(value, field, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(new Date(`${result}T12:00:00+07:00`).getTime())) {
    throw new ApiError(400, `${field} khÃ´ng há»£p lá»‡.`)
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

/**
 * Staff only receive per-day totals so the duty picker can warn about an
 * overloaded team without exposing co-workers' schedules or identities.
 */
export async function getDutyAvailability(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  const body = objectBody(raw)
  const startDate = calendarDateKey(body.startDate, 'NgÃ y báº¯t Ä‘áº§u')
  const endDate = calendarDateKey(body.endDate, 'NgÃ y káº¿t thÃºc')
  const start = new Date(`${startDate}T00:00:00+07:00`)
  const end = new Date(`${endDate}T23:59:59.999+07:00`)
  if (end < start || end.getTime() - start.getTime() > 14 * 24 * 60 * 60 * 1000) {
    throw new ApiError(400, 'Khoáº£ng xem tá»• trá»±c khÃ´ng há»£p lá»‡.')
  }

  const snapshot = await adminDb.collection('workSchedules')
    .where('date', '>=', Timestamp.fromDate(start))
    .where('date', '<=', Timestamp.fromDate(end))
    .get()
  const membersByDay = new Map<string, Set<string>>()

  snapshot.docs.forEach((document) => {
    const schedule = document.data()
    if (['Draft', 'Rejected', 'Cancelled'].includes(String(schedule.status))) return
    if (String(schedule.note || '').includes('[NO_SHIFTS]') || !String(schedule.note || '').includes('[DUTY')) return
    const date = schedule.date instanceof Timestamp ? schedule.date.toDate() : null
    const employeeId = typeof schedule.employeeId === 'string' ? schedule.employeeId : ''
    if (!date || !employeeId) return
    const key = vietnamDateKey(date)
    const members = membersByDay.get(key) || new Set<string>()
    members.add(employeeId)
    membersByDay.set(key, members)
  })

  return {
    capacity: 7,
    counts: Object.fromEntries([...membersByDay.entries()].map(([key, members]) => [key, members.size])),
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
  const snapshot = await adminDb.collection('employees').get()
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

function timestampIso(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null
}

/**
 * Returns only notification registrations owned by the authenticated user.
 * The full FID is never returned by this endpoint.
 */
export async function getPushDiagnostics(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  const body = objectBody(raw)
  const currentFid = text(body.fid, 'Thiết bị', 256)
  const [devices, dispatches] = await Promise.all([
    adminDb.collection('employees').doc(actor.uid).collection('notificationDevices').limit(50).get(),
    adminDb.collection('pushDispatches').where('employeeId', '==', actor.uid).limit(100).get(),
  ])
  const currentDevice = devices.docs.find((item) => item.id === currentFid)
  const recentDispatches = dispatches.docs
    .map((item) => ({
      id: item.id,
      state: String(item.get('state') || 'unknown'),
      successCount: Number(item.get('successCount') || 0),
      failureCount: Number(item.get('failureCount') || 0),
      error: typeof item.get('error') === 'string' ? String(item.get('error')).slice(0, 300) : '',
      updatedAt: timestampIso(item.get('updatedAt')),
      isTest: item.get('source') === 'notificationTest',
    }))
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
    .slice(0, 10)

  return {
    currentDeviceRegistered: !!currentDevice,
    registeredDeviceCount: devices.size,
    currentDevice: currentDevice ? {
      permission: String(currentDevice.get('permission') || ''),
      platform: String(currentDevice.get('platform') || '').slice(0, 300),
      createdAt: timestampIso(currentDevice.get('createdAt')),
      updatedAt: timestampIso(currentDevice.get('updatedAt')),
      lastSeenAt: timestampIso(currentDevice.get('lastSeenAt')),
    } : null,
    recentDispatches,
  }
}

/**
 * Sends an isolated push to the current app installation. It intentionally
 * waits briefly so the user can lock the iPhone and verify background delivery.
 */
export async function sendTestPush(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  const body = objectBody(raw)
  const fid = text(body.fid, 'Thiết bị', 256)
  const operationId = requestId(body)
  const deviceRef = adminDb.collection('employees').doc(actor.uid)
    .collection('notificationDevices').doc(fid)
  const device = await deviceRef.get()
  if (!device.exists || device.get('employeeId') !== actor.uid || device.get('permission') !== 'granted') {
    throw new ApiError(409, 'iPhone này chưa có đăng ký Push hợp lệ. Hãy bấm “Sửa đăng ký” trước.')
  }

  const dispatchId = `push-test-${actor.uid}-${operationId}`
  const dispatchRef = adminDb.collection('pushDispatches').doc(dispatchId)
  const existing = await dispatchRef.get()
  if (existing.exists && ['sent', 'partial', 'failed', 'no-devices'].includes(String(existing.get('state')))) {
    return {
      state: String(existing.get('state')),
      successCount: Number(existing.get('successCount') || 0),
      failureCount: Number(existing.get('failureCount') || 0),
      reused: true,
    }
  }

  await dispatchRef.set({
    source: 'notificationTest',
    sourceId: operationId,
    employeeId: actor.uid,
    status: 'test',
    state: 'queued',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  await new Promise((resolve) => setTimeout(resolve, 2000))
  return sendEmployeePush({
    employeeId: actor.uid,
    dispatchId,
    title: 'Kiểm tra thông báo Trí Candy',
    body: 'Nếu bạn thấy tin này trên màn hình khóa, kết nối iPhone và FCM đang hoạt động tốt.',
    link: '/profile',
    source: 'notificationTest',
    sourceId: operationId,
    status: 'test',
    targetFids: [fid],
  })
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
  if (!['admin', 'director'].includes(actor.role)) throw new ApiError(403, 'Chỉ admin hoặc giám đốc được duyệt tài khoản.')
  const body = objectBody(raw)
  const employeeId = text(body.employeeId, 'Nhân viên', 128)
  const status = text(body.status, 'Trạng thái', 20) as 'active' | 'inactive'
  if (!['active', 'inactive'].includes(status)) throw new ApiError(400, 'Trạng thái tài khoản không hợp lệ.')
  if (employeeId === actor.uid && status === 'inactive') throw new ApiError(409, 'Bạn không thể tự khóa tài khoản admin đang dùng.')
  const employeeRef = adminDb.collection('employees').doc(employeeId)
  let releasedSchedules = 0
  await adminDb.runTransaction(async (transaction) => {
    const employee = await transaction.get(employeeRef)
    if (!employee.exists) throw new ApiError(404, 'Không tìm thấy nhân viên.')
    if (actor.role !== 'director' && String(employee.get('factoryId') || 'factory-1') !== actor.factoryId) {
      throw new ApiError(403, 'Bạn chỉ được xử lý nhân viên thuộc xưởng của mình.')
    }
    if (employee.get('role') !== 'employee') throw new ApiError(409, 'Chỉ có thể đổi trạng thái tài khoản nhân viên.')
    const now = FieldValue.serverTimestamp()
    const currentMonday = vietnamWeekContaining(new Date()).start
    const statusChangedAt = employee.get('statusChangedAt')
    const gracePeriodExpired = status === 'active' && employee.get('status') === 'inactive' &&
      statusChangedAt instanceof Timestamp && statusChangedAt.toDate() < currentMonday
    const expiredSchedules = gracePeriodExpired
      ? await transaction.get(adminDb.collection('workSchedules')
          .where('employeeId', '==', employeeId)
          .where('date', '>=', Timestamp.fromDate(currentMonday)))
      : null
    const schedulesToRelease = expiredSchedules?.docs.filter((schedule) =>
      ['Registered', 'Draft', 'Pending', 'Editing', 'ChangesRequested', 'Approved'].includes(String(schedule.get('status')))
    ) || []
    releasedSchedules = schedulesToRelease.length
    const isReactivation = status === 'active' && employee.get('status') === 'inactive'
    const reactivationFields = isReactivation
      ? {
          reactivatedAt: now,
          reactivationScheduleWaiverWeekStart: vietnamWeekStartKey(new Date()),
        }
      : status === 'inactive'
        ? { reactivationScheduleWaiverWeekStart: FieldValue.delete() }
        : {}
    const firstSelectionFields = status === 'active' && !employee.get('scheduleModeInitialSelectionDeadlineAt') && !employee.get('scheduleModeInitialSelectionCompletedAt')
      ? { scheduleModeInitialSelectionDeadlineAt: Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)) }
      : {}
    transaction.set(employeeRef, { status, statusChangedBy: actor.uid, statusChangedAt: now, updatedAt: now, ...firstSelectionFields, ...reactivationFields }, { merge: true })
    schedulesToRelease.forEach((schedule) => transaction.set(schedule.ref, {
      status: 'Cancelled',
      lockedAt: null,
      statusBeforeDeactivation: schedule.get('status'),
      cancelledBy: 'system-inactive-account-expiry',
      cancelledAt: now,
      cancellationReason: 'Tài khoản đã qua hạn khôi phục lịch 00:00 Thứ Hai.',
      updatedAt: now,
    }, { merge: true }))
    transaction.set(adminDb.collection('notifications').doc(`account-status-${employeeId}`), {
      employeeId,
      title: status === 'active' ? 'Tài khoản đã được chấp nhận' : 'Tài khoản đã bị vô hiệu hóa',
      message: status === 'active'
        ? 'Quản lý đã duyệt hồ sơ. Bạn có thể sử dụng đầy đủ các tính năng.'
        : 'Tài khoản và dữ liệu vận hành đã được tạm ẩn. Liên hệ quản lý nếu bạn muốn quay lại làm việc.',
      type: status === 'active' ? 'success' : 'warning',
      isRead: false,
      createdAt: now,
    })
  })
  let deletedProfileImages = 0
  let profileCleanupPending = false
  if (status === 'inactive') {
    await adminAuth.revokeRefreshTokens(employeeId)
    await adminAuth.updateUser(employeeId, { photoURL: null }).catch(() => undefined)
    const devices = await employeeRef.collection('notificationDevices').limit(500).get()
    if (!devices.empty) {
      const batch = adminDb.batch()
      devices.docs.forEach((device) => batch.delete(device.ref))
      await batch.commit()
    }
    await employeeRef.set({
      photoURL: FieldValue.delete(),
      profileImageCleanupPending: true,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    try {
      deletedProfileImages = await deleteAllProfileImages(employeeId)
      await employeeRef.set({
        profileImageCleanupPending: FieldValue.delete(),
        profileImageCleanedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    } catch (error) {
      profileCleanupPending = true
      console.error(`Profile image cleanup failed for ${employeeId}:`, error)
    }
  }
  return { employeeId, status, releasedSchedules, deletedProfileImages, profileCleanupPending }
}

function hasCompleteBankAccount(data: Record<string, unknown> | undefined): boolean {
  return Boolean(
    typeof data?.bankName === 'string' && data.bankName.trim() &&
    typeof data?.bankAccountName === 'string' && data.bankAccountName.trim() &&
    typeof data?.bankAccountNumber === 'string' && /^\d{6,24}$/.test(data.bankAccountNumber.replace(/\s/g, '')),
  )
}

export async function manageEmployeeRole(actor: RequestActor, raw: unknown) {
  requireManager(actor)
  if (!['admin', 'director'].includes(actor.role)) throw new ApiError(403, 'Chỉ admin hoặc giám đốc được phân quyền tài khoản.')
  const body = objectBody(raw)
  const employeeId = text(body.employeeId, 'Nhân viên', 128)
  const role = text(body.role, 'Vai trò', 20) as 'employee' | 'manager' | 'director' | 'admin'
  if (!['employee', 'manager', 'director', 'admin'].includes(role)) {
    throw new ApiError(400, 'Vai trò tài khoản không hợp lệ.')
  }
  if (employeeId === actor.uid) throw new ApiError(409, 'Không thể thay đổi vai trò của admin đang đăng nhập.')

  const employeeRef = adminDb.collection('employees').doc(employeeId)
  await adminDb.runTransaction(async (transaction) => {
    const employee = await transaction.get(employeeRef)
    if (!employee.exists) throw new ApiError(404, 'Không tìm thấy nhân viên.')
    if (actor.role !== 'director' && String(employee.get('factoryId') || 'factory-1') !== actor.factoryId) {
      throw new ApiError(403, 'Bạn chỉ được phân quyền nhân viên thuộc xưởng mình.')
    }
    if (employee.get('role') === 'admin') throw new ApiError(409, 'Không thể thay đổi vai trò admin bằng luồng này.')
    transaction.set(employeeRef, {
      role,
      updatedAt: FieldValue.serverTimestamp(),
      roleChangedBy: actor.uid,
      roleChangedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  })

  return { employeeId, role }
}

export async function getAccountRegistrationWindow(actor: RequestActor) {
  requireManager(actor)
  const snapshot = await adminDb.collection('managementSettings').doc('accountRegistration').get()
  const closesAt = snapshot.get('closesAt')
  const closesAtDate = closesAt instanceof Timestamp ? closesAt.toDate() : null
  return {
    isOpen: snapshot.get('isOpen') === true && !!closesAtDate && closesAtDate.getTime() > Date.now(),
    closesAt: closesAtDate?.toISOString() || null,
  }
}

export async function updateAccountRegistrationWindow(actor: RequestActor, raw: unknown) {
  requireManager(actor)
  if (actor.role !== 'admin') throw new ApiError(403, 'Chỉ admin được mở cổng đăng ký tài khoản.')
  const body = objectBody(raw)
  if (typeof body.open !== 'boolean') throw new ApiError(400, 'Trạng thái mở đăng ký không hợp lệ.')
  const now = new Date()
  const closesAt = body.open ? new Date(now.getTime() + 60 * 60 * 1000) : now
  await adminDb.collection('managementSettings').doc('accountRegistration').set({
    isOpen: body.open,
    openedAt: body.open ? Timestamp.fromDate(now) : null,
    closesAt: Timestamp.fromDate(closesAt),
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return { isOpen: body.open, closesAt: closesAt.toISOString() }
}

function readUserFeatureSettings(data: FirebaseFirestore.DocumentData | undefined): UserFeatureSettings {
  const raw = data?.enabled
  return userFeatureKeys.reduce((settings, key) => {
    settings[key] = raw && typeof raw[key] === 'boolean' ? raw[key] : defaultUserFeatureSettings[key]
    return settings
  }, { ...defaultUserFeatureSettings })
}

export async function getUserFeatureSettings(actor: RequestActor) {
  requireStaff(actor)
  const snapshot = await adminDb.collection('managementSettings').doc('userFeatures').get()
  return readUserFeatureSettings(snapshot.data())
}

export async function updateUserFeatureSetting(actor: RequestActor, raw: unknown) {
  requireManager(actor)
  if (actor.role !== 'admin') throw new ApiError(403, 'Chá»‰ admin Ä‘Æ°á»£c thay Ä‘á»•i tÃ­nh nÄƒng user.')
  const body = objectBody(raw)
  const key = text(body.key, 'TÃ­nh nÄƒng', 40) as UserFeatureKey
  if (!userFeatureKeys.includes(key)) throw new ApiError(400, 'TÃ­nh nÄƒng khÃ´ng há»£p lá»‡.')
  if (typeof body.enabled !== 'boolean') throw new ApiError(400, 'Tráº¡ng thÃ¡i tÃ­nh nÄƒng khÃ´ng há»£p lá»‡.')

  const ref = adminDb.collection('managementSettings').doc('userFeatures')
  const snapshot = await ref.get()
  const enabled = readUserFeatureSettings(snapshot.data())
  enabled[key] = body.enabled
  await ref.set({
    enabled,
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return enabled
}

export async function respondPenaltyConsent(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  const body = objectBody(raw)
  const id = text(body.id, 'Mã yêu cầu nghỉ', 128)
  if (typeof body.accepted !== 'boolean') throw new ApiError(400, 'Lựa chọn xác nhận không hợp lệ.')
  const accepted = body.accepted
  const leaveRef = adminDb.collection('leaveRequests').doc(id)
  const penaltyRef = adminDb.collection('penalties').doc(`leave-decision-${id}`)
  const managerIds = await activeManagerIds(actor.factoryId)
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
            transaction.set(snapshot.ref, { status: 'Cancelled', cancellationReason: `Tự động hủy do nghỉ dài hạn được duyệt (${id}).`, cancelledByLeaveRequestId: id, cancelledBy: actor.uid, cancelledAt: now, lockedAt: null, updatedAt: now }, { merge: true })
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
  factoryId?: string
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

async function activeManagerIds(factoryId?: string): Promise<string[]> {
  const snapshot = await adminDb.collection('employees').get()
  return snapshot.docs
    .filter((item) => ['admin', 'manager'].includes(String(item.get('role'))) && (
      !factoryId || String(item.get('factoryId') || 'factory-1') === factoryId
    ))
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

function vietnamWeekdayNumber(date: Date): number {
  const weekdayName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    weekday: 'short',
  }).format(date)
  return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[weekdayName] || 1
}

function scheduleDeadline(firstShift: Date): Date {
  const monday = mondayFor(firstShift)
  // Nhân viên được tạo và sửa tự do hết Thứ Bảy. Từ 00:00 Chủ Nhật mới tính là trễ.
  return new Date(
    Date.UTC(
      monday.getUTCFullYear(),
      monday.getUTCMonth(),
      monday.getUTCDate() - 1,
      -7,
      0,
      0
    )
  )
}

function scheduleEditDeadline(firstShift: Date, firstSubmittedAt: Date): Date {
  const registrationDeadline = scheduleDeadline(firstShift)
  if (firstSubmittedAt.getTime() < registrationDeadline.getTime()) {
    return new Date(registrationDeadline.getTime() + 24 * 60 * 60 * 1000)
  }

  const submittedDateKey = vietnamDateKey(firstSubmittedAt)
  const submittedMidnight = new Date(`${submittedDateKey}T00:00:00+07:00`)
  return new Date(submittedMidnight.getTime() + 24 * 60 * 60 * 1000)
}

function vietnamWeekStartKey(date: Date, weeksFromCurrent = 0): string {
  const dateKey = vietnamDateKey(date)
  const base = new Date(`${dateKey}T12:00:00+07:00`)
  const weekday = vietnamWeekdayNumber(base)
  base.setUTCDate(base.getUTCDate() - (weekday - 1) + weeksFromCurrent * 7)
  return vietnamDateKey(base)
}

function employeeScheduleMode(data: Record<string, unknown>): 'rotating' | 'fixed' {
  return data.scheduleMode === 'fixed' ? 'fixed' : 'rotating'
}

function firestoreDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (value instanceof Timestamp) return value.toDate()
  return null
}

function parseScheduleMode(value: unknown): 'rotating' | 'fixed' | null {
  return value === 'fixed' || value === 'rotating' ? value : null
}

export async function setInitialScheduleMode(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  const body = objectBody(raw)
  const mode = parseScheduleMode(body.mode)
  if (!mode) throw new ApiError(400, 'Chế độ lịch làm không hợp lệ.')

  const employeeRef = adminDb.collection('employees').doc(actor.uid)
  const snapshot = await employeeRef.get()
  if (!snapshot.exists) throw new ApiError(404, 'Chưa tìm thấy hồ sơ nhân viên.')
  const deadline = firestoreDate(snapshot.get('scheduleModeInitialSelectionDeadlineAt'))
  if (!deadline || new Date() >= deadline) {
    throw new ApiError(409, 'Thời gian thiết lập chế độ ban đầu đã hết. Vui lòng gửi yêu cầu cho quản lý.')
  }
  await employeeRef.set({
    scheduleMode: mode,
    scheduleModeInitialSelectionCompletedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return { mode }
}

export async function submitScheduleModeChangeRequest(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  const body = objectBody(raw)
  const requestKey = requestId(body)
  const requestedMode = parseScheduleMode(body.mode)
  if (!requestedMode) throw new ApiError(400, 'Chế độ lịch làm không hợp lệ.')
  const reason = text(body.reason, 'Lý do chuyển chế độ', 300)
  const employeeRef = adminDb.collection('employees').doc(actor.uid)
  const employeeSnapshot = await employeeRef.get()
  if (!employeeSnapshot.exists) throw new ApiError(404, 'Chưa tìm thấy hồ sơ nhân viên.')
  const employeeData = employeeSnapshot.data() as Record<string, unknown>
  const currentMode = employeeScheduleMode(employeeData)
  if (currentMode === requestedMode) throw new ApiError(409, 'Bạn đang sử dụng chế độ này rồi.')
  const initialDeadline = firestoreDate(employeeData.scheduleModeInitialSelectionDeadlineAt)
  if (initialDeadline && new Date() < initialDeadline) {
    throw new ApiError(409, 'Bạn vẫn đang trong thời gian thiết lập ban đầu. Hãy chọn trực tiếp trong hồ sơ.')
  }
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short' }).format(new Date())
  if (weekday !== 'Sat') throw new ApiError(409, 'Yêu cầu đổi chế độ chỉ mở vào Thứ Bảy.')
  const cooldownUntil = firestoreDate(employeeData.scheduleModeChangeCooldownUntil)
  if (cooldownUntil && cooldownUntil.getTime() > Date.now()) {
    throw new ApiError(409, `Bạn chỉ có thể đổi lại sau ${cooldownUntil.toLocaleDateString('vi-VN')}.`)
  }
  const existingRequests = await adminDb.collection('staffRequests').where('employeeId', '==', actor.uid).get()
  if (existingRequests.docs.some((item) => item.get('type') === 'scheduleModeChange' && item.get('status') === 'Pending')) {
    throw new ApiError(409, 'Bạn đã có một yêu cầu đổi chế độ đang chờ quản lý xử lý.')
  }

  const effectiveWeekStart = vietnamWeekStartKey(new Date(), 1)
  const targetStart = new Date(`${effectiveWeekStart}T00:00:00+07:00`)
  const requestRef = adminDb.collection('staffRequests').doc()
  const workflow = workflowRef(actor, requestKey)
  const managerIds = await activeManagerIds(actor.factoryId)
  await adminDb.runTransaction(async (transaction) => {
    if ((await transaction.get(workflow)).exists) throw new ApiError(409, 'Yêu cầu này đã được gửi trước đó.')
    const now = FieldValue.serverTimestamp()
    transaction.create(requestRef, {
      employeeId: actor.uid,
      factoryId: actor.factoryId,
      type: 'scheduleModeChange',
      content: reason,
      previousScheduleMode: currentMode,
      requestedScheduleMode: requestedMode,
      weekStart: Timestamp.fromDate(targetStart),
      status: 'Pending',
      createdAt: now,
      updatedAt: now,
    })
    transaction.create(
      adminDb.collection('notifications').doc(`staff-request-status-${requestRef.id}`),
      warningNotification(actor.uid, 'Đã gửi yêu cầu đổi chế độ', 'Yêu cầu đã gửi đến quản lý và đang chờ xử lý.')
    )
    managerIds.forEach((managerId) => transaction.set(
      managerNotificationRef(managerId, `staff-${requestRef.id}`),
      managerNotification(managerId, 'Yêu cầu đổi chế độ làm việc', 'Một nhân viên vừa gửi yêu cầu chuyển giữa xoay ca và cố định.', 'warning', false)
    ))
    transaction.create(workflow, {
      employeeId: actor.uid,
      action: 'submitScheduleModeChangeRequest',
      targetIds: [requestRef.id],
      createdAt: now,
    })
  })
  await sendManagerPushes({
    managerIds,
    sourceKey: `staff-${requestRef.id}`,
    title: 'Yêu cầu đổi chế độ làm việc',
    body: 'Một nhân viên vừa gửi yêu cầu chuyển giữa xoay ca và cố định.',
    link: '/notifications',
    source: 'staffRequests',
    sourceId: requestRef.id,
  })
  return { id: requestRef.id, requestedMode, effectiveWeekStart }
}

export async function ensureFixedSchedule(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  const body = objectBody(raw)
  const targetWeekStart = weekKey(body.weekStart)
  const employeeId = typeof body.employeeId === 'string' ? text(body.employeeId, 'Nhân viên', 128) : actor.uid
  if (employeeId !== actor.uid && !['admin', 'manager'].includes(actor.role)) {
    throw new ApiError(403, 'Chỉ quản lý mới có thể đồng bộ lịch cố định của nhân viên khác.')
  }
  const employeeRef = adminDb.collection('employees').doc(employeeId)
  const employeeSnapshot = await employeeRef.get()
  if (!employeeSnapshot.exists) throw new ApiError(404, 'Chưa tìm thấy hồ sơ nhân viên.')
  const employeeData = employeeSnapshot.data() as Record<string, unknown>
  const employeeFactoryId = String(employeeData.factoryId || 'factory-1')
  if (employeeId !== actor.uid && employeeFactoryId !== actor.factoryId) {
    throw new ApiError(403, 'Bạn chỉ được đồng bộ lịch của nhân viên thuộc xưởng mình.')
  }
  if (employeeScheduleMode(employeeData) !== 'fixed') return { created: false, ids: [], needsSetup: false }

  const effectiveWeekStart = String(employeeData.scheduleModeEffectiveWeekStart || '')
  if (effectiveWeekStart && targetWeekStart < effectiveWeekStart) return { created: false, ids: [], needsSetup: false }
  const needsSetupWeekStart = String(employeeData.fixedScheduleNeedsSetupWeekStart || '')
  if (needsSetupWeekStart && targetWeekStart >= needsSetupWeekStart) return { created: false, ids: [], needsSetup: true }

  const targetStart = new Date(`${targetWeekStart}T00:00:00+07:00`)
  const targetEnd = new Date(targetStart.getTime() + 7 * 24 * 60 * 60 * 1000)
  const existingSnapshot = await adminDb.collection('workSchedules')
    .where('employeeId', '==', employeeId)
    .where('date', '>=', Timestamp.fromDate(targetStart))
    .where('date', '<', Timestamp.fromDate(targetEnd))
    .get()
  if (existingSnapshot.docs.some((snapshot) => snapshot.get('status') !== 'Cancelled')) {
    return { created: false, ids: [], needsSetup: false }
  }

  const allSchedules = await adminDb.collection('workSchedules').where('employeeId', '==', employeeId).get()
  const candidates = allSchedules.docs.filter((snapshot) => {
    const data = snapshot.data()
    if (['Cancelled', 'Rejected', 'Draft'].includes(String(data.status))) return false
    if (data.fixedSchedule === true) return true
    return !employeeData.scheduleModeEffectiveWeekStart && data.status === 'Approved'
  })
  if (!candidates.length) return { created: false, ids: [], needsSetup: false }

  const grouped = new Map<string, Array<{ data: Record<string, unknown>; date: Date }>>()
  candidates.forEach((snapshot) => {
    const data = snapshot.data() as Record<string, unknown>
    const date = firestoreDate(data.date)
    if (!date) return
    const week = vietnamWeekStartKey(date)
    if (week >= targetWeekStart) return
    grouped.set(week, [...(grouped.get(week) || []), { data, date }])
  })
  const sourceWeekStart = [...grouped.keys()].sort().at(-1)
  const sourceRows = sourceWeekStart ? grouped.get(sourceWeekStart) || [] : []
  if (!sourceWeekStart || !sourceRows.length) return { created: false, ids: [], needsSetup: false }

  const managerIds = await activeManagerIds(employeeFactoryId)
  const requestRef = adminDb.collection('workflowRequests').doc(`fixed-schedule-${employeeId}-${targetWeekStart}`)
  const scheduleRefs = sourceRows.map(() => adminDb.collection('workSchedules').doc())
  const targetMonday = new Date(`${targetWeekStart}T12:00:00+07:00`)
  const now = new Date()
  const actualShiftCount = sourceRows.filter(({ data }) => !String(data.note || '').includes('[NO_SHIFTS]') && !String(data.note || '').includes('[DUTY_ONLY]')).length
  let createdNow = false
  await adminDb.runTransaction(async (transaction) => {
    if ((await transaction.get(requestRef)).exists) return
    createdNow = true
    const serverNow = FieldValue.serverTimestamp()
    sourceRows.forEach(({ data, date }, index) => {
      const sourceMidday = new Date(`${vietnamDateKey(date)}T12:00:00+07:00`)
      const offset = Math.round((sourceMidday.getTime() - new Date(`${sourceWeekStart}T12:00:00+07:00`).getTime()) / (24 * 60 * 60 * 1000))
      const targetDate = new Date(targetMonday)
      targetDate.setUTCDate(targetDate.getUTCDate() + offset)
      transaction.create(scheduleRefs[index], {
        employeeId,
        factoryId: employeeFactoryId,
        date: Timestamp.fromDate(targetDate),
        shift: data.shift,
        status: 'Approved',
        note: String(data.note || ''),
        batchKey: scheduleBatchKey(employeeId, mondayFor(targetDate)),
        fixedSchedule: true,
        requiresReapproval: false,
        revisionCount: 0,
        weeklyShiftCount: actualShiftCount,
        underMinimumWarning: actualShiftCount < workflowPolicy.minimumWeeklyShifts,
        autoApproved: true,
        reviewNote: 'Lịch cố định tự động xác nhận từ tuần trước.',
        reviewedBy: 'system:fixed-schedule',
        reviewedAt: serverNow,
        firstSubmittedAt: Timestamp.fromDate(now),
        editDeadlineAt: Timestamp.fromDate(targetMonday),
        createdAt: serverNow,
        updatedAt: serverNow,
        lockedAt: serverNow,
      })
    })
    transaction.create(requestRef, {
      employeeId,
      action: 'ensureFixedSchedule',
      targetIds: scheduleRefs.map((ref) => ref.id),
      weekStart: targetWeekStart,
      createdAt: serverNow,
    })
    transaction.set(employeeRef, { fixedScheduleTemplateWeekStart: targetWeekStart, updatedAt: serverNow }, { merge: true })
    managerIds.forEach((managerId) => transaction.set(
      managerNotificationRef(managerId, `fixed-schedule-${employeeId}-${targetWeekStart}`),
      managerNotification(
        managerId,
        'Lịch cố định đã tự động xác nhận',
        `Lịch tuần ${targetWeekStart} của nhân viên đã được lặp lại từ lịch cố định.`,
        actualShiftCount < workflowPolicy.minimumWeeklyShifts ? 'warning' : 'info'
      )
    ))
  })
  if (!createdNow) return { created: false, ids: [], needsSetup: false }
  await sendManagerPushes({
    managerIds,
    sourceKey: `fixed-schedule-${employeeId}-${targetWeekStart}`,
    title: 'Lịch cố định đã tự động xác nhận',
    body: `Lịch tuần ${targetWeekStart} đã được lặp lại từ lịch cố định.`,
    link: '/admin/dashboard',
    source: 'workSchedules',
    sourceId: scheduleRefs[0]?.id || targetWeekStart,
  })
  return { created: true, ids: scheduleRefs.map((ref) => ref.id), needsSetup: false }
}

function leaveNoticeDeadline(firstShift: Date): Date {
  const dateKey = vietnamDateKey(firstShift)
  const deadline = new Date(`${dateKey}T${String(workflowPolicy.leaveNoticeDeadlineHour).padStart(2, '0')}:00:00+07:00`)
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
  const requestTime = new Date()
  const isLate = requestTime.getTime() >= scheduleDeadline(firstDate).getTime()
  const editDeadlineAt = scheduleEditDeadline(firstDate, requestTime)
  const weekStart = mondayFor(firstDate)
  const scheduleWeekStartKey = vietnamWeekStartKey(firstDate)
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
  const batchKey = scheduleBatchKey(actor.uid, weekStart)
  const [managerIds, existingSchedules, employeeSnapshot] = await Promise.all([
    activeManagerIds(actor.factoryId),
    adminDb.collection('workSchedules').where('employeeId', '==', actor.uid).get(),
    adminDb.collection('employees').doc(actor.uid).get(),
  ])
  const employeeData = employeeSnapshot.data() as Record<string, unknown> | undefined
  const scheduleMode = employeeData ? employeeScheduleMode(employeeData) : 'rotating'
  const effectiveWeekStart = String(employeeData?.scheduleModeEffectiveWeekStart || '')
  const fixedModeActive = scheduleMode === 'fixed' && (!effectiveWeekStart || scheduleWeekStartKey >= effectiveWeekStart)
  // A "new employee" means an employee who has never submitted a schedule.
  // The durable profile marker remains reliable after old schedule rows move
  // to Drive; legacy rows are retained as a fallback during migration.
  const hasPreviousSchedule = employeeData?.hasSubmittedSchedule === true || !existingSchedules.empty
  const firstScheduleException = !hasPreviousSchedule
  const currentWeekStartKey = vietnamWeekStartKey(requestTime)
  const reactivationWaiverActive = reactivationWaiverApplies({
    hasPreviousSchedule,
    waiverWeekStart: employeeData?.reactivationScheduleWaiverWeekStart,
    currentWeekStart: currentWeekStartKey,
    scheduleWeekStart: scheduleWeekStartKey,
  })
  const openWeekStartKey = vietnamWeekdayNumber(requestTime) >= 6
    ? vietnamWeekStartKey(requestTime, 1)
    : vietnamWeekStartKey(requestTime)
  if (!fixedModeActive && !reactivationWaiverActive && scheduleWeekStartKey !== openWeekStartKey) {
    throw new ApiError(409, vietnamWeekdayNumber(requestTime) >= 6
      ? 'Tuần đăng ký mới đã được mở từ Thứ Bảy. Hãy chọn tuần kế tiếp.'
      : 'Từ Thứ Hai đến Thứ Sáu, bạn chỉ được nhập lịch tuần hiện tại. Lịch tuần sau sẽ mở vào Thứ Bảy.')
  }
  if (schedules.some((schedule) => vietnamWeekStartKey(schedule.date) !== scheduleWeekStartKey)) {
    throw new ApiError(400, 'Các ca đăng ký phải thuộc cùng một tuần.')
  }
  const pastDateRestricted = restrictPastRegistration({ fixedModeActive, hasPreviousSchedule, currentWeekStart: currentWeekStartKey, scheduleWeekStart: scheduleWeekStartKey })
  const todayKey = vietnamDateKey(requestTime)
  if (schedules.some((schedule) => isPastRegistrationDate(vietnamDateKey(schedule.date), todayKey, pastDateRestricted))) {
    throw new ApiError(409, 'Bạn chỉ được đăng ký lịch từ hôm nay đến Chủ Nhật. Các ngày trước hôm nay đã khóa.')
  }
  const shouldPenalize = isLate && !hasCoveringLongLeave && !fixedModeActive && hasPreviousSchedule && !reactivationWaiverActive
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
        factoryId: actor.factoryId,
        date: Timestamp.fromDate(schedule.date),
        shift: schedule.shift,
        status: 'Approved',
        note: schedule.note,
        batchKey,
        fixedSchedule: fixedModeActive,
        firstScheduleException,
        pastDateRestricted,
        requiresReapproval: false,
        revisionCount: 0,
        weeklyShiftCount: actualShiftCount,
        underMinimumWarning: underMinimum,
        autoApproved: true,
        reviewNote: fixedModeActive
          ? 'Lịch cố định tự động xác nhận.'
          : underMinimum
            ? `Tự động xác nhận · lịch có ${actualShiftCount}/${workflowPolicy.minimumWeeklyShifts} ca.`
            : `Tự động xác nhận · lịch đạt ${actualShiftCount} ca.`,
        reviewedBy: fixedModeActive ? 'system:fixed-schedule' : 'system:auto-schedule',
        reviewedAt: now,
        penaltyId: shouldPenalize && workflowPolicy.scheduleLatePenalty > 0 ? penaltyRef.id : null,
        penaltyAmount: shouldPenalize ? workflowPolicy.scheduleLatePenalty : 0,
        firstSubmittedAt: Timestamp.fromDate(requestTime),
        editDeadlineAt: Timestamp.fromDate(editDeadlineAt),
        createdAt: now,
        updatedAt: now,
        lockedAt: now,
      })
    })
    if (employeeData && fixedModeActive) {
      transaction.set(adminDb.collection('employees').doc(actor.uid), {
        fixedScheduleTemplateWeekStart: scheduleWeekStartKey,
        ...(String(employeeData.fixedScheduleNeedsSetupWeekStart || '') <= scheduleWeekStartKey
          ? { fixedScheduleNeedsSetupWeekStart: FieldValue.delete() }
          : {}),
        updatedAt: now,
      }, { merge: true })
    }
    transaction.set(adminDb.collection('employees').doc(actor.uid), {
      hasSubmittedSchedule: true,
      updatedAt: now,
    }, { merge: true })

    if (shouldPenalize && workflowPolicy.scheduleLatePenalty > 0) {
      transaction.create(penaltyRef, {
        ...penaltyData({
        employeeId: actor.uid,
        title: 'Đăng ký lịch trễ hạn',
        description: `Gửi lịch sau hạn quy định. Khấu trừ ${workflowPolicy.scheduleLatePenalty.toLocaleString('vi-VN')}đ.`,
        category: 'Late',
        amount: workflowPolicy.scheduleLatePenalty,
        sourceType: 'scheduleSubmission',
        sourceId: id,
        }),
        status: 'Active',
        confirmedBy: 'system:auto-schedule',
        confirmedAt: now,
      })
      transaction.create(notificationRef, warningNotification(
        actor.uid,
        'Phát sinh khoản phạt đăng ký lịch trễ',
        `Khoản phạt ${workflowPolicy.scheduleLatePenalty.toLocaleString('vi-VN')}đ đã được ghi nhận.`
      ))
    }
    transaction.set(adminDb.collection('notifications').doc(`schedule-status-${scheduleRefs[0].id}`), {
      employeeId: actor.uid,
      title: fixedModeActive ? 'Lịch cố định đã tự động xác nhận' : 'Lịch tuần đã tự động xác nhận',
      message: underMinimum
        ? `Lịch của bạn đã lưu với ${actualShiftCount}/${workflowPolicy.minimumWeeklyShifts} ca và được đánh dấu cần lưu ý.`
        : fixedModeActive
          ? `Lịch cố định của bạn đã lưu và sẽ được lặp lại cho các tuần tiếp theo.`
          : `Lịch của bạn đã lưu và đạt ${actualShiftCount} ca trong tuần.`,
      type: underMinimum ? 'warning' : 'success',
      isRead: false,
      createdAt: now,
    })

    managerIds.forEach((managerId) => {
      transaction.set(
        managerNotificationRef(managerId, `schedule-${batchKey}`),
        managerNotification(
          managerId,
          fixedModeActive ? 'Lịch cố định đã tự động duyệt' : underMinimum ? 'Lịch tuần tự duyệt · cần lưu ý' : 'Lịch tuần đã tự động duyệt',
          `Lịch tuần ${weekStart.toLocaleDateString('vi-VN')} vừa được cập nhật: ${actualShiftCount} ca.${underMinimum ? ` Dưới mức ${workflowPolicy.minimumWeeklyShifts} ca.` : ''}`,
          underMinimum ? 'warning' : 'info'
        )
      )
    })

    transaction.create(workflow, {
      employeeId: actor.uid,
      action: 'submitSchedules',
      targetIds: scheduleRefs.map((ref) => ref.id),
      penaltyId: shouldPenalize ? penaltyRef.id : null,
      scheduleMode,
      createdAt: now,
    })
  })

  await sendManagerPushes({
    managerIds,
    sourceKey: `schedule-${batchKey}`,
    title: fixedModeActive ? 'Lịch cố định đã tự động duyệt' : underMinimum ? 'Lịch tuần cần lưu ý' : 'Lịch tuần đã tự động duyệt',
    body: underMinimum
      ? `Một nhân viên vừa cập nhật lịch ${actualShiftCount}/${workflowPolicy.minimumWeeklyShifts} ca.`
      : fixedModeActive
        ? `Một nhân viên lịch cố định vừa cập nhật ${actualShiftCount} ca cho tuần ${scheduleWeekStartKey}.`
        : `Một nhân viên vừa cập nhật lịch ${actualShiftCount} ca.`,
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
    editDeadlineAt: editDeadlineAt.toISOString(),
  }
}

export async function submitStaffRequest(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  const body = objectBody(raw)
  const id = requestId(body)
  const type = text(body.type, 'Loại yêu cầu', 30) as 'overtime' | 'note' | 'scheduleChange'
  if (!['overtime', 'note', 'scheduleChange'].includes(type)) throw new ApiError(400, 'Loại yêu cầu không hợp lệ.')
  const content = text(body.content ?? '', 'Nội dung', 1000, type === 'overtime' || type === 'scheduleChange')
  const managerIds = await activeManagerIds(actor.factoryId)
  const requestRef = adminDb.collection('staffRequests').doc()
  const workflow = workflowRef(actor, id)
  let weekStart: Date | null = null
  let requestedShifts: Array<{ date: Date; shift: Shift }> = []
  let removedShifts: Array<{ scheduleId: string; date: Date; shift: Shift }> = []
  let restoredShifts: Array<{ scheduleId: string; date: Date; shift: Shift }> = []
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
      if (!Array.isArray(body.restoredShifts) || body.restoredShifts.length > 21) {
        throw new ApiError(400, 'Danh sách ca xin đi làm lại không hợp lệ.')
      }
      restoredShifts = body.restoredShifts.map((item, index) => {
        const row = objectBody(item)
        const scheduleId = text(row.scheduleId, `Mã ca đi làm lại ${index + 1}`, 128)
        const date = dateValue(row.date, `Ngày ca đi làm lại ${index + 1}`)
        const shift = row.shift
        if (!shifts.includes(shift as Shift)) throw new ApiError(400, `Ca đi làm lại ${index + 1} không hợp lệ.`)
        return { scheduleId, date, shift: shift as Shift }
      })
      if (!requestedShifts.length && !removedShifts.length && !restoredShifts.length) {
        throw new ApiError(400, 'Vui lòng chọn ít nhất một ca cần đổi, hủy hoặc đăng ký thêm.')
      }
      if (removedShifts.length && !requestedShifts.length && !restoredShifts.length) {
        throw new ApiError(400, 'Khi xin hủy ca cũ, bạn phải chọn ít nhất một ca mới để thay thế.')
      }
      if ([...requestedShifts, ...removedShifts, ...restoredShifts].some((item) =>
        vietnamDateKey(item.date) < vietnamDateKey(new Date())
      )) {
        throw new ApiError(400, 'Không thể đổi hoặc đăng ký thêm cho ngày đã qua.')
      }
      shouldPenalizeSameDayChange = removedShifts.some((item) =>
        vietnamDateKey(item.date) === vietnamDateKey(new Date())
      )
    }
    const firstRequestDate = (requestedShifts[0]?.date || removedShifts[0]?.date || restoredShifts[0]?.date)!
    weekStart = mondayFor(firstRequestDate)
    if ([...requestedShifts, ...removedShifts, ...restoredShifts].some((item) => mondayFor(item.date).getTime() !== weekStart!.getTime())) {
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
    if (restoredShifts.some((restored) => !existing.docs.some((snapshot) => {
      const schedule = snapshot.data()
      const reason = String(schedule.cancellationReason || '')
      return snapshot.id === restored.scheduleId &&
        schedule.status === 'Cancelled' &&
        (Boolean(schedule.cancelledByLeaveRequestId) || /ngh[ỉi]|leave/i.test(reason)) &&
        (schedule.date as Timestamp).toDate().toISOString().slice(0, 10) === restored.date.toISOString().slice(0, 10) &&
        schedule.shift === restored.shift
    }))) {
      throw new ApiError(409, 'Một ca xin đi làm lại không còn là ca nghỉ hợp lệ. Vui lòng tải lại lịch.')
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
      factoryId: actor.factoryId,
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
      ...(restoredShifts.length ? {
        restoredShifts: restoredShifts.map((item) => ({
          scheduleId: item.scheduleId,
          date: Timestamp.fromDate(item.date),
          shift: item.shift,
        })),
      } : {}),
      status: 'Pending',
      createdAt: now,
      updatedAt: now,
    })
    transaction.create(
      adminDb.collection('notifications').doc(`staff-request-status-${requestRef.id}`),
      warningNotification(
        actor.uid,
        type === 'scheduleChange' ? 'Đã gửi yêu cầu đổi ca' : type === 'overtime' ? 'Đã gửi yêu cầu làm thêm' : 'Đã gửi ghi chú',
        'Yêu cầu đã gửi đến quản lý và đang chờ xử lý.'
      )
    )
    if (shouldPenalizeSameDayChange && workflowPolicy.sameDayScheduleChangePenalty > 0) {
      const penaltyRef = adminDb.collection('penalties').doc(`schedule-change-${actor.uid}-${id}`)
      transaction.create(penaltyRef, penaltyData({
        employeeId: actor.uid,
        factoryId: actor.factoryId,
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
          type === 'scheduleChange' ? 'Một nhân viên vừa gửi ca xin hủy, ca xin đi làm lại và ca mới / ca thêm.' : type === 'overtime' ? 'Một nhân viên vừa gửi các ca muốn làm thêm.' : 'Một nhân viên vừa gửi ghi chú cho quản lý.'
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
    body: type === 'scheduleChange' ? 'Một nhân viên vừa gửi ca xin hủy, ca xin đi làm lại và ca mới / ca thêm.' : type === 'overtime' ? 'Một nhân viên vừa gửi các ca muốn làm thêm.' : 'Một nhân viên vừa gửi ghi chú cho quản lý.',
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
  const managerIds = await activeManagerIds(actor.factoryId)
  const requestTime = new Date()
  let resultingEditDeadline = requestTime
  let resultingPenaltyAmount = 0

  await adminDb.runTransaction(async (transaction) => {
    const [workflowSnapshot, employeeSnapshot, ...oldSnapshots] = await Promise.all([
      transaction.get(workflow),
      transaction.get(adminDb.collection('employees').doc(actor.uid)),
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

    const oldWeekStart = mondayFor((oldData[0].date as Timestamp).toDate())
    if (!newWeeks.has(oldWeekStart.toISOString())) {
      throw new ApiError(409, 'Bản điều chỉnh phải giữ nguyên tuần làm việc ban đầu.')
    }
    const retainedFixedSchedule = oldData.some((schedule) => schedule.fixedSchedule === true)
    const retainedFirstScheduleException = oldData.some((schedule) => schedule.firstScheduleException === true)
    const oldWeekStartKey = vietnamWeekStartKey((oldData[0].date as Timestamp).toDate())
    const restrictPastDates = !retainedFixedSchedule && !retainedFirstScheduleException && oldWeekStartKey === vietnamWeekStartKey(requestTime)
    const existingPastShiftKeys = new Set(oldData.map((schedule) =>
      `${vietnamDateKey((schedule.date as Timestamp).toDate())}-${schedule.shift}`
    ))
    if (restrictPastDates && schedules.some((schedule) =>
      vietnamDateKey(schedule.date) < vietnamDateKey(requestTime) &&
      !existingPastShiftKeys.has(`${vietnamDateKey(schedule.date)}-${schedule.shift}`)
    )) {
      throw new ApiError(409, 'Bạn chỉ được đăng ký lịch từ hôm nay đến Chủ Nhật. Các ngày trước hôm nay đã khóa.')
    }

    const firstSubmittedAt = oldData
      .map((schedule) => firestoreDate(schedule.firstSubmittedAt) || firestoreDate(schedule.createdAt))
      .filter((value): value is Date => Boolean(value))
      .sort((left, right) => left.getTime() - right.getTime())[0] || requestTime
    const editDeadlineAt = scheduleEditDeadline((oldData[0].date as Timestamp).toDate(), firstSubmittedAt)
    resultingEditDeadline = editDeadlineAt
    const rejectedByManager = oldData.every((schedule) => schedule.status === 'Rejected')
    if (!rejectedByManager && requestTime.getTime() >= editDeadlineAt.getTime()) {
      throw new ApiError(409, 'Bảng lịch đã hết hạn điều chỉnh và hiện đã được khóa.')
    }
    const previousPenaltyId = oldData.map((schedule) => schedule.penaltyId).find(Boolean) || null
    const waiverDeadline = new Date(scheduleDeadline((oldData[0].date as Timestamp).toDate()).getTime() + 24 * 60 * 60 * 1000)
    const hasSundayWaiver = oldData.some((schedule) => schedule.allowSundayResubmissionWithoutPenalty === true) && requestTime < waiverDeadline
    const reactivationWaiverActive = employeeSnapshot.get('reactivationScheduleWaiverWeekStart') === vietnamWeekStartKey(requestTime) &&
      oldWeekStartKey === vietnamWeekStartKey(requestTime)
    const lateRejectedResubmission = rejectedByManager && requestTime >= scheduleDeadline((oldData[0].date as Timestamp).toDate()) && !hasSundayWaiver && !reactivationWaiverActive
    const retainedPenaltyId = previousPenaltyId || (lateRejectedResubmission ? `schedule-resubmit-${actor.uid}-${id}` : null)
    const retainedPenaltyAmount = Math.max(
      lateRejectedResubmission ? workflowPolicy.scheduleLatePenalty : 0,
      ...oldData.map((schedule) => Number(schedule.penaltyAmount || 0))
    )
    resultingPenaltyAmount = retainedPenaltyAmount

    const now = FieldValue.serverTimestamp()
    const weekStart = mondayFor(schedules[0].date)
    const batchKey = scheduleBatchKey(actor.uid, weekStart)
    const revisionCount = Math.max(0, ...oldData.map((schedule) => Number(schedule.revisionCount || 0))) + 1
    oldRefs.forEach((ref) => transaction.delete(ref))
    if (lateRejectedResubmission && !previousPenaltyId && retainedPenaltyId && workflowPolicy.scheduleLatePenalty > 0) {
      transaction.create(adminDb.collection('penalties').doc(retainedPenaltyId), {
        ...penaltyData({
          employeeId: actor.uid,
          factoryId: actor.factoryId,
          title: 'Đăng ký lại lịch trễ hạn',
          description: `Gửi lại lịch sau 00:00 Thứ Hai. Khấu trừ ${workflowPolicy.scheduleLatePenalty.toLocaleString('vi-VN')}đ.`,
          category: 'Late',
          amount: workflowPolicy.scheduleLatePenalty,
          sourceType: 'scheduleResubmission',
          sourceId: id,
        }),
        status: 'Active',
        confirmedBy: 'system:auto-schedule',
        confirmedAt: now,
      })
    }
    schedules.forEach((schedule, index) => {
      transaction.create(newRefs[index], {
        employeeId: actor.uid,
        factoryId: actor.factoryId,
        date: Timestamp.fromDate(schedule.date),
        shift: schedule.shift,
        status: 'Approved',
        note: schedule.note,
        batchKey,
        fixedSchedule: retainedFixedSchedule,
        firstScheduleException: retainedFirstScheduleException,
        pastDateRestricted: restrictPastDates,
        requiresReapproval: false,
        revisionCount,
        weeklyShiftCount: revisedShiftCount,
        underMinimumWarning: revisedShiftCount < workflowPolicy.minimumWeeklyShifts,
        autoApproved: true,
        reviewNote: revisedShiftCount < workflowPolicy.minimumWeeklyShifts
          ? `Tự động xác nhận · lịch có ${revisedShiftCount}/${workflowPolicy.minimumWeeklyShifts} ca.`
          : `Tự động xác nhận · lịch đạt ${revisedShiftCount} ca.`,
        reviewedBy: 'system:auto-schedule',
        reviewedAt: now,
        penaltyId: retainedPenaltyId,
        penaltyAmount: retainedPenaltyAmount,
        allowSundayResubmissionWithoutPenalty: false,
        firstSubmittedAt: Timestamp.fromDate(firstSubmittedAt),
        editDeadlineAt: Timestamp.fromDate(editDeadlineAt),
        createdAt: now,
        updatedAt: now,
        lockedAt: now,
      })
    })
    transaction.create(workflow, {
      employeeId: actor.uid,
      action: 'replaceSchedules',
      targetIds: newRefs.map((ref) => ref.id),
      replacedIds: scheduleIds,
      penaltyId: retainedPenaltyId,
      createdAt: now,
    })
    transaction.set(adminDb.collection('notifications').doc(`schedule-status-${newRefs[0].id}`), {
      employeeId: actor.uid,
      title: 'Lịch tuần đã tự động cập nhật',
      message: revisedShiftCount < workflowPolicy.minimumWeeklyShifts
        ? `Bản mới có ${revisedShiftCount}/${workflowPolicy.minimumWeeklyShifts} ca và được đánh dấu cần lưu ý.`
        : `Bản mới đã lưu và đạt ${revisedShiftCount} ca trong tuần.`,
      type: revisedShiftCount < workflowPolicy.minimumWeeklyShifts ? 'warning' : 'success',
      isRead: false,
      createdAt: now,
    })
    managerIds.forEach((managerId) => {
      transaction.set(
        managerNotificationRef(managerId, `schedule-${batchKey}`),
        managerNotification(
          managerId,
          revisedShiftCount < workflowPolicy.minimumWeeklyShifts ? 'Lịch tuần vừa sửa · cần lưu ý' : 'Lịch tuần vừa sửa · đạt yêu cầu',
          `Bản lịch mới nhất đã tự động duyệt với ${revisedShiftCount} ca.${revisedShiftCount < workflowPolicy.minimumWeeklyShifts ? ` Dưới mức ${workflowPolicy.minimumWeeklyShifts} ca.` : ''}`,
          revisedShiftCount < workflowPolicy.minimumWeeklyShifts ? 'warning' : 'info'
        )
      )
    })
  })

  await sendManagerPushes({
    managerIds,
    sourceKey: `schedule-revised-${newRefs[0].id}`,
    title: revisedShiftCount < workflowPolicy.minimumWeeklyShifts ? 'Lịch sửa lại cần lưu ý' : 'Lịch tuần vừa được cập nhật',
    body: `Bản mới nhất đã tự động duyệt với ${revisedShiftCount} ca.`,
    link: '/notifications',
    source: 'workSchedules',
    sourceId: newRefs[0].id,
  })

  return { ids: newRefs.map((ref) => ref.id), penalty: resultingPenaltyAmount, editDeadlineAt: resultingEditDeadline.toISOString() }
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
      const firstSubmittedAt = schedules
        .map((schedule) => firestoreDate(schedule.firstSubmittedAt) || firestoreDate(schedule.createdAt))
        .filter((value): value is Date => Boolean(value))
        .sort((left, right) => left.getTime() - right.getTime())[0] || new Date()
      const editDeadlineAt = firestoreDate(schedules[0].editDeadlineAt) || scheduleEditDeadline((schedules[0].date as Timestamp).toDate(), firstSubmittedAt)
      if (Date.now() >= editDeadlineAt.getTime()) {
        throw new ApiError(409, 'Bảng lịch đã hết hạn điều chỉnh và hiện đã được khóa.')
      }
      refs.forEach((ref, index) => transaction.set(ref, {
        status: 'Editing',
        editPreviousStatus: schedules[index].status,
        editingAt: now,
        updatedAt: now,
        batchKey,
        lockedAt: null,
        firstSubmittedAt: Timestamp.fromDate(firstSubmittedAt),
        editDeadlineAt: Timestamp.fromDate(editDeadlineAt),
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
      lockedAt: now,
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
  const managerIds = await activeManagerIds(actor.factoryId)
  let isLate = false
  let penaltyIfApproved = 0
  let penaltyIfRejected = workflowPolicy.leaveOnTimeRejectedPenalty
  let weeklyShiftCount = 0
  let weeklyShiftCountAfterLeave = 0

  await adminDb.runTransaction(async (transaction) => {
    const [workflowSnapshot, existingLeaves] = await Promise.all([
      transaction.get(workflow),
      transaction.get(adminDb.collection('leaveRequests').where('employeeId', '==', actor.uid)),
    ])
    if (workflowSnapshot.exists) throw new ApiError(409, 'Yêu cầu nghỉ này đã được gửi.')
    const activeLeave = existingLeaves.docs.some((snapshot) => ['Pending', 'AwaitingEmployeeConsent'].includes(String(snapshot.get('status'))))
    if (activeLeave) throw new ApiError(409, 'Bạn đang có một yêu cầu nghỉ được xử lý. Hãy bấm "Điều chỉnh" trên yêu cầu đó để cập nhật, không gửi yêu cầu mới.')
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
    transaction.create(
      adminDb.collection('notifications').doc(`leave-status-${leaveRef.id}`),
      warningNotification(actor.uid, 'Đã gửi yêu cầu nghỉ', 'Yêu cầu đã gửi đến quản lý và đang chờ duyệt.')
    )
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

/**
 * Closes duplicate legacy Pending leave requests, retaining only the newest
 * one. This is idempotent so the employee page can call it safely when it
 * opens after the old multi-submit behavior.
 */
export async function normalizeLeaveRequests(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  objectBody(raw)
  const leavesQuery = adminDb.collection('leaveRequests').where('employeeId', '==', actor.uid)
  const snapshot = await leavesQuery.get()
  const createdMillis = (value: unknown) => value instanceof Timestamp ? value.toMillis() : 0
  const pending = snapshot.docs
    .filter((item) => item.get('status') === 'Pending')
    .sort((left, right) => createdMillis(right.get('createdAt')) - createdMillis(left.get('createdAt')))
  if (pending.length <= 1) return { cancelledIds: [] as string[] }

  const cancelledIds = pending.slice(1).map((item) => item.id)
  const now = FieldValue.serverTimestamp()
  const batch = adminDb.batch()
  cancelledIds.forEach((id) => batch.set(adminDb.collection('leaveRequests').doc(id), {
    status: 'Cancelled',
    cancelledBy: 'system-legacy-cleanup',
    cancelledAt: now,
    cancellationReason: 'Yêu cầu cũ được đóng khi hệ thống chuyển sang chế độ một yêu cầu đang xử lý.',
    updatedAt: now,
  }, { merge: true }))
  await batch.commit()
  return { cancelledIds }
}

function shiftStart(date: Date, shift: Shift): Date {
  const day = vietnamDateKey(date)
  return new Date(`${day}T${shiftStartTime[shift]}:00+07:00`)
}

function lateScheduleIds(body: Record<string, unknown>): string[] {
  const legacyId = body.workScheduleId == null ? '' : text(body.workScheduleId, 'Mã ca làm', 128)
  const raw = Array.isArray(body.workScheduleIds) ? body.workScheduleIds : legacyId ? [legacyId] : []
  const ids = [...new Set(raw.map((value, index) => text(value, `Mã ca làm ${index + 1}`, 128)))]
  if (!ids.length) throw new ApiError(400, 'Vui lòng chọn ít nhất một ca đã được xác nhận.')
  if (ids.length > 21) throw new ApiError(400, 'Mỗi yêu cầu đi trễ chỉ được chọn tối đa 21 ca.')
  return ids
}

function lateArrivalDate(date: Date, arrivalTime: string): Date {
  return new Date(`${vietnamDateKey(date)}T${arrivalTime}:00+07:00`)
}

function lateNoticeDeadline(starts: Date[], multi: boolean): Date {
  if (!multi) return new Date(starts[0].getTime() - workflowPolicy.lateNoticeMinutes * 60_000)
  const earliest = starts.reduce((value, item) => value < item ? value : item, starts[0])
  return new Date(`${vietnamDateKey(earliest)}T00:00:00+07:00`)
}

export async function submitLate(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  const body = objectBody(raw)
  const id = requestId(body)
  const scheduleIds = lateScheduleIds(body)
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
  const workflow = workflowRef(actor, id)
  const lateRef = adminDb.collection('lateRequests').doc()
  const managerIds = await activeManagerIds(actor.factoryId)
  let computedPenalty = 0

  await adminDb.runTransaction(async (transaction) => {
    const workflowSnapshot = await transaction.get(workflow)
    const scheduleSnapshots = []
    for (const scheduleId of scheduleIds) {
      scheduleSnapshots.push(await transaction.get(adminDb.collection('workSchedules').doc(scheduleId)))
    }
    if (workflowSnapshot.exists) throw new ApiError(409, 'Thông báo đi trễ này đã được gửi.')
    const entries = scheduleSnapshots.map((snapshot, index) => {
      if (!snapshot.exists) throw new ApiError(404, 'Không tìm thấy ca làm.')
      const schedule = snapshot.data()!
      if (schedule.employeeId !== actor.uid || schedule.status !== 'Approved') {
        throw new ApiError(403, 'Bạn chỉ được báo trễ cho ca đã được duyệt của mình.')
      }
      const shift = schedule.shift as Shift
      if (!shifts.includes(shift)) throw new ApiError(400, 'Ca làm không hợp lệ.')
      const date = (schedule.date as Timestamp).toDate()
      if (vietnamDateKey(date) < vietnamDateKey(new Date())) {
        throw new ApiError(400, 'Chỉ được chọn ca hôm nay hoặc ca sắp tới.')
      }
      const start = shiftStart(date, shift)
      const arrival = lateArrivalDate(date, arrivalTime)
      const lateMinutes = Math.ceil((arrival.getTime() - start.getTime()) / 60_000)
      if (lateMinutes < 1 || lateMinutes > 720) throw new ApiError(400, 'Giờ dự kiến phải sau giờ bắt đầu ca.')
      return { scheduleId: scheduleIds[index], date, shift, scheduleDate: schedule.date, start, lateMinutes }
    })
    const starts = entries.map((entry) => entry.start)
    const deadline = lateNoticeDeadline(starts, entries.length > 1)
    const noticeMinutes = (deadline.getTime() - Date.now()) / 60_000
    const isLateNotice = noticeMinutes < 0
    const contactPenalty = managerMessageStatus === 'messagedOtherManager'
      ? workflowPolicy.lateWrongManagerMessagePenalty
      : managerMessageStatus === 'notMessaged'
        ? workflowPolicy.lateMissingManagerMessagePenalty
        : 0
    computedPenalty = Math.max(isLateNotice ? workflowPolicy.lateNoticePenalty : 0, contactPenalty)
    const now = FieldValue.serverTimestamp()
    const first = entries[0]
    transaction.create(lateRef, {
      employeeId: actor.uid,
      workScheduleId: first.scheduleId,
      workScheduleIds: scheduleIds,
      date: first.scheduleDate,
      shift: first.shift,
      lateMinutes: Math.max(...entries.map((entry) => entry.lateMinutes)),
      lateEntries: entries.map((entry) => ({ workScheduleId: entry.scheduleId, date: entry.scheduleDate, shift: entry.shift, lateMinutes: entry.lateMinutes })),
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
    transaction.create(
      adminDb.collection('notifications').doc(`late-status-${lateRef.id}`),
      warningNotification(actor.uid, 'Đã gửi thông báo đi trễ', 'Thông báo đã gửi đến quản lý và đang chờ xử lý.')
    )
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
  const employeeSnapshot = await adminDb.collection('employees').doc(actor.uid).get()
  if (!employeeSnapshot.exists || !hasCompleteBankAccount(employeeSnapshot.data() as Record<string, unknown> | undefined)) {
    throw new ApiError(409, 'Bạn cần cập nhật đủ thông tin tài khoản ngân hàng trước khi ứng lương.')
  }
  const workflow = workflowRef(actor, id)
  const advanceRef = adminDb.collection('salaryAdvances').doc()
  const managerIds = await activeManagerIds(actor.factoryId)

  await adminDb.runTransaction(async (transaction) => {
    if ((await transaction.get(workflow)).exists) throw new ApiError(409, 'Yêu cầu ứng lương này đã được gửi.')
    const now = FieldValue.serverTimestamp()
    transaction.create(advanceRef, {
      employeeId: actor.uid,
      factoryId: actor.factoryId,
      amount,
      reason,
      status: 'Pending',
      createdAt: now,
      updatedAt: now,
    })
    transaction.create(
      adminDb.collection('notifications').doc(`salary-status-${advanceRef.id}`),
      warningNotification(actor.uid, 'Đã gửi yêu cầu ứng lương', 'Yêu cầu đã gửi đến quản lý và đang chờ duyệt.')
    )
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
  const managerIds = await activeManagerIds(actor.factoryId)

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

export async function reopenRequest(actor: RequestActor, raw: unknown) {
  requireManager(actor)
  const body = objectBody(raw)
  const resource = text(body.resource, 'Loại yêu cầu', 20)
  if (resource !== 'salary') throw new ApiError(400, 'Chỉ hỗ trợ mở lại yêu cầu ứng lương.')
  const id = text(body.id, 'Mã yêu cầu', 128)
  const note = text(body.note ?? '', 'Lý do mở lại', 1000, true)
  const targetRef = adminDb.collection('salaryAdvances').doc(id)
  const notificationRef = adminDb.collection('notifications').doc(`salary-reopened-${id}`)
  const dispatchRef = adminDb.collection('pushDispatches').doc(`salary-reopened-${id}`)
  let employeeId = ''

  await adminDb.runTransaction(async (transaction) => {
    const target = await transaction.get(targetRef)
    if (!target.exists) throw new ApiError(404, 'Không tìm thấy yêu cầu ứng lương.')
    const data = target.data()!
    if (!['Approved', 'Rejected'].includes(String(data.status))) {
      throw new ApiError(409, 'Chỉ có thể mở lại yêu cầu đã được duyệt hoặc từ chối.')
    }
    employeeId = String(data.employeeId || '')
    if (!employeeId) throw new ApiError(409, 'Yêu cầu chưa có nhân viên hợp lệ.')

    const now = FieldValue.serverTimestamp()
    transaction.set(targetRef, {
      status: 'Pending',
      reviewNote: note || 'Quản lý đã mở lại yêu cầu để nhân viên điều chỉnh.',
      reopenedBy: actor.uid,
      reopenedAt: now,
      updatedAt: now,
      approvedBy: FieldValue.delete(),
      reviewedBy: FieldValue.delete(),
      reviewedAt: FieldValue.delete(),
    }, { merge: true })
    transaction.set(notificationRef, {
      employeeId,
      title: 'Yêu cầu ứng lương được mở lại',
      message: note || 'Quản lý đã mở lại yêu cầu. Bạn có thể điều chỉnh hoặc gửi lại yêu cầu.',
      type: 'info',
      isRead: false,
      createdAt: now,
    })
    transaction.set(dispatchRef, {
      source: 'salaryAdvances',
      sourceId: id,
      employeeId,
      status: 'Pending',
      state: 'queued',
      createdAt: now,
      updatedAt: now,
    })
  })

  const push = await sendEmployeePush({
    employeeId,
    dispatchId: dispatchRef.id,
    title: 'Yêu cầu ứng lương được mở lại',
    body: note || 'Quản lý đã mở lại yêu cầu để bạn điều chỉnh hoặc gửi lại.',
    link: '/salary-advance',
    source: 'salaryAdvances',
    sourceId: id,
    status: 'Pending',
  })
  return { id, status: 'Pending', push }
}

export async function cancelScheduleBatch(actor: RequestActor, raw: unknown) {
  requireStaff(actor)
  const body = objectBody(raw)
  if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 21) {
    throw new ApiError(400, 'Bảng lịch cần từ 1 đến 21 ca.')
  }
  const ids = body.ids.map((value, index) => text(value, `Mã ca ${index + 1}`, 128))
  const refs = ids.map((id) => adminDb.collection('workSchedules').doc(id))
  const managerIds = await activeManagerIds(actor.factoryId)

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
  const managerIds = await activeManagerIds(actor.factoryId)

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
      const scheduleIds = lateScheduleIds(body)
      const expectedArrival = text(body.expectedArrival, 'Giờ dự kiến', 5)
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(expectedArrival)) throw new ApiError(400, 'Giờ dự kiến không hợp lệ.')
      const schedules = []
      for (const scheduleId of scheduleIds) {
        schedules.push(await transaction.get(adminDb.collection('workSchedules').doc(scheduleId)))
      }
      const entries = schedules.map((schedule, index) => {
        if (!schedule.exists || schedule.get('employeeId') !== actor.uid || schedule.get('status') !== 'Approved') {
          throw new ApiError(403, 'Bạn chỉ được báo trễ cho ca đã được duyệt của mình.')
        }
        const shift = schedule.get('shift') as Shift
        const date = (schedule.get('date') as Timestamp).toDate()
        if (vietnamDateKey(date) < vietnamDateKey(new Date())) throw new ApiError(400, 'Chỉ được chọn ca hôm nay hoặc ca sắp tới.')
        const start = shiftStart(date, shift)
        const arrival = lateArrivalDate(date, expectedArrival)
        const lateMinutes = Math.ceil((arrival.getTime() - start.getTime()) / 60_000)
        if (lateMinutes < 1 || lateMinutes > 720) throw new ApiError(400, 'Giờ dự kiến phải sau giờ bắt đầu ca.')
        return { scheduleId: scheduleIds[index], scheduleDate: schedule.get('date'), date, shift, start, lateMinutes }
      })
      const deadline = lateNoticeDeadline(entries.map((entry) => entry.start), entries.length > 1)
      const noticeMinutes = (deadline.getTime() - Date.now()) / 60_000
      const first = entries[0]
      updates.workScheduleId = first.scheduleId
      updates.workScheduleIds = scheduleIds
      updates.date = first.scheduleDate
      updates.shift = first.shift
      updates.expectedArrival = expectedArrival
      updates.lateMinutes = Math.max(...entries.map((entry) => entry.lateMinutes))
      updates.lateEntries = entries.map((entry) => ({ workScheduleId: entry.scheduleId, date: entry.scheduleDate, shift: entry.shift, lateMinutes: entry.lateMinutes }))
      updates.noticeMinutes = Math.floor(noticeMinutes)
      updates.noticeClass = noticeMinutes < 0 ? 'late' : 'onTime'
      updates.reason = text(body.reason, 'Lý do', 1000)
    }

    const now = FieldValue.serverTimestamp()
    transaction.set(targetRef, {
      ...updates,
      status: 'Pending',
      revisedAt: now,
      updatedAt: now,
    }, { merge: true })
    transaction.set(
      adminDb.collection('notifications').doc(`${resource}-revised-status-${id}`),
      warningNotification(actor.uid, 'Đã gửi lại yêu cầu', 'Nội dung đã cập nhật và gửi đến quản lý.'),
      { merge: true }
    )
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
  const managerIds = await activeManagerIds(actor.factoryId)
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
    if (resource === 'late' && managerPenaltyAmount != null) {
      throw new ApiError(400, 'Khoản trừ đi trễ được tính tự động, không nhập mức trừ thủ công.')
    }
    if (resource === 'leave' && managerPenaltyAmount != null && data.underMinimumWarning !== true) {
      throw new ApiError(400, 'Chỉ được chọn mức trừ riêng khi yêu cầu nghỉ làm nhân viên xuống dưới mức ca tối thiểu.')
    }
    employeeId = data.employeeId
    const employeeSnapshot = await transaction.get(adminDb.collection('employees').doc(employeeId))
    if (!employeeSnapshot.exists) throw new ApiError(404, 'Chưa tìm thấy hồ sơ nhân viên.')
    if (actor.role !== 'director' && String(employeeSnapshot.get('factoryId') || 'factory-1') !== actor.factoryId) {
      throw new ApiError(403, 'Bạn chỉ được xử lý yêu cầu của nhân viên thuộc xưởng mình.')
    }
    if (resource === 'salary' && employeeSnapshot.get('status') !== 'active') {
      throw new ApiError(409, 'Tài khoản nhân viên đã bị vô hiệu hóa nên không thể xử lý yêu cầu ứng lương.')
    }
    const employeeName = String(employeeSnapshot.get('fullName') || 'Nhân viên')
    const employeeCode = String(employeeSnapshot.get('employeeCode') || employeeId.slice(0, 8))
    reviewedEmployee = `${employeeName} · ${employeeCode}`
    const now = FieldValue.serverTimestamp()
    const isLate = data.noticeClass === 'late'
    const suggestedAmount = status === 'Approved'
      ? Number(data.penaltyIfApproved ?? (isLate ? workflowPolicy.leaveLateApprovedPenalty : 0))
      : Number(data.penaltyIfRejected ?? (isLate ? workflowPolicy.leaveLateRejectedPenalty : workflowPolicy.leaveOnTimeRejectedPenalty))
    appliedPenaltyAmount = resource === 'leave' || resource === 'late' ? managerPenaltyAmount ?? suggestedAmount : 0
    requiresEmployeeConsent = resource === 'leave' && status === 'Approved' && appliedPenaltyAmount > 0
    if (resource === 'staff' && data.type === 'scheduleModeChange') {
      const requestedMode = parseScheduleMode(data.requestedScheduleMode)
      const previousMode = parseScheduleMode(data.previousScheduleMode)
      if (!requestedMode || !previousMode || requestedMode === previousMode) {
        throw new ApiError(409, 'Yêu cầu đổi chế độ không còn hợp lệ.')
      }
      if (status === 'Approved') {
        const currentMode = employeeScheduleMode(employeeSnapshot.data() as Record<string, unknown>)
        if (currentMode !== previousMode) {
          throw new ApiError(409, 'Chế độ hiện tại của nhân viên đã thay đổi. Vui lòng tải lại yêu cầu.')
        }
        const requestedWeekStart = firestoreDate(data.weekStart)
        const requestedWeekKey = requestedWeekStart ? vietnamWeekStartKey(requestedWeekStart) : ''
        const currentWeekKey = vietnamWeekStartKey(new Date())
        const effectiveWeekStart = requestedWeekKey > currentWeekKey
          ? requestedWeekKey
          : vietnamWeekStartKey(new Date(), 1)
        const targetStart = new Date(`${effectiveWeekStart}T00:00:00+07:00`)
        const targetEnd = new Date(targetStart.getTime() + 7 * 24 * 60 * 60 * 1000)
        const futureSchedules = await transaction.get(adminDb.collection('workSchedules')
          .where('employeeId', '==', employeeId)
          .where('date', '>=', Timestamp.fromDate(targetStart))
          .where('date', '<', Timestamp.fromDate(targetEnd)))
        futureSchedules.docs.forEach((schedule) => {
          if (schedule.get('status') === 'Cancelled') return
          transaction.set(schedule.ref, {
            status: 'Cancelled',
            cancellationReason: 'Đã đổi chế độ lịch; cần tạo lại lịch tuần kế tiếp.',
            updatedAt: now,
            lockedAt: now,
          }, { merge: true })
        })
        transaction.set(employeeSnapshot.ref, {
          scheduleMode: requestedMode,
          scheduleModeEffectiveWeekStart: effectiveWeekStart,
          scheduleModeChangeCooldownUntil: Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
          ...(requestedMode === 'fixed'
            ? { fixedScheduleNeedsSetupWeekStart: effectiveWeekStart }
            : { fixedScheduleNeedsSetupWeekStart: FieldValue.delete() }),
          updatedAt: now,
        }, { merge: true })
        transaction.set(targetRef, { weekStart: Timestamp.fromDate(targetStart) }, { merge: true })
      }
    }
    const longLeaveSchedules = resource === 'leave' && status === 'Approved' && !requiresEmployeeConsent && data.duration === 'long'
      ? await transaction.get(adminDb.collection('workSchedules').where('employeeId', '==', employeeId))
      : null
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
          ...(requiresEmployeeConsent
            ? { cancellationReason: FieldValue.delete() }
            : { cancellationReason: 'Quyết định hiện tại không phát sinh khấu trừ.' }),
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
            cancelledByLeaveRequestId: id,
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
      const restoredItems = data.type === 'scheduleChange' && Array.isArray(data.restoredShifts)
        ? data.restoredShifts as Array<{ scheduleId: string; date: Timestamp; shift: Shift }>
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
      const restoredRefs = restoredItems
        .filter((item) => typeof item?.scheduleId === 'string')
        .map((item) => adminDb.collection('workSchedules').doc(item.scheduleId))
      const restoredSnapshots = await Promise.all(restoredRefs.map((ref) => transaction.get(ref)))
      restoredSnapshots.forEach((snapshot, index) => {
        const item = restoredItems[index]
        const reason = String(snapshot.get('cancellationReason') || '')
        const scheduleDate = snapshot.exists && snapshot.get('date') instanceof Timestamp
          ? (snapshot.get('date') as Timestamp).toDate().toISOString().slice(0, 10)
          : ''
        if (!snapshot.exists || snapshot.get('employeeId') !== employeeId || snapshot.get('status') !== 'Cancelled' ||
          (!snapshot.get('cancelledByLeaveRequestId') && !/ngh[ỉi]|leave/i.test(reason)) ||
          !(item?.date instanceof Timestamp) || scheduleDate !== item.date.toDate().toISOString().slice(0, 10) || snapshot.get('shift') !== item.shift) {
          throw new ApiError(409, 'Một ca xin đi làm lại không còn là ca nghỉ hợp lệ. Vui lòng tải lại lịch.')
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
      restoredRefs.forEach((ref) => transaction.set(ref, {
        status: 'Approved',
        cancellationReason: FieldValue.delete(),
        cancelledByLeaveRequestId: FieldValue.delete(),
        cancelledBy: FieldValue.delete(),
        cancelledAt: FieldValue.delete(),
        lockedAt: now,
        restoredFromLeave: true,
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
      restoredSnapshots.forEach((snapshot) => {
        if (!snapshot.exists) return
        const schedule = snapshot.data()
        if (!schedule?.date) return
        existingKeys.add(`${(schedule.date as Timestamp).toDate().toISOString().slice(0, 10)}-${schedule.shift}`)
      })
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
      ? data.type === 'scheduleModeChange'
        ? 'Yêu cầu đổi chế độ làm việc'
        : data.type === 'scheduleChange' ? 'Yêu cầu đổi / thêm ca' : data.type === 'overtime' ? 'Yêu cầu làm thêm' : 'Ghi chú'
      : config.label
    reviewedLabel = requestLabel
    reviewedLink = resource === 'staff'
      ? data.type === 'note' ? '/staff-note' : data.type === 'scheduleModeChange' ? '/profile' : config.link
      : config.link
    const notificationTitle = resource === 'staff' && data.type === 'scheduleModeChange'
      ? 'Yêu cầu đổi chế độ đã được xử lý'
      : config.title
    transaction.set(notificationRef, {
      employeeId,
      title: notificationTitle,
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
    if (!requiresEmployeeConsent) {
      managerIds.forEach((managerId) => {
        transaction.set(
          managerNotificationRef(managerId, `${resource}-${id}`),
          managerNotification(
            managerId,
            `${requestLabel} đã ${status === 'Approved' ? 'được duyệt' : 'bị từ chối'}`,
            `Nhân viên: ${reviewedEmployee}.`,
            'info',
            true
          )
        )
      })
    }
  })

  const push = await sendEmployeePush({
    employeeId,
    dispatchId: dispatchRef.id,
    title: resource === 'staff' && reviewedLabel === 'Yêu cầu đổi chế độ làm việc'
      ? 'Yêu cầu đổi chế độ đã được xử lý'
      : config.title,
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
  const submittedNote = text(body.note ?? '', 'Phản hồi', 1000, true)
  const note = status === 'Rejected' && !submittedNote ? 'Quản lý yêu cầu đăng ký lại lịch.' : submittedNote
  let allowSundayResubmissionWithoutPenalty = false
  const waiveNewEmployeePenalty = status === 'Approved' && body.waiveNewEmployeePenalty === true

  const refs = ids.map((id) => adminDb.collection('workSchedules').doc(id))
  let employeeId = ''
  const notificationRef = adminDb.collection('notifications').doc(`schedule-status-${ids[0]}`)
  const dispatchRef = adminDb.collection('pushDispatches').doc(`schedule-batch-${ids[0]}-${status}`)
  const managerIds = await activeManagerIds(actor.factoryId)
  let reviewedEmployee = 'Nhân viên'

  await adminDb.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)))
    if (snapshots.some((snapshot) => !snapshot.exists)) {
      throw new ApiError(404, 'Không tìm thấy đầy đủ bảng lịch.')
    }
    const schedules = snapshots.map((snapshot) => snapshot.data()!)
    employeeId = schedules[0].employeeId
    const employeeSnapshot = await transaction.get(adminDb.collection('employees').doc(employeeId))
    if (!employeeSnapshot.exists) throw new ApiError(404, 'Chưa tìm thấy hồ sơ nhân viên.')
    if (actor.role !== 'director' && String(employeeSnapshot.get('factoryId') || 'factory-1') !== actor.factoryId) {
      throw new ApiError(403, 'Bạn chỉ được xử lý lịch của nhân viên thuộc xưởng mình.')
    }
    const employeeName = String(employeeSnapshot.get('fullName') || 'Nhân viên')
    const employeeCode = String(employeeSnapshot.get('employeeCode') || employeeId.slice(0, 8))
    reviewedEmployee = `${employeeName} · ${employeeCode}`
    const week = mondayFor((schedules[0].date as Timestamp).toDate()).toISOString()
    const batchKey = schedules[0].batchKey || scheduleBatchKey(employeeId, mondayFor((schedules[0].date as Timestamp).toDate()))
    const firstSubmittedAt = schedules
      .map((schedule) => firestoreDate(schedule.firstSubmittedAt) || firestoreDate(schedule.createdAt))
      .filter((value): value is Date => Boolean(value))
      .sort((left, right) => left.getTime() - right.getTime())[0]
    allowSundayResubmissionWithoutPenalty = status === 'Rejected' &&
      vietnamWeekdayNumber(new Date()) === 7 &&
      Boolean(firstSubmittedAt && vietnamWeekdayNumber(firstSubmittedAt) === 6)
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

    let shouldWaivePenalty = false
    if (waiveNewEmployeePenalty) {
      const allEmployeeSchedules = await transaction.get(
        adminDb.collection('workSchedules').where('employeeId', '==', employeeId)
      )
      const hasPreviousSchedule = allEmployeeSchedules.docs.some((snapshot) =>
        !ids.includes(snapshot.id) && snapshot.get('status') !== 'Cancelled'
      )
      // Waive only the first ever schedule for an employee. Account age is
      // not a reliable proxy because a newly-created account may already have
      // submitted a pending/legacy schedule.
      shouldWaivePenalty = !hasPreviousSchedule
    }
    const penaltyIds = Array.from(new Set(schedules.map((schedule) => schedule.penaltyId).filter((value): value is string => typeof value === 'string' && value.length > 0)))
    const penaltySnapshots = await Promise.all(penaltyIds.map((id) => transaction.get(adminDb.collection('penalties').doc(id))))
    const now = FieldValue.serverTimestamp()
    refs.forEach((ref) => transaction.set(ref, {
      status,
      autoApproved: status === 'Approved',
      requiresReapproval: false,
      allowSundayResubmissionWithoutPenalty,
      reviewNote: note,
      reviewedBy: actor.uid,
      reviewedAt: now,
      updatedAt: now,
      lockedAt: status === 'Approved' ? now : null,
    }, { merge: true }))
    penaltySnapshots.forEach((snapshot) => {
      if (!snapshot.exists) return
      if (shouldWaivePenalty) {
        transaction.set(snapshot.ref, {
          status: 'Cancelled',
          amount: 0,
          cancellationReason: 'Miễn phạt lần đầu cho nhân viên mới khi quản lý xác nhận.',
          cancelledAt: now,
          updatedAt: now,
        }, { merge: true })
      } else if (snapshot.get('status') !== 'Cancelled' && Number(snapshot.get('amount') || 0) > 0) {
        transaction.set(snapshot.ref, {
          status: 'Active',
          confirmedBy: actor.uid,
          confirmedAt: now,
          updatedAt: now,
        }, { merge: true })
      }
    })
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
    if (shouldWaivePenalty) {
      transaction.set(adminDb.collection('notifications').doc(`schedule-penalty-waived-${ids[0]}`), {
        employeeId,
        title: 'Đã miễn phạt đăng ký lịch',
        message: 'Quản lý đã miễn khoản phạt lần đầu vì bạn là nhân viên mới.',
        type: 'success',
        isRead: false,
        createdAt: now,
      })
    }
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
  targetFids?: string[]
}) {
  const dispatchRef = adminDb.collection('pushDispatches').doc(params.dispatchId)
  const devices = await adminDb.collection('employees').doc(params.employeeId)
    .collection('notificationDevices').limit(500).get()
  const staleBefore = Date.now() - 90 * 24 * 60 * 60 * 1000
  const staleDevices = devices.docs.filter((item) => {
    const lastSeenAt = item.get('lastSeenAt')
    return lastSeenAt instanceof Timestamp && lastSeenAt.toMillis() < staleBefore
  })
  const staleIds = new Set(staleDevices.map((item) => item.id))
  const activeDevices = devices.docs.filter((item) => !staleIds.has(item.id))
  const deviceByFid = new Map(
    activeDevices.flatMap((item) => {
      const fid = item.get('fid')
      return typeof fid === 'string' && fid ? [[fid, item] as const] : []
    })
  )

  if (staleDevices.length) {
    const staleBatch = adminDb.batch()
    staleDevices.forEach((item) => staleBatch.delete(item.ref))
    await staleBatch.commit()
  }

  const requestedFids = params.targetFids ? new Set(params.targetFids) : null
  const fids = [...deviceByFid.keys()].filter((fid) => !requestedFids || requestedFids.has(fid))
  if (!fids.length) {
    await dispatchRef.set({
      state: 'no-devices',
      staleDeviceCount: staleDevices.length,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return { state: 'no-devices', successCount: 0, failureCount: 0 }
  }

  await dispatchRef.set({
    employeeId: params.employeeId,
    title: params.title,
    body: params.body,
    link: params.link,
    source: params.source,
    sourceId: params.sourceId,
    status: params.status,
    state: 'sending',
    staleDeviceCount: staleDevices.length,
    lastAttemptAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  const invalidCodes = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
  ])
  const retryableCodes = new Set([
    'messaging/internal-error',
    'messaging/server-unavailable',
    'messaging/unknown-error',
    'messaging/message-rate-exceeded',
    'messaging/device-message-rate-exceeded',
  ])
  const successfulFids = new Set<string>()
  const invalidFids = new Set<string>()
  const finalErrors: string[] = []
  let pendingFids = fids
  let attemptsUsed = 0

  try {
    for (let attempt = 1; attempt <= 3 && pendingFids.length; attempt += 1) {
      attemptsUsed = attempt
      try {
        const response = await adminMessaging.sendEachForMulticast({
          fids: pendingFids,
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
            headers: {
              TTL: '86400',
              Urgency: 'high',
            },
            notification: {
              icon: '/pwa-icon-192.png',
              badge: '/pwa-icon-192.png',
              tag: `${params.source}:${params.sourceId}`.slice(0, 64),
              renotify: false,
            },
            fcmOptions: { link: params.link },
          },
        })

        const retryFids: string[] = []
        response.responses.forEach((item, index) => {
          const fid = pendingFids[index]
          if (item.success) {
            successfulFids.add(fid)
            return
          }

          const code = item.error?.code || 'messaging/unknown-error'
          if (invalidCodes.has(code)) {
            invalidFids.add(fid)
          } else if (attempt < 3 && retryableCodes.has(code)) {
            retryFids.push(fid)
          } else {
            finalErrors.push(code)
          }
        })
        pendingFids = retryFids
      } catch (error) {
        if (attempt === 3) throw error
      }

      if (pendingFids.length && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 350))
      }
    }

    if (invalidFids.size) {
      const invalidBatch = adminDb.batch()
      invalidFids.forEach((fid) => {
        const device = deviceByFid.get(fid)
        if (device) invalidBatch.delete(device.ref)
      })
      await invalidBatch.commit()
    }

    const successCount = successfulFids.size
    const failureCount = fids.length - successCount
    const state = failureCount === 0 ? 'sent' : successCount > 0 ? 'partial' : 'failed'
    await dispatchRef.set({
      state,
      successCount,
      failureCount,
      invalidDeviceCount: invalidFids.size,
      attemptCount: FieldValue.increment(attemptsUsed),
      errorCodes: [...new Set(finalErrors)].slice(0, 20),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return {
      state,
      successCount,
      failureCount,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : 'Lỗi FCM không xác định'
    await dispatchRef.set({
      state: 'failed',
      error: message,
      successCount: successfulFids.size,
      failureCount: fids.length - successfulFids.size,
      attemptCount: FieldValue.increment(Math.max(attemptsUsed, 1)),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return { state: 'failed', successCount: successfulFids.size, failureCount: fids.length - successfulFids.size }
  }
}
