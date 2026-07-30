import { collection, onSnapshot, orderBy, query, Timestamp, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'

export type DecisionResource = 'leave' | 'late' | 'salary' | 'staff' | 'schedule'
export type DecisionStatus = 'Approved' | 'Rejected'

export interface DecisionHistoryItem {
  key: string
  id: string
  ids: string[]
  resource: DecisionResource
  employeeId: string
  title: string
  detail: string
  status: DecisionStatus
  reviewNote: string
  reviewedAt: Date
}

type SnapshotRow = Record<string, unknown> & { id: string }

function asDate(value: unknown): Date {
  if (value instanceof Date) return value
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate()
  }
  return new Date(0)
}

function dateLabel(value: unknown): string {
  const date = asDate(value)
  return date.getTime() ? date.toLocaleDateString('vi-VN') : 'Chưa rõ ngày'
}

function mondayKey(value: unknown): string {
  const date = asDate(value)
  const day = date.getDay() || 7
  date.setDate(date.getDate() - day + 1)
  date.setHours(0, 0, 0, 0)
  return date.toISOString().slice(0, 10)
}

function processed(row: SnapshotRow): row is SnapshotRow & { status: DecisionStatus } {
  return row.status === 'Approved' || row.status === 'Rejected'
}

function buildRows(data: Record<DecisionResource, SnapshotRow[]>): DecisionHistoryItem[] {
  const rows: DecisionHistoryItem[] = []

  data.leave.filter(processed).forEach((item) => rows.push({
    key: `leave-${item.id}`,
    id: item.id,
    ids: [item.id],
    resource: 'leave',
    employeeId: String(item.employeeId || ''),
    title: 'Yêu cầu xin nghỉ',
    detail: `${dateLabel(item.leaveDate)} · ${String(item.reason || 'Không có ghi chú')}`,
    status: item.status,
    reviewNote: String(item.reviewNote || ''),
    reviewedAt: asDate(item.reviewedAt),
  }))

  data.late.filter(processed).forEach((item) => rows.push({
    key: `late-${item.id}`,
    id: item.id,
    ids: [item.id],
    resource: 'late',
    employeeId: String(item.employeeId || ''),
    title: 'Yêu cầu đi trễ',
    detail: `${dateLabel(item.date)} · ${Number(item.lateMinutes || 0)} phút · ${String(item.reason || 'Không có ghi chú')}`,
    status: item.status,
    reviewNote: String(item.reviewNote || ''),
    reviewedAt: asDate(item.reviewedAt),
  }))

  data.salary.filter(processed).forEach((item) => rows.push({
    key: `salary-${item.id}`,
    id: item.id,
    ids: [item.id],
    resource: 'salary',
    employeeId: String(item.employeeId || ''),
    title: 'Yêu cầu ứng lương',
    detail: `${Number(item.amount || 0).toLocaleString('vi-VN')}đ · ${String(item.reason || 'Không có ghi chú')}`,
    status: item.status,
    reviewNote: String(item.reviewNote || ''),
    reviewedAt: asDate(item.reviewedAt),
  }))

  data.staff.filter(processed).forEach((item) => rows.push({
    key: `staff-${item.id}`,
    id: item.id,
    ids: [item.id],
    resource: 'staff',
    employeeId: String(item.employeeId || ''),
    title: item.type === 'scheduleChange' ? 'Yêu cầu đổi / thêm ca' : item.type === 'overtime' ? 'Yêu cầu làm thêm' : 'Ghi chú cho quản lý',
    detail: item.type === 'overtime'
      ? `${Array.isArray(item.shifts) ? item.shifts.length : 0} ca · ${String(item.content || 'Không có ghi chú')}`
      : String(item.content || 'Không có nội dung'),
    status: item.status,
    reviewNote: String(item.reviewNote || ''),
    reviewedAt: asDate(item.reviewedAt),
  }))

  const scheduleGroups = new Map<string, SnapshotRow[]>()
  data.schedule.filter(processed).filter((item) => !item.id.startsWith('overtime-')).forEach((item) => {
    const key = String(item.batchKey || `${item.employeeId}-${mondayKey(item.date)}`)
    const current = scheduleGroups.get(key)
    if (current) current.push(item)
    else scheduleGroups.set(key, [item])
  })
  scheduleGroups.forEach((items, batchKey) => {
    const sorted = [...items].sort((left, right) => asDate(left.date).getTime() - asDate(right.date).getTime())
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    const reviewedAt = sorted.reduce((latest, item) => {
      const current = asDate(item.reviewedAt)
      return current > latest ? current : latest
    }, new Date(0))
    rows.push({
      key: `schedule-${batchKey}`,
      id: first.id,
      ids: sorted.map((item) => item.id),
      resource: 'schedule',
      employeeId: String(first.employeeId || ''),
      title: 'Bảng đăng ký lịch',
      detail: `${sorted.length} ca · ${dateLabel(first.date)}–${dateLabel(last.date)}`,
      status: first.status as DecisionStatus,
      reviewNote: String(first.reviewNote || ''),
      reviewedAt,
    })
  })

  return rows.sort((left, right) => right.reviewedAt.getTime() - left.reviewedAt.getTime())
}

export function subscribeToWeeklyDecisionHistory(
  start: Date,
  end: Date,
  callback: (items: DecisionHistoryItem[]) => void,
  onError?: (error: Error) => void
): () => void {
  const sources: Array<{ resource: DecisionResource; collectionName: string }> = [
    { resource: 'leave', collectionName: 'leaveRequests' },
    { resource: 'late', collectionName: 'lateRequests' },
    { resource: 'salary', collectionName: 'salaryAdvances' },
    { resource: 'staff', collectionName: 'staffRequests' },
    { resource: 'schedule', collectionName: 'workSchedules' },
  ]
  const data: Record<DecisionResource, SnapshotRow[]> = {
    leave: [], late: [], salary: [], staff: [], schedule: [],
  }
  const ready = new Set<DecisionResource>()
  const startTimestamp = Timestamp.fromDate(start)
  const endTimestamp = Timestamp.fromDate(end)

  const unsubscribers = sources.map(({ resource, collectionName }) => onSnapshot(
    query(
      collection(db, collectionName),
      where('reviewedAt', '>=', startTimestamp),
      where('reviewedAt', '<=', endTimestamp),
      orderBy('reviewedAt', 'desc')
    ),
    (snapshot) => {
      data[resource] = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      ready.add(resource)
      if (ready.size === sources.length) callback(buildRows(data))
    },
    (error) => onError?.(error)
  ))

  return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
}
