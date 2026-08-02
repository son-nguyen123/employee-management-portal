import 'server-only'

import { Timestamp, type DocumentData, type QueryDocumentSnapshot } from 'firebase-admin/firestore'
import type { EmployeeReviewContext, EmployeeReviewLevel, EmployeeReviewWeek } from '@/lib/models/employeeReview'
import { adminDb } from '@/lib/server/firebase-admin'
import { listWeeklyArchives, readWeeklyArchive } from '@/lib/server/google-drive-archive'
import { workflowPolicy } from '@/lib/server/workflow-policy'

type ReviewCollection = 'workSchedules' | 'leaveRequests' | 'lateRequests'

interface ReviewRecord {
  path: string
  collection: ReviewCollection
  data: Record<string, unknown>
  source: 'firestore' | 'drive'
}

interface ArchivePayload {
  records?: Partial<Record<ReviewCollection, Array<{
    path?: unknown
    data?: unknown
  }>>>
}

const DAY_MS = 24 * 60 * 60 * 1000
const ACTIVE_SCHEDULE_STATUSES = new Set(['Registered', 'Pending', 'Editing', 'ChangesRequested', 'Approved'])
const ACTIVE_REQUEST_STATUSES = new Set(['Pending', 'AwaitingEmployeeConsent', 'Approved'])

function dateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function mondayKey(date: Date): string {
  const localDate = new Date(`${dateKey(date)}T12:00:00+07:00`)
  const weekday = localDate.getUTCDay() || 7
  localDate.setUTCDate(localDate.getUTCDate() - weekday + 1)
  return dateKey(localDate)
}

function dateForKey(key: string): Date {
  return new Date(`${key}T00:00:00+07:00`)
}

function shiftKey(key: string, days: number): string {
  return dateKey(new Date(dateForKey(key).getTime() + days * DAY_MS))
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (value instanceof Timestamp) return value.toDate()
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const parsed = value.toDate()
    return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null
  }
  return null
}

function firestoreRecord(collection: ReviewCollection, snapshot: QueryDocumentSnapshot<DocumentData>): ReviewRecord {
  return {
    path: snapshot.ref.path,
    collection,
    data: snapshot.data() as Record<string, unknown>,
    source: 'firestore',
  }
}

function archiveRecords(payload: unknown, employeeId: string): ReviewRecord[] {
  if (!payload || typeof payload !== 'object') return []
  const records = (payload as ArchivePayload).records
  if (!records || typeof records !== 'object') return []
  const collections: ReviewCollection[] = ['workSchedules', 'leaveRequests', 'lateRequests']
  return collections.flatMap((collection) => {
    const rows = records[collection]
    if (!Array.isArray(rows)) return []
    return rows.flatMap((row) => {
      if (!row || typeof row !== 'object' || typeof row.path !== 'string' || !row.data || typeof row.data !== 'object') return []
      const data = row.data as Record<string, unknown>
      if (data.employeeId !== employeeId) return []
      return [{ path: row.path, collection, data, source: 'drive' as const }]
    })
  })
}

function recordDate(record: ReviewRecord): Date | null {
  if (record.collection === 'workSchedules' || record.collection === 'lateRequests') return asDate(record.data.date)
  return asDate(record.data.leaveDate)
}

function sourceFor(records: ReviewRecord[]): EmployeeReviewWeek['source'] {
  const sources = new Set(records.map((record) => record.source))
  if (!sources.size) return 'none'
  if (sources.size > 1) return 'mixed'
  return sources.has('firestore') ? 'firestore' : 'drive'
}

function buildWeeks(records: ReviewRecord[], referenceWeekStart: string): EmployeeReviewWeek[] {
  const weekKeys = Array.from({ length: 4 }, (_, index) => shiftKey(referenceWeekStart, (index - 3) * 7))
  return weekKeys.map((weekStart) => {
    const weekEndExclusive = shiftKey(weekStart, 7)
    const rows = records.filter((record) => {
      const date = recordDate(record)
      if (!date) return false
      const key = dateKey(date)
      return key >= weekStart && key < weekEndExclusive
    })
    const schedules = rows.filter((record) => record.collection === 'workSchedules' && !String(record.data.note || '').includes('[DUTY_ONLY]'))
    const leaves = rows.filter((record) => record.collection === 'leaveRequests' && ACTIVE_REQUEST_STATUSES.has(String(record.data.status)))
    const lateRequests = rows.filter((record) => record.collection === 'lateRequests' && ACTIVE_REQUEST_STATUSES.has(String(record.data.status)))
    const shortNoticeLeaves = leaves.filter((record) => record.data.noticeClass === 'late').length
    const shortNoticeLate = lateRequests.filter((record) =>
      Number(record.data.noticeMinutes ?? workflowPolicy.lateNoticeMinutes) < workflowPolicy.lateNoticeMinutes ||
      record.data.managerMessageStatus === 'notMessaged' ||
      record.data.managerMessageStatus === 'messagedOtherManager'
    ).length
    return {
      weekStart,
      weekEnd: shiftKey(weekStart, 6),
      scheduledShifts: schedules.filter((record) => ACTIVE_SCHEDULE_STATUSES.has(String(record.data.status))).length,
      approvedShifts: schedules.filter((record) => record.data.status === 'Approved').length,
      leaveRequests: leaves.length,
      approvedLeaveRequests: leaves.filter((record) => record.data.status === 'Approved').length,
      lateRequests: lateRequests.length,
      shortNoticeEvents: shortNoticeLeaves + shortNoticeLate,
      hasLongLeave: leaves.some((record) => record.data.duration === 'long'),
      source: sourceFor(rows),
    }
  })
}

function assessment(weeks: EmployeeReviewWeek[], minimum: number): {
  level: EmployeeReviewLevel
  headline: string
  explanation: string
  facts: string[]
} {
  const observed = weeks.filter((week) => week.source !== 'none')
  const eligible = observed.filter((week) => week.scheduledShifts > 0)
  const underMinimum = eligible.filter((week) => week.scheduledShifts < minimum)
  const leaveRequests = weeks.reduce((total, week) => total + week.leaveRequests, 0)
  const lateRequests = weeks.reduce((total, week) => total + week.lateRequests, 0)
  const shortNoticeEvents = weeks.reduce((total, week) => total + week.shortNoticeEvents, 0)
  const longLeaveWeeks = weeks.filter((week) => week.hasLongLeave).length
  const facts = [
    `${eligible.length} tuần có lịch được ghi nhận trong cửa sổ 4 tuần.`,
    `${underMinimum.length} tuần có lịch dưới mức ${minimum} ca.`,
    `${leaveRequests} yêu cầu nghỉ · ${lateRequests} thông báo đi trễ · ${shortNoticeEvents} lần báo sát hạn/chưa nhắn đúng quản lý.`,
  ]
  if (longLeaveWeeks) facts.push(`${longLeaveWeeks} tuần có dữ liệu nghỉ dài hạn; đây là ngữ cảnh để quản lý xem thêm, không tạo ngoại lệ mới cho luật hiện tại.`)

  if (!observed.length) {
    return {
      level: 'neutral',
      headline: 'Chưa đủ dữ liệu để đánh giá',
      explanation: 'Không tìm thấy lịch hoặc yêu cầu liên quan trong 4 tuần đang kiểm tra.',
      facts,
    }
  }
  if (underMinimum.length >= 2 && (shortNoticeEvents >= 1 || lateRequests >= 2)) {
    return {
      level: 'warning',
      headline: 'Cần xem kỹ trước khi quyết định',
      explanation: 'Có nhiều tuần lịch dưới mức tối thiểu và đồng thời xuất hiện tình huống báo sát hạn hoặc đi trễ. Đây là cảnh báo để quản lý đọc ngữ cảnh, không phải kết luận nhân viên không tốt.',
      facts,
    }
  }
  if (underMinimum.length >= 1 || shortNoticeEvents >= 1 || leaveRequests >= 2 || lateRequests >= 2) {
    return {
      level: 'attention',
      headline: 'Có yếu tố cần xem xét',
      explanation: 'Dữ liệu có biến động về số ca hoặc yêu cầu nghỉ/trễ. Quản lý nên đối chiếu hoàn cảnh thực tế trước khi duyệt hoặc từ chối.',
      facts,
    }
  }
  return {
    level: 'stable',
    headline: 'Lịch làm tương đối ổn định',
    explanation: 'Trong phần dữ liệu hệ thống còn lưu, chưa thấy cảnh báo lặp lại về thiếu ca hoặc báo sát hạn.',
    facts,
  }
}

async function liveRecords(employeeId: string, start: Date, end: Date): Promise<ReviewRecord[]> {
  const [schedules, leaves, lateRequests] = await Promise.all([
    adminDb.collection('workSchedules')
      .where('employeeId', '==', employeeId)
      .where('date', '>=', Timestamp.fromDate(start))
      .where('date', '<', Timestamp.fromDate(end))
      .get(),
    adminDb.collection('leaveRequests')
      .where('employeeId', '==', employeeId)
      .where('leaveDate', '>=', Timestamp.fromDate(start))
      .where('leaveDate', '<', Timestamp.fromDate(end))
      .get(),
    adminDb.collection('lateRequests')
      .where('employeeId', '==', employeeId)
      .where('date', '>=', Timestamp.fromDate(start))
      .where('date', '<', Timestamp.fromDate(end))
      .get(),
  ])
  return [
    ...schedules.docs.map((snapshot) => firestoreRecord('workSchedules', snapshot)),
    ...leaves.docs.map((snapshot) => firestoreRecord('leaveRequests', snapshot)),
    ...lateRequests.docs.map((snapshot) => firestoreRecord('lateRequests', snapshot)),
  ]
}

async function archivedRecords(employeeId: string, weekKeys: string[]): Promise<{
  records: ReviewRecord[]
  available: boolean
}> {
  try {
    const files = await listWeeklyArchives()
    const latestByWeek = new Map<string, (typeof files)[number]>()
    files
      .filter((file) => !file.archiveKey.includes('-test-') && weekKeys.includes(file.archiveKey))
      .forEach((file) => {
        const current = latestByWeek.get(file.archiveKey)
        if (!current || String(file.modifiedTime || file.createdTime || '') > String(current.modifiedTime || current.createdTime || '')) {
          latestByWeek.set(file.archiveKey, file)
        }
      })
    const payloads = await Promise.all([...latestByWeek.values()].map((file) => readWeeklyArchive(file.id)))
    return { records: payloads.flatMap((payload) => archiveRecords(payload, employeeId)), available: true }
  } catch (error) {
    console.warn('Employee review archive fallback unavailable:', error instanceof Error ? error.message : error)
    return { records: [], available: false }
  }
}

export async function buildEmployeeReviewContext(
  employeeId: string,
  referenceDate: Date
): Promise<EmployeeReviewContext> {
  const employee = await adminDb.collection('employees').doc(employeeId).get()
  if (!employee.exists || employee.get('role') !== 'employee') throw new Error('Không tìm thấy nhân viên cần kiểm tra.')

  const referenceWeekStart = mondayKey(referenceDate)
  const weekKeys = Array.from({ length: 4 }, (_, index) => shiftKey(referenceWeekStart, (index - 3) * 7))
  const start = dateForKey(weekKeys[0])
  const end = dateForKey(shiftKey(referenceWeekStart, 7))
  const [live, archived] = await Promise.all([
    liveRecords(employeeId, start, end),
    archivedRecords(employeeId, weekKeys),
  ])

  const merged = new Map<string, ReviewRecord>()
  archived.records.forEach((record) => merged.set(record.path, record))
  live.forEach((record) => merged.set(record.path, record))
  const records = [...merged.values()]
  const weeks = buildWeeks(records, referenceWeekStart)
  const result = assessment(weeks, workflowPolicy.minimumWeeklyShifts)

  return {
    employeeId,
    referenceWeekStart,
    minimumWeeklyShifts: workflowPolicy.minimumWeeklyShifts,
    ...result,
    weeks,
    archiveUsed: records.some((record) => record.source === 'drive'),
    archiveAvailable: archived.available,
    disclaimer: 'Đánh giá chỉ tóm tắt lịch và yêu cầu đã ghi nhận trên app. Màu cảnh báo không kết luận thái độ, năng lực hay nguyên nhân khách quan của nhân viên.',
  }
}
