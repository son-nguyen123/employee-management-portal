import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { performance } from 'node:perf_hooks'

const DEFAULT_COUNT = 80
const DEFAULT_SHIFTS = 6
const PRODUCTION_PROJECT_ID = 'employee-management-port-339fe'
const FIREBASE_SIGN_IN_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword'

function printHelp() {
  console.log(`
Load test submitSchedules with independent Firebase users.

Required environment:
  LOAD_TEST_ENV=staging              Safety guard. Use local for localhost only.
  LOAD_TEST_BASE_URL=https://...     App URL, without a trailing slash.
  LOAD_TEST_CONFIRM=STAGING_LOAD_TEST
  NEXT_PUBLIC_FIREBASE_API_KEY=...   Firebase web API key.

User source (choose one):
  LOAD_TEST_USERS_FILE=./users.json  JSON array of { email, password }.
  LOAD_TEST_PROVISION=1              Create test users/profiles with Admin SDK.

Optional:
  LOAD_TEST_COUNT=80                 Number of concurrent employees.
  LOAD_TEST_SHIFTS=6                 Shifts submitted by each employee.
  LOAD_TEST_WEEK_START=YYYY-MM-DD    Open Vietnam week; defaults to this week's Monday.
  LOAD_TEST_CLEANUP=1                Delete provisioned users and test records afterward.
  LOAD_TEST_EMAIL_DOMAIN=loadtest.invalid

Example:
  $env:LOAD_TEST_ENV='staging'
  $env:LOAD_TEST_BASE_URL='https://staging.example.com'
  $env:LOAD_TEST_CONFIRM='STAGING_LOAD_TEST'
  $env:LOAD_TEST_USERS_FILE='./tmp/load-test-users.json'
  pnpm test:load:schedules

Provisioning additionally requires FIREBASE_ADMIN_PROJECT_ID,
FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY.
`)
}

const env = process.env
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp()
  process.exit(0)
}

function required(name) {
  const value = env[name]?.trim()
  if (!value) throw new Error(`Thiếu biến môi trường ${name}.`)
  return value
}

function integerEnv(name, fallback, { min = 1, max = 500 } = {}) {
  const value = Number(env[name] || fallback)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} phải là số nguyên từ ${min} đến ${max}.`)
  }
  return value
}

function assertDateOnly(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T12:00:00+07:00`).getTime())) {
    throw new Error(`${name} phải có dạng YYYY-MM-DD.`)
  }
  return value
}

function addDays(dateOnly, days) {
  const date = new Date(`${dateOnly}T12:00:00+07:00`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function defaultVietnamWeekStart() {
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000)
  const day = now.getUTCDay() || 7
  const daysFromMonday = day - 1
  now.setUTCDate(now.getUTCDate() - daysFromMonday)
  return now.toISOString().slice(0, 10)
}

function schedulePayload(weekStart, index, shifts) {
  return Array.from({ length: shifts }, (_, shiftIndex) => ({
    date: `${addDays(weekStart, shiftIndex)}T08:00:00+07:00`,
    shift: ['Morning', 'Afternoon', 'Evening'][shiftIndex % 3],
    note: `[LOAD_TEST] employee-${String(index + 1).padStart(3, '0')}`,
  }))
}

function parseUsers(raw, count) {
  const parsed = JSON.parse(raw)
  const users = Array.isArray(parsed) ? parsed : parsed?.users
  if (!Array.isArray(users) || users.length !== count) {
    throw new Error(`File users phải chứa đúng ${count} tài khoản.`)
  }
  const emails = new Set()
  return users.map((user, index) => {
    const email = typeof user?.email === 'string' ? user.email.trim() : ''
    const password = typeof user?.password === 'string' ? user.password : ''
    if (!email || !password || password.length < 6 || emails.has(email)) {
      throw new Error(`Tài khoản thứ ${index + 1} trong file users không hợp lệ hoặc bị trùng.`)
    }
    emails.add(email)
    return { email, password, index }
  })
}

function assertTarget(baseUrl, projectId) {
  const url = new URL(baseUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('LOAD_TEST_BASE_URL phải là http hoặc https.')
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  const testEnv = env.LOAD_TEST_ENV?.trim().toLowerCase()
  if (!testEnv) throw new Error('Phải khai báo LOAD_TEST_ENV=staging hoặc LOAD_TEST_ENV=local.')
  if (isLocal && testEnv !== 'local') throw new Error('Localhost phải dùng LOAD_TEST_ENV=local.')
  if (!isLocal && testEnv !== 'staging') throw new Error('URL từ xa phải dùng LOAD_TEST_ENV=staging.')
  if (env.LOAD_TEST_CONFIRM !== 'STAGING_LOAD_TEST') {
    throw new Error('Để tránh bắn tải nhầm, LOAD_TEST_CONFIRM phải bằng STAGING_LOAD_TEST.')
  }
  if (projectId === PRODUCTION_PROJECT_ID && env.LOAD_TEST_ALLOW_PRODUCTION !== '1') {
    throw new Error('Project hiện tại là production. Không chạy load test trên production; hãy trỏ staging sang project riêng.')
  }
}

function adminConfig() {
  const projectId = required('FIREBASE_ADMIN_PROJECT_ID')
  const clientEmail = required('FIREBASE_ADMIN_CLIENT_EMAIL')
  const privateKey = required('FIREBASE_ADMIN_PRIVATE_KEY').replace(/\\n/g, '\n')
  return { projectId, clientEmail, privateKey }
}

async function loadAdmin() {
  const [{ cert, getApps, initializeApp }, { getAuth }, { getFirestore }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/auth'),
    import('firebase-admin/firestore'),
  ])
  const config = adminConfig()
  const app = getApps().find((item) => item.name === 'load-test') || initializeApp({ credential: cert(config), projectId: config.projectId }, 'load-test')
  return { auth: getAuth(app), db: getFirestore(app), projectId: config.projectId }
}

async function provisionUsers(count) {
  const { auth, db, projectId } = await loadAdmin()
  const domain = env.LOAD_TEST_EMAIL_DOMAIN?.trim() || 'loadtest.invalid'
  const prefix = env.LOAD_TEST_EMAIL_PREFIX?.trim() || `schedule-load-${Date.now()}-`
  const passwordBytes = 18
  const users = []
  const created = []
  const codePrefix = Date.now().toString().slice(-6)

  for (let index = 0; index < count; index += 1) {
    const ordinal = String(index + 1).padStart(3, '0')
    const email = `${prefix}${ordinal}@${domain}`
    const password = randomBytes(passwordBytes).toString('base64url')
    const user = await auth.createUser({ email, password, displayName: `Load Test ${ordinal}` })
    if (index >= 999) throw new Error('Load test supports at most 999 numeric employee codes per run.')
    const employeeCode = `${codePrefix}${ordinal}`
    const now = new Date()
    await db.collection('employees').doc(user.uid).set({
      uid: user.uid,
      employeeCode,
      fullName: `Load Test ${ordinal}`,
      phone: `0900${String(index).padStart(6, '0')}`,
      email,
      role: 'employee',
      status: 'active',
      scheduleMode: 'rotating',
      joinDate: now,
      createdAt: now,
      updatedAt: now,
    })
    await db.collection('employeeCodes').doc(employeeCode).set({ uid: user.uid, employeeCode, createdAt: now })
    users.push({ email, password, index })
    created.push({ uid: user.uid, employeeCode, requestId: '' })
    process.stdout.write(`\rĐã chuẩn bị ${index + 1}/${count} tài khoản trên ${projectId}...`)
  }
  console.log('')
  return { auth, db, users, created }
}

async function signIn(user, apiKey) {
  const response = await fetch(`${FIREBASE_SIGN_IN_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password, returnSecureToken: true }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || typeof body?.idToken !== 'string') {
    const code = typeof body?.error?.message === 'string' ? body.error.message : `HTTP_${response.status}`
    throw new Error(`Không đăng nhập được tài khoản test (${code}).`)
  }
  return body.idToken
}

async function submitOne({ baseUrl, token, user, index, weekStart, shifts, runId }) {
  const requestId = `load-${runId}-${String(index + 1).padStart(3, '0')}`
  const started = performance.now()
  try {
    const response = await fetch(`${baseUrl}/api/workflows`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'submitSchedules',
        requestId,
        confirmUnderMinimum: true,
        schedules: schedulePayload(weekStart, index, shifts),
      }),
    })
    const body = await response.json().catch(() => null)
    return {
      index,
      email: user.email,
      requestId,
      status: response.status,
      ok: response.ok && Array.isArray(body?.ids) && body.ids.length === shifts,
      latencyMs: performance.now() - started,
      body: response.ok ? { idCount: Array.isArray(body?.ids) ? body.ids.length : 0 } : { error: body?.error || `HTTP_${response.status}` },
    }
  } catch (error) {
    return {
      index,
      email: user.email,
      requestId,
      status: 0,
      ok: false,
      latencyMs: performance.now() - started,
      body: { error: error instanceof Error ? error.message : String(error) },
    }
  }
}

function percentile(values, percentage) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const position = Math.min(sorted.length - 1, Math.ceil((percentage / 100) * sorted.length) - 1)
  return sorted[Math.max(0, position)]
}

async function cleanup({ admin, created, weekStart }) {
  if (!admin) return
  const { auth, db } = admin
  const managerSnapshots = await db.collection('employees').get()
  const managerIds = managerSnapshots.docs
    .filter((snapshot) => ['admin', 'manager'].includes(String(snapshot.get('role'))))
    .map((snapshot) => snapshot.id)
  const refs = []
  const uids = new Set(created.map((item) => item.uid))

  for (const item of created) {
    const schedules = await db.collection('workSchedules').where('employeeId', '==', item.uid).get()
    const penalties = await db.collection('penalties').where('employeeId', '==', item.uid).get()
    const notifications = await db.collection('notifications').where('employeeId', '==', item.uid).get()
    refs.push(...schedules.docs.map((snapshot) => snapshot.ref))
    refs.push(...penalties.docs.map((snapshot) => snapshot.ref))
    refs.push(...notifications.docs.map((snapshot) => snapshot.ref))
    refs.push(db.collection('employees').doc(item.uid))
    refs.push(db.collection('employeeCodes').doc(item.employeeCode))
    if (item.requestId) refs.push(db.collection('workflowRequests').doc(`${item.uid}-${item.requestId}`))
    for (const managerId of managerIds) {
      const batchKey = `${item.uid}-${weekStart}`
      refs.push(db.collection('notifications').doc(`manager-${managerId}-schedule-${batchKey}`))
      refs.push(db.collection('pushDispatches').doc(`manager-${managerId}-schedule-${batchKey}`))
    }
  }

  const uniqueRefs = [...new Map(refs.map((ref) => [ref.path, ref])).values()]
  for (let start = 0; start < uniqueRefs.length; start += 400) {
    const batch = db.batch()
    uniqueRefs.slice(start, start + 400).forEach((ref) => batch.delete(ref))
    await batch.commit()
  }
  await Promise.all([...uids].map((uid) => auth.deleteUser(uid)))
  console.log(`Đã dọn ${created.length} tài khoản test và dữ liệu lịch liên quan.`)
}

async function main() {
  const baseUrl = required('LOAD_TEST_BASE_URL').replace(/\/$/, '')
  const projectId = env.FIREBASE_ADMIN_PROJECT_ID?.trim() || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() || ''
  assertTarget(baseUrl, projectId)
  const apiKey = required('NEXT_PUBLIC_FIREBASE_API_KEY')
  const count = integerEnv('LOAD_TEST_COUNT', DEFAULT_COUNT, { max: 500 })
  const shifts = integerEnv('LOAD_TEST_SHIFTS', DEFAULT_SHIFTS, { max: 21 })
  const weekStart = assertDateOnly(env.LOAD_TEST_WEEK_START?.trim() || defaultVietnamWeekStart(), 'LOAD_TEST_WEEK_START')
  const runId = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
  const shouldProvision = env.LOAD_TEST_PROVISION === '1'
  const shouldCleanup = env.LOAD_TEST_CLEANUP === '1'
  let admin = null
  let created = []
  let users

  console.log(`Mục tiêu: ${baseUrl}`)
  console.log(`Project: ${projectId || '(không xác định)'} · ${count} nhân viên · ${shifts} ca/người · tuần ${weekStart}`)
  console.log('Pha 1/3: xác thực tài khoản...')

  if (shouldProvision) {
    const provisioned = await provisionUsers(count)
    admin = { auth: provisioned.auth, db: provisioned.db }
    users = provisioned.users
    created = provisioned.created
  } else {
    const file = required('LOAD_TEST_USERS_FILE')
    users = parseUsers(await readFile(file, 'utf8'), count)
  }

  const tokenResults = await Promise.all(users.map(async (user) => {
    try {
      return { user, token: await signIn(user, apiKey), error: null }
    } catch (error) {
      return { user, token: null, error: error instanceof Error ? error.message : String(error) }
    }
  }))
  const tokenErrors = tokenResults.filter((result) => result.error)
  if (tokenErrors.length) {
    tokenErrors.slice(0, 5).forEach((result) => console.error(`- ${result.user.email}: ${result.error}`))
    throw new Error(`${tokenErrors.length}/${count} tài khoản không đăng nhập được; dừng trước khi ghi dữ liệu.`)
  }

  console.log('Pha 2/3: bắn đồng thời request submitSchedules...')
  const burstStarted = performance.now()
  const results = await Promise.all(tokenResults.map((result, index) => submitOne({
    baseUrl,
    token: result.token,
    user: result.user,
    index,
    weekStart,
    shifts,
    runId,
  })))
  const burstLatencyMs = performance.now() - burstStarted
  results.forEach((result, index) => {
    if (created[index]) created[index].requestId = result.requestId
  })

  const successful = results.filter((result) => result.ok)
  const failed = results.filter((result) => !result.ok)
  const latencies = results.map((result) => result.latencyMs)
  const statusCounts = results.reduce((counts, result) => {
    const key = String(result.status)
    counts[key] = (counts[key] || 0) + 1
    return counts
  }, {})

  console.log('Pha 3/3: tổng hợp kết quả...')
  console.log(`Kết quả: ${successful.length}/${count} thành công · ${failed.length} lỗi · burst ${burstLatencyMs.toFixed(0)}ms`)
  console.log(`Latency: p50 ${percentile(latencies, 50).toFixed(0)}ms · p95 ${percentile(latencies, 95).toFixed(0)}ms · p99 ${percentile(latencies, 99).toFixed(0)}ms · max ${Math.max(...latencies).toFixed(0)}ms`)
  console.log(`HTTP: ${Object.entries(statusCounts).map(([status, total]) => `${status}=${total}`).join(' · ')}`)
  if (failed.length) {
    console.log('Một số lỗi đầu tiên:')
    failed.slice(0, 10).forEach((result) => console.log(`- #${result.index + 1} ${result.status || 'network'} ${JSON.stringify(result.body.error)}`))
  }

  if (shouldCleanup && shouldProvision) {
    console.log('Đang dọn dữ liệu test...')
    await cleanup({ admin, created, weekStart })
  } else if (shouldProvision) {
    console.log('Dữ liệu test được giữ lại vì LOAD_TEST_CLEANUP chưa bật.')
    console.log('Chạy lại với LOAD_TEST_CLEANUP=1 chỉ khi muốn dọn tài khoản/dữ liệu test của run này.')
  }

  if (failed.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(`Load test chưa chạy hoàn tất: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
