import {
  collection,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
  type DocumentData,
  type Query,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  Notification,
  type StaffRequestShift,
  type StaffRequestType,
} from '@/lib/models/types'

const NOTIFICATIONS_COLLECTION = 'notifications'

export type ManagementPendingType = 'account' | 'schedule' | 'leave' | 'late' | 'salary' | 'staff'

export interface ManagementShift {
  date: Date
  shift: StaffRequestShift['shift']
  scheduleId?: string
}

export interface ManagementPendingItem {
  id: string
  type: ManagementPendingType
  employeeId: string
  employeeName: string
  employeeCode: string
  employeePhotoURL?: string
  employeePhone?: string
  employeeFacebookURL?: string
  title: string
  detail: string
  reason?: string
  createdAt: Date
  referenceDate: Date
  targetIds: string[]
  staffRequestType?: StaffRequestType
  shifts?: ManagementShift[]
  removedShifts?: ManagementShift[]
  restoredShifts?: ManagementShift[]
  warning?: string
  underMinimumWarning?: boolean
  penaltyIfApproved?: number
  penaltyIfRejected?: number
  violationLabel?: string
  proposedPenaltyAmount?: number
  managerMessageStatus?: 'messagedTri' | 'notMessaged' | 'messagedOtherManager'
}

function asDate(value: unknown, fallback = new Date(0)): Date {
  if (value instanceof Date) return value
  if (value instanceof Timestamp) return value.toDate()
  if (value && typeof value === 'object' && 'toDate' in value) {
    const converted = (value as { toDate: () => Date }).toDate()
    if (converted instanceof Date) return converted
  }
  return fallback
}

function shortDate(value: unknown): string {
  const date = asDate(value)
  return date.getTime() ? date.toLocaleDateString('vi-VN') : 'Chưa rõ ngày'
}

function weekRange(start: Date): string {
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return `${start.toLocaleDateString('vi-VN')} – ${end.toLocaleDateString('vi-VN')}`
}

function asShift(value: unknown): StaffRequestShift['shift'] | null {
  return value === 'Morning' || value === 'Afternoon' || value === 'Evening'
    ? value
    : null
}

function asShiftList(value: unknown, includeScheduleId = false): ManagementShift[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const row = entry as Record<string, unknown>
    const date = asDate(row.date)
    const shift = asShift(row.shift)
    if (!date.getTime() || !shift) return []
    return [{
      date,
      shift,
      ...(includeScheduleId && typeof (row.scheduleId || row.workScheduleId) === 'string'
        ? { scheduleId: String(row.scheduleId || row.workScheduleId) }
        : {}),
    }]
  })
}

function repairMojibake(value: unknown): string {
  if (typeof value !== 'string') return ''
  // A few notifications created by an older deployment were written after a
  // UTF-8/Windows-1252 conversion. Decode those values at the display edge so
  // the existing records remain readable without a destructive data migration.
  if (!/[ÃÂÄÅÆÐÑáº»¿�]/.test(value)) return value
  try {
    const bytes = Uint8Array.from(value, (character) => character.charCodeAt(0) & 0xff)
    const decoded = new TextDecoder('utf-8').decode(bytes)
    return decoded.includes('\uFFFD') ? value : decoded
  } catch {
    return value
  }
}

function normalizeNotification(id: string, data: DocumentData): Notification {
  let title = repairMojibake(data.title)
  let message = repairMojibake(data.message)
  if (id.startsWith('schedule-penalty-')) {
    const combined = `${title} ${message}`
    const amount = combined.match(/\d[\d.]*\s*[đd]/i)?.[0]?.replace(/d$/i, 'đ')
    const week = combined.match(/\d{2}\/\d{2}\s*[-–]\s*\d{2}\/\d{2}/)?.[0]
    title = 'Phát sinh khoản phạt đăng ký lịch trễ'
    message = amount
      ? `Khoản phạt ${amount} đã được ghi nhận${week ? ` cho lịch tuần ${week}` : ''}.`
      : 'Khoản phạt đăng ký lịch trễ đã được ghi nhận. Mở Khoản phạt để xem chi tiết.'
  } else if (id.startsWith('schedule-change-penalty-')) {
    const combined = `${title} ${message}`
    const amount = combined.match(/\d[\d.]*\s*[đd]/i)?.[0]?.replace(/d$/i, 'đ')
    title = 'Phát sinh khoản phạt đổi lịch trong ngày'
    message = amount
      ? `Khoản phạt ${amount} đã được ghi nhận.`
      : 'Khoản phạt đổi lịch trong ngày đã được ghi nhận. Mở Khoản phạt để xem chi tiết.'
  }
  return { id, ...data, title, message } as Notification
}

/**
 * Get all notifications for an employee
 */
export async function getEmployeeNotifications(employeeId: string): Promise<Notification[]> {
  try {
    const q = query(
      collection(db, NOTIFICATIONS_COLLECTION),
      where('employeeId', '==', employeeId),
      orderBy('createdAt', 'desc')
    )

    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map((item) => normalizeNotification(item.id, item.data()))
  } catch (error) {
    console.error('Error fetching employee notifications:', error)
    throw error
  }
}

/**
 * Get unread notifications for an employee
 */
export async function getUnreadNotifications(employeeId: string): Promise<Notification[]> {
  try {
    const q = query(
      collection(db, NOTIFICATIONS_COLLECTION),
      where('employeeId', '==', employeeId),
      where('isRead', '==', false),
      orderBy('createdAt', 'desc')
    )

    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map((item) => normalizeNotification(item.id, item.data()))
  } catch (error) {
    console.error('Error fetching unread notifications:', error)
    throw error
  }
}

/**
 * Mark notification as read
 */
export async function markNotificationAsRead(notificationId: string): Promise<void> {
  try {
    const docRef = doc(db, NOTIFICATIONS_COLLECTION, notificationId)
    await updateDoc(docRef, {
      isRead: true,
    })
  } catch (error) {
    console.error('Error marking notification as read:', error)
    throw error
  }
}

/**
 * Mark all notifications as read for an employee
 */
export async function markAllNotificationsAsRead(employeeId: string): Promise<void> {
  try {
    const notifications = await getUnreadNotifications(employeeId)
    const updatePromises = notifications.map((notification) =>
      updateDoc(doc(db, NOTIFICATIONS_COLLECTION, notification.id!), { isRead: true })
    )
    await Promise.all(updatePromises)
  } catch (error) {
    console.error('Error marking all notifications as read:', error)
    throw error
  }
}

/**
 * Delete notification
 */
export async function deleteNotification(notificationId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, NOTIFICATIONS_COLLECTION, notificationId))
  } catch (error) {
    console.error('Error deleting notification:', error)
    throw error
  }
}

/**
 * Subscribe to real-time notifications for an employee
 */
export function subscribeToEmployeeNotifications(
  employeeId: string,
  callback: (notifications: Notification[]) => void
): () => void {
  const q = query(
    collection(db, NOTIFICATIONS_COLLECTION),
    where('employeeId', '==', employeeId),
    orderBy('createdAt', 'desc')
  )

  const unsubscribe = onSnapshot(q, (querySnapshot) => {
    const notifications = querySnapshot.docs.map((item) => normalizeNotification(item.id, item.data()))
    callback(notifications)
  })

  return unsubscribe
}

/**
 * The manager badge represents work that still needs a decision, not whether
 * the notification page has been opened. It therefore follows workflow
 * statuses directly and also covers pending records created before manager
 * notifications were introduced.
 */
export function subscribeToManagementPendingCount(
  callback: (count: number) => void,
  includeAccountApprovals = true
): () => void {
  return subscribeToManagementPendingItems((items) => {
    const start = new Date()
    start.setDate(start.getDate() - 5)
    start.setHours(0, 0, 0, 0)
    callback(items.filter((item) => item.createdAt >= start && (includeAccountApprovals || item.type !== 'account')).length)
  })
}

/**
 * Build the manager inbox directly from workflow records. This is intentionally
 * the same source used by the badge so the number and the visible cards cannot
 * drift apart when older records do not have a notification document.
 */
export function subscribeToManagementPendingItems(
  callback: (items: ManagementPendingItem[]) => void,
  onError?: (error: Error) => void
): () => void {
  const state: Record<string, Array<{ id: string; data: Record<string, unknown> }>> = {
    employees: [],
    schedules: [],
    leaveRequests: [],
    lateRequests: [],
    salaryAdvances: [],
    staffRequests: [],
    penalties: [],
  }

  const now = new Date()
  const daysUntilNextMonday = ((8 - now.getDay()) % 7) || 7
  const nextMonday = new Date(now)
  nextMonday.setDate(now.getDate() + daysUntilNextMonday)
  nextMonday.setHours(0, 0, 0, 0)
  const nextSunday = new Date(nextMonday)
  nextSunday.setDate(nextMonday.getDate() + 6)
  nextSunday.setHours(23, 59, 59, 999)

  const publish = () => {
    const penalties = new Map(state.penalties.map(({ id, data }) => [id, data]))
    const employees = new Map(
      state.employees.map(({ id, data }) => [
        id,
        {
          name: typeof data.fullName === 'string' ? data.fullName : 'Nhân viên',
          code: typeof data.employeeCode === 'string' ? data.employeeCode : '',
          photoURL: typeof data.photoURL === 'string' ? data.photoURL : '',
          phone: typeof data.phone === 'string' ? data.phone : '',
          facebookURL: typeof data.facebookUrl === 'string' ? data.facebookUrl : '',
        },
      ])
    )
    const identity = (employeeId: string) => employees.get(employeeId) || {
      name: 'Nhân viên',
      code: employeeId.slice(0, 8),
      photoURL: '',
      phone: '',
      facebookURL: '',
    }
    const activeEmployeeIds = new Set(
      state.employees.filter(({ data }) => data.status === 'active').map(({ id }) => id)
    )
    const items: ManagementPendingItem[] = []

    state.employees
      .filter(({ data }) => data.status === 'pending' && data.role === 'employee')
      .forEach(({ id, data }) => items.push({
        id: `account-${id}`,
        type: 'account',
        employeeId: id,
        employeeName: typeof data.fullName === 'string' ? data.fullName : 'Nhân viên mới',
        employeeCode: typeof data.employeeCode === 'string' ? data.employeeCode : '',
        employeePhotoURL: typeof data.photoURL === 'string' ? data.photoURL : '',
        employeePhone: typeof data.phone === 'string' ? data.phone : '',
        employeeFacebookURL: typeof data.facebookUrl === 'string' ? data.facebookUrl : '',
        title: 'Tài khoản mới chờ duyệt',
        detail: typeof data.email === 'string' ? data.email : 'Hồ sơ nhân viên mới',
        createdAt: asDate(data.updatedAt || data.createdAt),
        referenceDate: asDate(data.updatedAt || data.createdAt),
        targetIds: [id],
      }))

    const scheduleBatches = new Map<string, Array<{ id: string; data: Record<string, unknown> }>>()
    state.schedules.forEach((row) => {
      const date = asDate(row.data.date)
      if (!date.getTime() || date < nextMonday || date > nextSunday) return
      const employeeId = String(row.data.employeeId || '')
      if (!activeEmployeeIds.has(employeeId)) return
      const key = String(row.data.batchKey || `${employeeId}-${nextMonday.toISOString().slice(0, 10)}`)
      scheduleBatches.set(key, [...(scheduleBatches.get(key) || []), row])
    })
    scheduleBatches.forEach((rows, batchKey) => {
      const employeeId = String(rows[0].data.employeeId || '')
      const employee = identity(employeeId)
      const createdAt = rows.reduce(
        (latest, row) => {
          const value = asDate(row.data.updatedAt || row.data.createdAt)
          return value > latest ? value : latest
        },
        new Date(0)
      )
      const penalty = rows
        .map((row) => typeof row.data.penaltyId === 'string' ? penalties.get(row.data.penaltyId) : undefined)
        .find((item) => item && Number(item.amount || 0) > 0)
      items.push({
        id: `schedule-${batchKey}`,
        type: 'schedule',
        employeeId,
        employeeName: employee.name,
        employeeCode: employee.code,
        employeePhotoURL: employee.photoURL,
        employeePhone: employee.phone,
        employeeFacebookURL: employee.facebookURL,
        title: 'Lịch làm chờ xác nhận',
        detail: `${rows.length} ca · tuần ${weekRange(nextMonday)}`,
        createdAt,
        referenceDate: nextMonday,
        targetIds: rows.map((row) => row.id),
        shifts: rows.flatMap((row) => {
          const date = asDate(row.data.date)
          const shift = asShift(row.data.shift)
          return date.getTime() && shift ? [{ date, shift, scheduleId: row.id }] : []
        }),
        warning: rows.some((row) => row.data.underMinimumWarning === true)
          ? `Lịch chỉ có ${rows.filter((row) => !String(row.data.note || '').includes('[DUTY_ONLY]')).length}/6 ca tối thiểu.`
          : undefined,
        violationLabel: penalty ? 'Đăng ký lịch trễ' : undefined,
        proposedPenaltyAmount: penalty ? Number(penalty.amount || 0) : undefined,
      })
    })

    state.leaveRequests.forEach(({ id, data }) => {
      const employeeId = String(data.employeeId || '')
      if (!activeEmployeeIds.has(employeeId)) return
      const employee = identity(employeeId)
      const endDate = data.endDate ? ` – ${shortDate(data.endDate)}` : ''
      items.push({
        id: `leave-${id}`,
        type: 'leave',
        employeeId,
        employeeName: employee.name,
        employeeCode: employee.code,
        employeePhotoURL: employee.photoURL,
        employeePhone: employee.phone,
        employeeFacebookURL: employee.facebookURL,
        title: 'Yêu cầu xin nghỉ',
        detail: `${shortDate(data.leaveDate)}${endDate}`,
        reason: typeof data.reason === 'string' && data.reason.trim() ? data.reason : 'Không ghi lý do',
        createdAt: asDate(data.updatedAt || data.createdAt),
        referenceDate: asDate(data.leaveDate, asDate(data.updatedAt || data.createdAt)),
        targetIds: [id],
        warning: data.underMinimumWarning === true
          ? `Nếu duyệt nghỉ: tuần này còn ${Number(data.weeklyShiftCountAfterLeave || 0)}/6 ca.`
          : data.noticeClass === 'late' ? 'Yêu cầu được gửi sau 16:00 của ngày hôm trước.' : undefined,
        underMinimumWarning: data.underMinimumWarning === true,
        penaltyIfApproved: Number(data.penaltyIfApproved || 0),
        penaltyIfRejected: Number(data.penaltyIfRejected || 0),
        violationLabel: data.noticeClass === 'late'
          ? 'Báo nghỉ sát hạn'
          : data.underMinimumWarning === true ? 'Nghỉ làm tuần này dưới 6 ca' : undefined,
        proposedPenaltyAmount: Number(data.penaltyIfApproved || 0),
      })
    })

    state.lateRequests.forEach(({ id, data }) => {
      const employeeId = String(data.employeeId || '')
      if (!activeEmployeeIds.has(employeeId)) return
      const employee = identity(employeeId)
      const minutes = typeof data.lateMinutes === 'number' ? `${data.lateMinutes} phút` : 'Chưa rõ số phút'
      const shifts = asShiftList(data.lateEntries, true)
      const lateDetail = shifts.length > 1
        ? `${shifts.length} ca · trễ ${minutes}`
        : `${shortDate(data.date)} · ${minutes}`
      items.push({
        id: `late-${id}`,
        type: 'late',
        employeeId,
        employeeName: employee.name,
        employeeCode: employee.code,
        employeePhotoURL: employee.photoURL,
        employeePhone: employee.phone,
        employeeFacebookURL: employee.facebookURL,
        title: 'Yêu cầu đi trễ',
        detail: lateDetail,
        reason: typeof data.reason === 'string' && data.reason.trim() ? data.reason : 'Không ghi lý do',
        createdAt: asDate(data.updatedAt || data.createdAt),
        referenceDate: asDate(data.date, asDate(data.updatedAt || data.createdAt)),
        targetIds: [id],
        shifts: shifts.length ? shifts : undefined,
        warning: data.noticeClass === 'late' ? 'Báo đi trễ dưới 60 phút trước ca.' : undefined,
        penaltyIfApproved: Number(data.penaltyIfApproved || 0),
        penaltyIfRejected: Number(data.penaltyIfRejected || 0),
        violationLabel: data.noticeClass === 'late' ? 'Báo đi trễ sát giờ' : undefined,
        proposedPenaltyAmount: Number(data.penaltyIfApproved || 0),
        managerMessageStatus: data.managerMessageStatus === 'messagedTri' || data.managerMessageStatus === 'notMessaged' || data.managerMessageStatus === 'messagedOtherManager'
          ? data.managerMessageStatus
          : undefined,
      })
    })

    state.salaryAdvances.forEach(({ id, data }) => {
      const employeeId = String(data.employeeId || '')
      if (!activeEmployeeIds.has(employeeId)) return
      const employee = identity(employeeId)
      const amount = typeof data.amount === 'number' ? data.amount : Number(data.amount || 0)
      items.push({
        id: `salary-${id}`,
        type: 'salary',
        employeeId,
        employeeName: employee.name,
        employeeCode: employee.code,
        employeePhotoURL: employee.photoURL,
        employeePhone: employee.phone,
        employeeFacebookURL: employee.facebookURL,
        title: 'Yêu cầu ứng lương',
        detail: `${amount.toLocaleString('vi-VN')}đ`,
        reason: typeof data.reason === 'string' && data.reason.trim() ? data.reason : 'Không ghi lý do',
        createdAt: asDate(data.updatedAt || data.createdAt),
        referenceDate: asDate(data.updatedAt || data.createdAt),
        targetIds: [id],
      })
    })

    state.staffRequests.forEach(({ id, data }) => {
      const employeeId = String(data.employeeId || '')
      if (!activeEmployeeIds.has(employeeId)) return
      const employee = identity(employeeId)
      const requestType = data.type === 'overtime' || data.type === 'scheduleChange' || data.type === 'scheduleModeChange' || data.type === 'note'
        ? data.type
        : 'note'
      const shifts = asShiftList(data.shifts)
      const removedShifts = asShiftList(data.removedShifts, true)
      const restoredShifts = asShiftList(data.restoredShifts, true)
      const title = requestType === 'overtime'
        ? 'Yêu cầu làm thêm'
        : requestType === 'scheduleChange'
          ? 'Yêu cầu đổi / thêm ca'
          : requestType === 'scheduleModeChange'
            ? 'Yêu cầu đổi chế độ làm việc'
          : 'Ghi chú từ nhân viên'
      const detail = requestType === 'scheduleChange'
        ? `${removedShifts.length} ca muốn hủy · ${restoredShifts.length} ca xin đi làm lại · ${shifts.length} ca muốn thêm`
        : requestType === 'scheduleModeChange'
          ? `${data.previousScheduleMode === 'fixed' ? 'Cố định' : 'Xoay ca'} → ${data.requestedScheduleMode === 'fixed' ? 'Cố định' : 'Xoay ca'} · áp dụng từ tuần ${shortDate(data.weekStart)}`
        : requestType === 'overtime'
          ? `${shifts.length} ca muốn làm thêm`
          : 'Nội dung cần quản lý xem xét'
      items.push({
        id: `staff-${id}`,
        type: 'staff',
        employeeId,
        employeeName: employee.name,
        employeeCode: employee.code,
        employeePhotoURL: employee.photoURL,
        employeePhone: employee.phone,
        employeeFacebookURL: employee.facebookURL,
        title,
        detail,
        reason: typeof data.content === 'string' && data.content.trim() ? data.content : undefined,
        createdAt: asDate(data.updatedAt || data.createdAt),
        referenceDate: shifts[0]?.date || restoredShifts[0]?.date || removedShifts[0]?.date || asDate(data.weekStart || data.updatedAt || data.createdAt),
        targetIds: [id],
        staffRequestType: requestType,
        shifts,
        removedShifts,
        restoredShifts,
      })
    })

    callback(items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()))
  }

  const watch = (key: keyof typeof state, source: Query<DocumentData>) =>
    onSnapshot(
      source,
      (snapshot) => {
        state[key] = snapshot.docs.map((item) => ({
          id: item.id,
          data: item.data() as Record<string, unknown>,
        }))
        publish()
      },
      (error) => onError?.(error)
    )

  const pendingQuery = (collectionName: string) => query(
    collection(db, collectionName),
    where('status', '==', 'Pending')
  )
  const unsubscribes = [
    watch('employees', query(collection(db, 'employees'))),
    watch('schedules', query(
      collection(db, 'workSchedules'),
      where('status', 'in', ['Pending', 'Registered'])
    )),
    watch('leaveRequests', pendingQuery('leaveRequests')),
    watch('lateRequests', pendingQuery('lateRequests')),
    watch('salaryAdvances', pendingQuery('salaryAdvances')),
    watch('staffRequests', pendingQuery('staffRequests')),
    watch('penalties', query(collection(db, 'penalties'))),
  ]

  return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
}

/**
 * Get count of unread notifications for an employee
 */
export async function getUnreadNotificationCount(employeeId: string): Promise<number> {
  try {
    const unreadNotifications = await getUnreadNotifications(employeeId)
    return unreadNotifications.length
  } catch (error) {
    console.error('Error fetching unread notification count:', error)
    throw error
  }
}
