import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/server/firebase-admin'
import type { RequestActor } from '@/lib/server/api-auth'
import { auditEmailConfigured } from '@/lib/server/audit-email'

const READ_ONLY_ACTIONS = new Set([
  'getWeeklyScheduleTarget',
  'getDutyAvailability',
  'normalizeLeaveRequests',
  'getManagementContact',
  'getAuditReceiptSettings',
])

const EMAIL_RECEIPT_ACTIONS = new Set([
  'submitSchedules',
  'replaceSchedules',
  'submitLeave',
  'submitLate',
  'submitSalaryAdvance',
  'submitStaffRequest',
  'reviseRequest',
  'cancelRequest',
  'cancelScheduleBatch',
  'createForgottenDutyPenalty',
  'createManualPenalty',
  'managePenalty',
  'reviewRequest',
  'reviewScheduleBatch',
])

const actionLabels: Record<string, string> = {
  submitSchedules: 'Gửi bảng lịch làm',
  replaceSchedules: 'Gửi lại bảng lịch đã chỉnh sửa',
  setScheduleBatchEditing: 'Thay đổi chế độ chỉnh sửa lịch',
  submitLeave: 'Gửi yêu cầu nghỉ',
  submitLate: 'Gửi yêu cầu đi trễ',
  submitSalaryAdvance: 'Gửi yêu cầu ứng lương',
  submitStaffRequest: 'Gửi yêu cầu đến quản lý',
  reviseRequest: 'Chỉnh sửa yêu cầu',
  cancelRequest: 'Hủy yêu cầu',
  cancelScheduleBatch: 'Hủy bảng lịch',
  createForgottenDutyPenalty: 'Ghi nhận khoản phạt quên trực',
  createManualPenalty: 'Ghi nhận khoản phạt thủ công',
  managePenalty: 'Điều chỉnh khoản phạt',
  reviewRequest: 'Quản lý xử lý yêu cầu',
  reviewScheduleBatch: 'Quản lý xử lý bảng lịch',
  updateWeeklyScheduleTarget: 'Cập nhật mục tiêu gửi lịch',
  updateAuditReceiptSettings: 'Cập nhật cài đặt email biên nhận',
}

function normalize(value: unknown): unknown {
  if (value === undefined) return null
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value
  }
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(normalize)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)])
    )
  }
  return String(value)
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value))
}

function eventDigest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

async function subjectEmployeeId(
  actor: RequestActor,
  action: string,
  payload: Record<string, unknown>,
): Promise<string> {
  if (actor.role === 'employee') return actor.uid

  let collection = ''
  let id = ''
  if (action === 'reviewRequest') {
    const resourceCollections: Record<string, string> = {
      schedule: 'workSchedules',
      leave: 'leaveRequests',
      late: 'lateRequests',
      salary: 'salaryAdvances',
      staff: 'staffRequests',
    }
    collection = resourceCollections[String(payload.resource)] || ''
    id = String(payload.id || '')
  } else if (action === 'reviewScheduleBatch' || action === 'cancelScheduleBatch') {
    collection = 'workSchedules'
    id = Array.isArray(payload.ids) ? String(payload.ids[0] || '') : ''
  } else if (action === 'managePenalty') {
    collection = 'penalties'
    id = String(payload.id || '')
  } else if (action === 'createForgottenDutyPenalty' || action === 'createManualPenalty') {
    return String(payload.employeeId || actor.uid)
  }

  if (!collection || !id) return actor.uid
  const snapshot = await adminDb.collection(collection).doc(id).get()
  return snapshot.exists && typeof snapshot.get('employeeId') === 'string'
    ? snapshot.get('employeeId')
    : actor.uid
}

function scheduleSummary(payload: Record<string, unknown>): string {
  if (!Array.isArray(payload.schedules)) return ''
  const shiftLabels: Record<string, string> = {
    Morning: 'sáng',
    Afternoon: 'chiều',
    Evening: 'tối',
  }
  return payload.schedules.map((item) => {
    if (!item || typeof item !== 'object') return ''
    const row = item as Record<string, unknown>
    const date = typeof row.date === 'string' ? new Date(row.date) : null
    const day = date && !Number.isNaN(date.getTime())
      ? date.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })
      : 'Ngày chưa xác định'
    return `${day}: ca ${shiftLabels[String(row.shift)] || String(row.shift || '')}`
  }).filter(Boolean).join('\n')
}

function receiptText(params: {
  action: string
  eventId: string
  eventHash: string
  occurredAt: Date
  payload: Record<string, unknown>
}): string {
  const label = actionLabels[params.action] || params.action
  const schedule = scheduleSummary(params.payload)
  return [
    'Trí Candy đã ghi nhận thao tác của bạn.',
    '',
    `Thao tác: ${label}`,
    `Thời gian máy chủ: ${params.occurredAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
    ...(schedule ? ['', schedule] : []),
    '',
    `Mã sự kiện: ${params.eventId}`,
    `Mã kiểm tra SHA-256: ${params.eventHash}`,
    '',
    'Nếu bạn không thực hiện thao tác này, hãy liên hệ quản lý ngay.',
    'Đây là email tự động, bạn không cần xác nhận lại.',
  ].join('\n')
}

export async function recordCompletedWorkflowAudit(params: {
  actor: RequestActor
  action: string
  payload: Record<string, unknown>
  result: unknown
}): Promise<void> {
  if (process.env.AUDIT_TRAIL_ENABLED === 'false' || READ_ONLY_ACTIONS.has(params.action)) return

  const subjectId = await subjectEmployeeId(params.actor, params.action, params.payload)
  const eventId = randomUUID()
  const eventRef = adminDb.collection('auditEvents').doc(eventId)
  const headRef = adminDb.collection('auditHeads').doc(subjectId)
  const settingRef = adminDb.collection('managementSettings').doc('auditReceipts')
  const employeeRef = adminDb.collection('employees').doc(subjectId)
  const outboxRef = adminDb.collection('auditEmailOutbox').doc(eventId)
  const occurredAt = new Date()

  await adminDb.runTransaction(async (transaction) => {
    const [head, setting, employee] = await Promise.all([
      transaction.get(headRef),
      transaction.get(settingRef),
      transaction.get(employeeRef),
    ])
    const previousHash = typeof head.get('lastHash') === 'string' ? head.get('lastHash') : ''
    const normalizedPayload = normalize(params.payload)
    const normalizedResult = normalize(params.result)
    const hashInput = {
      eventId,
      actorUid: params.actor.uid,
      actorRole: params.actor.role,
      subjectEmployeeId: subjectId,
      action: params.action,
      payload: normalizedPayload,
      result: normalizedResult,
      occurredAt: occurredAt.toISOString(),
      previousHash,
    }
    const hash = eventDigest(hashInput)
    const timestamp = Timestamp.fromDate(occurredAt)

    transaction.create(eventRef, {
      ...hashInput,
      hash,
      hashAlgorithm: 'SHA-256',
      authTime: Number(params.actor.token.auth_time || 0),
      signInProvider: String(params.actor.token.firebase?.sign_in_provider || ''),
      occurredAt: timestamp,
      createdAt: timestamp,
    })
    transaction.set(headRef, {
      subjectEmployeeId: subjectId,
      lastEventId: eventId,
      lastHash: hash,
      eventCount: Number(head.get('eventCount') || 0) + 1,
      updatedAt: timestamp,
      createdAt: head.exists ? head.get('createdAt') : timestamp,
    }, { merge: true })

    const emailEnabled = EMAIL_RECEIPT_ACTIONS.has(params.action) &&
      auditEmailConfigured() &&
      setting.get('emailEnabled') === true
    const email = employee.get('email')
    if (emailEnabled && typeof email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      transaction.create(outboxRef, {
        eventId,
        employeeId: subjectId,
        to: email,
        subject: `[Trí Candy] Biên nhận: ${actionLabels[params.action] || params.action}`,
        text: receiptText({
          action: params.action,
          eventId,
          eventHash: hash,
          occurredAt,
          payload: params.payload,
        }),
        state: 'queued',
        attempts: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }
  })
}

export function auditReceiptCapability() {
  return {
    auditTrailEnabled: process.env.AUDIT_TRAIL_ENABLED !== 'false',
    emailEnvironmentEnabled: process.env.AUDIT_EMAIL_ENABLED === 'true',
    emailConfigured: auditEmailConfigured(),
  }
}
