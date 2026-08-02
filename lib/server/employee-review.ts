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
    const approvedLeaves = leaves.filter((record) => record.data.status === 'Approved')
    const approvedLeaveScheduleIds = new Set(approvedLeaves.flatMap((record) => {
      const ids = Array.isArray(record.data.workScheduleIds) ? record.data.workScheduleIds : []
      return [...ids, record.data.workScheduleId].filter((id): id is string => typeof id === 'string' && !!id)
    }))
    const approvedSchedules = schedules.filter((record) =>
      record.data.status === 'Approved' && !approvedLeaveScheduleIds.has(record.path.split('/').pop() || '')
    )
    const lateRequests = rows.filter((record) => record.collection === 'lateRequests' && record.data.status === 'Approved')
    const shortNoticeLeaves = approvedLeaves.filter((record) => record.data.noticeClass === 'late').length
    const shortNoticeLate = lateRequests.filter((record) =>
      Number(record.data.noticeMinutes ?? workflowPolicy.lateNoticeMinutes) < workflowPolicy.lateNoticeMinutes ||
      record.data.managerMessageStatus === 'notMessaged' ||
      record.data.managerMessageStatus === 'messagedOtherManager'
    ).length
    return {
      weekStart,
      weekEnd: shiftKey(weekStart, 6),
      scheduledShifts: approvedSchedules.length,
      approvedShifts: approvedSchedules.length,
      leaveRequests: leaves.length,
      approvedLeaveRequests: approvedLeaves.length,
      lateRequests: lateRequests.length,
      shortNoticeEvents: shortNoticeLeaves + shortNoticeLate,
      hasLongLeave: approvedLeaves.some((record) => record.data.duration === 'long'),
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
  const historicalWeeks = weeks.slice(0, -1)
  const observed = historicalWeeks.filter((week) => week.source !== 'none')
  const eligible = observed.filter((week) =>
    !week.hasLongLeave && (week.scheduledShifts > 0 || week.approvedLeaveRequests > 0)
  )
  const underMinimum = eligible.filter((week) => week.scheduledShifts < minimum)
  const leaveRequests = historicalWeeks.reduce((total, week) => total + week.approvedLeaveRequests, 0)
  const lateRequests = historicalWeeks.reduce((total, week) => total + week.lateRequests, 0)
  const shortNoticeEvents = historicalWeeks.reduce((total, week) => total + week.shortNoticeEvents, 0)
  const longLeaveWeeks = historicalWeeks.filter((week) => week.hasLongLeave).length
  const facts = [
    `${eligible.length}/4 tuần có lịch · ${underMinimum.length} tuần dưới ${minimum} ca.`,
    `${leaveRequests} nghỉ · ${lateRequests} báo trễ · ${shortNoticeEvents} báo sát hạn${longLeaveWeeks ? ` · ${longLeaveWeeks} tuần nghỉ dài hạn` : ''}.`,
  ]

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
      explanation: 'Lịch dưới mức tối thiểu kèm báo trễ hoặc sát hạn. Nên kiểm tra hoàn cảnh trước khi quyết định.',
      facts,
    }
  }
  if (underMinimum.length >= 1 || shortNoticeEvents >= 1 || leaveRequests >= 2 || lateRequests >= 2) {
    return {
      level: 'attention',
      headline: 'Có yếu tố cần xem xét',
      explanation: 'Số ca hoặc yêu cầu nghỉ/trễ có biến động. Nên kiểm tra hoàn cảnh thực tế.',
      facts,
    }
  }
  return {
    level: 'stable',
    headline: 'Lịch làm tương đối ổn định',
    explanation: 'Chưa thấy cảnh báo lặp lại về thiếu ca hoặc báo sát hạn.',
    facts,
  }
}

async function liveRecords(employeeId: string, start: Date, end: Date): Promise<{
  records: ReviewRecord[]
  warnings: string[]
}> {
  const sources = [
    {
      label: 'lịch làm',
      collection: 'workSchedules' as const,
      query: adminDb.collection('workSchedules')
      .where('employeeId', '==', employeeId)
      .where('date', '>=', Timestamp.fromDate(start))
      .where('date', '<', Timestamp.fromDate(end))
      .orderBy('date', 'desc')
      .get(),
    },
    {
      label: 'yêu cầu nghỉ',
      collection: 'leaveRequests' as const,
      query: adminDb.collection('leaveRequests')
      .where('employeeId', '==', employeeId)
      .where('leaveDate', '>=', Timestamp.fromDate(start))
      .where('leaveDate', '<', Timestamp.fromDate(end))
      .orderBy('leaveDate', 'desc')
      .get(),
    },
    {
      label: 'thông báo đi trễ',
      collection: 'lateRequests' as const,
      query: adminDb.collection('lateRequests')
      .where('employeeId', '==', employeeId)
      .where('date', '>=', Timestamp.fromDate(start))
      .where('date', '<', Timestamp.fromDate(end))
      .orderBy('date', 'desc')
      .get(),
    },
  ]
  const settled = await Promise.allSettled(sources.map((source) => source.query))
  const warnings: string[] = []
  const records = settled.flatMap((result, index) => {
    const source = sources[index]
    if (result.status === 'rejected') {
      console.warn(`Employee review could not read ${source.label}:`, result.reason instanceof Error ? result.reason.message : result.reason)
      warnings.push(`Tạm thời chưa đọc được ${source.label} từ Firebase.`)
      return []
    }
    return result.value.docs.map((snapshot) => firestoreRecord(source.collection, snapshot))
  })
  return { records, warnings }
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

  if (live.warnings.length === 3 && !archived.records.length) {
    throw new Error('Không đọc được dữ liệu lịch, nghỉ và đi trễ từ Firebase hoặc kho lưu trữ.')
  }

  const merged = new Map<string, ReviewRecord>()
  archived.records.forEach((record) => merged.set(record.path, record))
  live.records.forEach((record) => merged.set(record.path, record))
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
    liveWarnings: live.warnings,
    disclaimer: 'Chỉ là cảnh báo từ dữ liệu trên app, không kết luận nhân viên.',
  }
}
