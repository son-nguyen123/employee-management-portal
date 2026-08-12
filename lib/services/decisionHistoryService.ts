import { collection, onSnapshot, orderBy, query, Timestamp, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { FACTORY_LABELS, isFactoryId } from '@/lib/models/factory'

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
  weeklyShiftCount?: number
  underMinimumWarning?: boolean
  autoApproved?: boolean
  penaltyId?: string | null
  penaltyAmount?: number
  reason?: string
  shifts?: Array<{ date: Date; shift: 'Morning' | 'Afternoon' | 'Evening' }>
  removedShifts?: Array<{ date: Date; shift: 'Morning' | 'Afternoon' | 'Evening'; scheduleId?: string }>
  restoredShifts?: Array<{ date: Date; shift: 'Morning' | 'Afternoon' | 'Evening'; scheduleId?: string }>
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

function weekRange(value: unknown): { start: Date; end: Date } {
  const start = asDate(value)
  const day = start.getDay() || 7
  start.setDate(start.getDate() - day + 1)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return { start, end }
}

function processed(row: SnapshotRow): row is SnapshotRow & { status: DecisionStatus } {
  return row.status === 'Approved' || row.status === 'Rejected'
}

function decisionShifts(value: unknown, includeScheduleId = false): Array<{ date: Date; shift: 'Morning' | 'Afternoon' | 'Evening'; scheduleId?: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const row = entry as Record<string, unknown>
    const date = asDate(row.date)
    const shift = row.shift
    if (!date.getTime() || !['Morning', 'Afternoon', 'Evening'].includes(String(shift))) return []
    return [{ date, shift: shift as 'Morning' | 'Afternoon' | 'Evening', ...(includeScheduleId && typeof row.scheduleId === 'string' ? { scheduleId: row.scheduleId } : {}) }]
  })
}

function buildRows(data: Record<DecisionResource, SnapshotRow[]>, penaltyRows: SnapshotRow[] = []): DecisionHistoryItem[] {
  const rows: DecisionHistoryItem[] = []
  const penaltyById = new Map(penaltyRows.map((item) => [item.id, item]))

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
    reason: String(item.reason || ''),
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
    reason: String(item.reason || ''),
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
    reason: String(item.reason || ''),
  }))

  data.staff.filter(processed).forEach((item) => rows.push({
    key: `staff-${item.id}`,
    id: item.id,
    ids: [item.id],
    resource: 'staff',
    employeeId: String(item.employeeId || ''),
    title: item.type === 'scheduleModeChange'
      ? 'Yêu cầu đổi chế độ làm việc'
      : item.type === 'factoryChange' ? 'Yêu cầu đổi xưởng'
      : item.type === 'scheduleChange' ? 'Yêu cầu đổi / thêm ca' : item.type === 'overtime' ? 'Yêu cầu làm thêm' : 'Ghi chú cho quản lý',
    detail: item.type === 'scheduleModeChange'
      ? `${item.previousScheduleMode === 'fixed' ? 'Cố định' : 'Xoay ca'} → ${item.requestedScheduleMode === 'fixed' ? 'Cố định' : 'Xoay ca'} · ${String(item.content || 'Không có ghi chú')}`
      : item.type === 'factoryChange'
      ? `${FACTORY_LABELS[isFactoryId(item.previousFactoryId) ? item.previousFactoryId : 'factory-1']} → ${FACTORY_LABELS[isFactoryId(item.requestedFactoryId) ? item.requestedFactoryId : 'factory-1']} · ${String(item.content || 'Không có ghi chú')}`
      : item.type === 'overtime'
      ? `${Array.isArray(item.shifts) ? item.shifts.length : 0} ca · ${String(item.content || 'Không có ghi chú')}`
      : String(item.content || 'Không có nội dung'),
    status: item.status,
    reviewNote: String(item.reviewNote || ''),
    reviewedAt: asDate(item.reviewedAt),
    reason: String(item.content || ''),
    shifts: decisionShifts(item.shifts),
    removedShifts: decisionShifts(item.removedShifts, true),
    restoredShifts: decisionShifts(item.restoredShifts, true),
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
    const actualShiftCount = sorted.filter((item) => !String(item.note || '').includes('[DUTY_ONLY]') && !String(item.note || '').includes('[NO_SHIFTS]')).length
    const directPenaltyId = String(sorted.find((item) => item.penaltyId)?.penaltyId || '') || null
    const { start: weekStart, end: weekEnd } = weekRange(first.date)
    const fallbackPenalty = penaltyRows.find((penalty) => {
      if (penalty.status === 'Cancelled' || penalty.sourceType !== 'scheduleSubmission') return false
      if (String(penalty.employeeId || '') !== String(first.employeeId || '')) return false
      const penaltyDate = asDate(penalty.penaltyDate)
      return penaltyDate >= weekStart && penaltyDate < weekEnd && Number(penalty.amount || 0) > 0
    })
    const directPenalty = directPenaltyId ? penaltyById.get(directPenaltyId) : undefined
    const penaltyRecord = (directPenalty && directPenalty.status !== 'Cancelled' ? directPenalty : undefined) || fallbackPenalty
    const penaltyId = directPenaltyId || (penaltyRecord ? penaltyRecord.id : null)
    const penaltyAmount = Math.max(
      0,
      ...sorted.map((item) => Number(item.penaltyAmount || 0)),
      ...(penaltyRecord ? [Number(penaltyRecord.amount || 0)] : [])
    )
    rows.push({
      key: `schedule-${batchKey}`,
      id: first.id,
      ids: sorted.map((item) => item.id),
      resource: 'schedule',
      employeeId: String(first.employeeId || ''),
      title: 'Bảng đăng ký lịch',
      detail: `${actualShiftCount} ca · ${dateLabel(first.date)}–${dateLabel(last.date)}`,
      status: first.status as DecisionStatus,
      reviewNote: String(first.reviewNote || ''),
      reviewedAt,
      weeklyShiftCount: Number(first.weeklyShiftCount ?? actualShiftCount),
      underMinimumWarning: items.some((item) => item.underMinimumWarning === true),
      autoApproved: items.every((item) => item.autoApproved === true),
      penaltyId,
      penaltyAmount: penaltyAmount || undefined,
      reason: String(first.note || '').replace(/\[[A-Z_]+(?::[^\]]+)?\]/g, '').trim(),
      shifts: sorted.flatMap((item) => {
        const date = asDate(item.date)
        const shift = item.shift
        return date.getTime() && ['Morning', 'Afternoon', 'Evening'].includes(String(shift))
          ? [{ date, shift: shift as 'Morning' | 'Afternoon' | 'Evening' }]
          : []
      }),
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
  let penaltyRows: SnapshotRow[] = []
  let penaltiesReady = false
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
      if (ready.size === sources.length && penaltiesReady) callback(buildRows(data, penaltyRows))
    },
    (error) => onError?.(error)
  ))

  const unsubscribePenalties = onSnapshot(
    query(
      collection(db, 'penalties'),
      where('penaltyDate', '>=', startTimestamp),
      where('penaltyDate', '<=', endTimestamp),
      orderBy('penaltyDate', 'desc')
    ),
    (snapshot) => {
      penaltyRows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      penaltiesReady = true
      if (ready.size === sources.length) callback(buildRows(data, penaltyRows))
    },
    (error) => {
      penaltiesReady = true
      if (ready.size === sources.length) callback(buildRows(data, penaltyRows))
      onError?.(error)
    }
  )

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe())
    unsubscribePenalties()
  }
}
