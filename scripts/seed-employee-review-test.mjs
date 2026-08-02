import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const TEST_BATCH = 'employee-review-v1'
const TEST_PREFIX = 'codex-test-review-'
const targetName = process.env.TEST_EMPLOYEE_NAME || 'Quốc Huy Nguyễn'
const cleanup = process.argv.includes('--cleanup')

const firebaseConfig = JSON.parse(await readFile('.firebaserc', 'utf8'))
const projectId = firebaseConfig.projects?.default
if (!projectId) throw new Error('Missing the default Firebase project in .firebaserc.')

const cliConfigPath = join(homedir(), '.config', 'configstore', 'firebase-tools.json')
const cliConfig = JSON.parse(await readFile(cliConfigPath, 'utf8'))
const accessToken = cliConfig.tokens?.access_token
const expiresAt = Number(cliConfig.tokens?.expires_at || 0)
if (!accessToken || expiresAt <= Date.now()) {
  throw new Error('Firebase CLI login token is missing or expired. Run `npx -y firebase-tools@latest firestore:databases:list` first.')
}

const resourceRoot = `projects/${projectId}/databases/(default)/documents`
const root = `https://firestore.googleapis.com/v1/${resourceRoot}`
const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function atNoon(dateKey) {
  return new Date(`${dateKey}T12:00:00+07:00`)
}

function dateKey(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value)
}

function addDays(value, days) {
  const date = atNoon(value)
  date.setUTCDate(date.getUTCDate() + days)
  return dateKey(date)
}

function encode(value) {
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } }
  if (value === null) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isInteger(value)
    ? { integerValue: String(value) }
    : { doubleValue: value }
  if (value && typeof value === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } }
  }
  throw new Error(`Unsupported Firestore value type: ${typeof value}`)
}

function decode(value) {
  if (!value || typeof value !== 'object') return undefined
  if ('stringValue' in value) return value.stringValue
  if ('booleanValue' in value) return value.booleanValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('timestampValue' in value) return new Date(value.timestampValue)
  if ('nullValue' in value) return null
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode)
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {})
  return undefined
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]))
}

function documentId(name) {
  return name.split('/').pop()
}

async function api(path, body) {
  const response = await fetch(`${root}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Firestore REST ${response.status}: ${await response.text()}`)
  return response.json()
}

async function queryCollection(collectionId, field, value) {
  const where = field ? {
    fieldFilter: {
      field: { fieldPath: field },
      op: 'EQUAL',
      value: encode(value),
    },
  } : undefined
  const rows = await api(':runQuery', {
    structuredQuery: {
      from: [{ collectionId }],
      ...(where ? { where } : {}),
    },
  })
  return rows.flatMap((row) => row.document ? [{
    id: documentId(row.document.name),
    name: row.document.name,
    data: decodeFields(row.document.fields),
  }] : [])
}

function updateWrite(collectionId, id, data) {
  return {
    update: {
      name: `${resourceRoot}/${collectionId}/${id}`,
      fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)])),
    },
  }
}

function deleteWrite(name) {
  return { delete: name }
}

async function commit(writes) {
  if (!writes.length) return
  await api(':commit', { writes })
}

const employees = await queryCollection('employees')
const matches = employees.filter((employee) => normalize(employee.data.fullName) === normalize(targetName))
if (matches.length !== 1) throw new Error(`Expected exactly one employee named "${targetName}", found ${matches.length}.`)
const employee = matches[0]
const employeeId = employee.id

if (cleanup) {
  const records = (await Promise.all(
    ['workSchedules', 'leaveRequests', 'lateRequests'].map((collectionId) =>
      queryCollection(collectionId, 'testDataBatch', TEST_BATCH)
    )
  )).flat().filter((record) => record.data.employeeId === employeeId)
  await commit(records.map((record) => deleteWrite(record.name)))
  console.log(JSON.stringify({ action: 'cleanup', employeeId, employeeName: employee.data.fullName, deleted: records.length }, null, 2))
  process.exit(0)
}

const now = new Date()
const testTag = `[TEST_DATA:${TEST_BATCH}]`
const writes = []
const shiftPattern = ['Morning', 'Afternoon', 'Evening']
const historicalWeeks = [
  { start: '2026-07-13', count: 7 },
  { start: '2026-07-20', count: 5 },
  { start: '2026-07-27', count: 4 },
]

for (const [weekIndex, week] of historicalWeeks.entries()) {
  for (let index = 0; index < week.count; index += 1) {
    const id = `${TEST_PREFIX}schedule-w${weekIndex + 1}-${index + 1}`
    writes.push(updateWrite('workSchedules', id, {
      employeeId,
      date: atNoon(addDays(week.start, index % 7)),
      shift: shiftPattern[index % shiftPattern.length],
      status: 'Approved',
      note: testTag,
      batchKey: `${TEST_PREFIX}week-${week.start}`,
      testDataBatch: TEST_BATCH,
      createdAt: now,
      updatedAt: now,
    }))
  }
}

const schedules = await queryCollection('workSchedules', 'employeeId', employeeId)
const currentStart = atNoon('2026-08-03')
const currentEnd = atNoon('2026-08-10')
const currentSchedules = schedules
  .filter((record) => record.data.date instanceof Date && record.data.date >= currentStart && record.data.date < currentEnd && record.data.status === 'Approved' && !String(record.data.note || '').includes('[DUTY_ONLY]'))
  .sort((left, right) => left.data.date - right.data.date)

const occupied = new Set(currentSchedules.map((record) => `${dateKey(record.data.date)}-${record.data.shift}`))
const ensuredSchedules = [...currentSchedules]
const desired = [
  ['2026-08-03', 'Morning'],
  ['2026-08-04', 'Afternoon'],
  ['2026-08-05', 'Morning'],
  ['2026-08-06', 'Afternoon'],
  ['2026-08-07', 'Morning'],
  ['2026-08-08', 'Evening'],
]
for (const [index, [day, shift]] of desired.entries()) {
  if (ensuredSchedules.length >= 6) break
  if (occupied.has(`${day}-${shift}`)) continue
  const id = `${TEST_PREFIX}schedule-current-${index + 1}`
  const data = {
    employeeId,
    date: atNoon(day),
    shift,
    status: 'Approved',
    note: testTag,
    batchKey: `${TEST_PREFIX}week-2026-08-03`,
    testDataBatch: TEST_BATCH,
    createdAt: now,
    updatedAt: now,
  }
  writes.push(updateWrite('workSchedules', id, data))
  ensuredSchedules.push({ id, data })
  occupied.add(`${day}-${shift}`)
}

const sortedCurrent = ensuredSchedules.sort((left, right) => left.data.date - right.data.date)
if (sortedCurrent.length < 4) throw new Error('Could not prepare at least four current-week schedules.')

const approvedLeaveSchedules = sortedCurrent.slice(0, 3)
writes.push(updateWrite('leaveRequests', `${TEST_PREFIX}leave-approved-three-shifts`, {
  employeeId,
  workScheduleId: approvedLeaveSchedules[0].id,
  workScheduleIds: approvedLeaveSchedules.map((record) => record.id),
  leaveDate: approvedLeaveSchedules[0].data.date,
  endDate: approvedLeaveSchedules[2].data.date,
  duration: 'short',
  leaveType: 'personal',
  reason: `${testTag} Nghỉ ba ca để kiểm tra đánh dấu trên lịch.`,
  status: 'Approved',
  noticeClass: 'onTime',
  weeklyShiftCount: sortedCurrent.length,
  weeklyShiftCountAfterLeave: Math.max(0, sortedCurrent.length - 3),
  underMinimumWarning: sortedCurrent.length - 3 < 6,
  testDataBatch: TEST_BATCH,
  approvedBy: 'test-seed',
  reviewedBy: 'test-seed',
  reviewedAt: now,
  createdAt: now,
  updatedAt: now,
}))

writes.push(updateWrite('leaveRequests', `${TEST_PREFIX}leave-long-context`, {
  employeeId,
  leaveDate: atNoon('2026-07-14'),
  endDate: atNoon('2026-07-16'),
  duration: 'long',
  leaveType: 'personal',
  reason: `${testTag} Nghỉ dài hạn mẫu để kiểm tra ngữ cảnh khách quan.`,
  status: 'Approved',
  noticeClass: 'onTime',
  testDataBatch: TEST_BATCH,
  approvedBy: 'test-seed',
  reviewedAt: now,
  createdAt: now,
  updatedAt: now,
}))

for (const [index, weekStart] of ['2026-07-20', '2026-07-27'].entries()) {
  writes.push(updateWrite('lateRequests', `${TEST_PREFIX}late-${index + 1}`, {
    employeeId,
    workScheduleId: `${TEST_PREFIX}schedule-w${index + 2}-1`,
    workScheduleIds: [`${TEST_PREFIX}schedule-w${index + 2}-1`],
    date: atNoon(addDays(weekStart, 1)),
    shift: 'Afternoon',
    lateMinutes: index === 0 ? 20 : 35,
    expectedArrival: index === 0 ? '13:20' : '13:35',
    noticeMinutes: 25,
    noticeClass: 'late',
    managerMessageStatus: index === 0 ? 'notMessaged' : 'messagedOtherManager',
    reason: `${testTag} Tình huống đi trễ mẫu ${index + 1}.`,
    status: 'Approved',
    penaltyIfApproved: index === 0 ? 500 : 1000,
    penaltyIfRejected: index === 0 ? 1000 : 2000,
    testDataBatch: TEST_BATCH,
    approvedBy: 'test-seed',
    reviewedAt: now,
    createdAt: now,
    updatedAt: now,
  }))
}

const leaves = await queryCollection('leaveRequests', 'employeeId', employeeId)
const activePending = leaves.find((record) => record.data.status === 'Pending' && record.id !== `${TEST_PREFIX}leave-pending-review`)
const pendingRequestId = activePending?.id || `${TEST_PREFIX}leave-pending-review`
if (!activePending) {
  const pendingScheduleId = `${TEST_PREFIX}schedule-w3-3`
  writes.push(updateWrite('leaveRequests', pendingRequestId, {
    employeeId,
    workScheduleId: pendingScheduleId,
    workScheduleIds: [pendingScheduleId],
    leaveDate: atNoon('2026-07-29'),
    endDate: atNoon('2026-07-29'),
    duration: 'short',
    leaveType: 'personal',
    reason: `${testTag} Yêu cầu chờ duyệt để mở mục Kiểm tra.`,
    status: 'Pending',
    noticeClass: 'onTime',
    weeklyShiftCount: 4,
    weeklyShiftCountAfterLeave: 3,
    underMinimumWarning: true,
    testDataBatch: TEST_BATCH,
    createdAt: now,
    updatedAt: now,
  }))
}

await commit(writes)
console.log(JSON.stringify({
  action: 'seed',
  employeeId,
  employeeName: employee.data.fullName,
  approvedLeaveRequestId: `${TEST_PREFIX}leave-approved-three-shifts`,
  markedScheduleIds: approvedLeaveSchedules.map((record) => record.id),
  pendingRequestId,
  reusedExistingPending: Boolean(activePending),
  writtenDocuments: writes.length,
  cleanupCommand: 'npm run seed:review-test -- --cleanup',
}, null, 2))
