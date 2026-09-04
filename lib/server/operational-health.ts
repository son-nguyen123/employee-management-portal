import 'server-only'

import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb, firebaseAdminAccessToken, firebaseAdminProjectId } from '@/lib/server/firebase-admin'
import { getDriveStorageStatus, type DriveStorageStatus } from '@/lib/server/google-drive-archive'
import { operationalEmailConfigured, sendOperationalEmail } from '@/lib/server/audit-email'
import { requireManager, type RequestActor } from '@/lib/server/api-auth'
import type { OperationalHealthSnapshot, OperationalIssue, OperationalServiceStatus, OperationalSeverity } from '@/lib/models/operationalHealth'
import { overallHealthLevel, quotaHealthLevel } from '@/lib/operations/health-policy'
export type { OperationalHealthSnapshot, OperationalIssue, OperationalServiceStatus, OperationalSeverity } from '@/lib/models/operationalHealth'

type MonitoringPoint = { value?: { int64Value?: string; doubleValue?: number }; interval?: { endTime?: string } }
type MonitoringSeries = { metric?: { labels?: Record<string, string> }; points?: MonitoringPoint[] }

const freeTierLimits = {
  reads: Number(process.env.FIRESTORE_READ_ALERT_LIMIT || 50_000),
  writes: Number(process.env.FIRESTORE_WRITE_ALERT_LIMIT || 20_000),
  deletes: Number(process.env.FIRESTORE_DELETE_ALERT_LIMIT || 20_000),
  storageBytes: Number(process.env.FIRESTORE_STORAGE_ALERT_LIMIT_BYTES || 1024 ** 3),
}

function numericPoint(point: MonitoringPoint): number {
  const value = point.value?.doubleValue ?? Number(point.value?.int64Value || 0)
  return Number.isFinite(value) ? value : 0
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || 'Lỗi không xác định')
  return message.replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]').slice(0, 400)
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('vi-VN')
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 MB'
  const unit = value >= 1024 ** 3 ? 'GB' : 'MB'
  const divisor = unit === 'GB' ? 1024 ** 3 : 1024 ** 2
  return `${Math.round(value / divisor * 10) / 10} ${unit}`
}

async function monitoringSeries(metricType: string, start: Date, end: Date, extraFilter = ''): Promise<MonitoringSeries[]> {
  const projectId = firebaseAdminProjectId()
  const accessToken = await firebaseAdminAccessToken()
  const filter = [`metric.type = "${metricType}"`, extraFilter].filter(Boolean).join(' AND ')
  const output: MonitoringSeries[] = []
  let pageToken = ''
  for (let page = 0; page < 5; page += 1) {
    const params = new URLSearchParams({
      filter,
      'interval.startTime': start.toISOString(),
      'interval.endTime': end.toISOString(),
      view: 'FULL',
      pageSize: '1000',
      ...(pageToken ? { pageToken } : {}),
    })
    const response = await fetch(`https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(projectId)}/timeSeries?${params}`, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    })
    const body = await response.json().catch(() => null) as { timeSeries?: MonitoringSeries[]; nextPageToken?: string; error?: { message?: string } } | null
    if (!response.ok) {
      throw new Error(`Cloud Monitoring (${response.status}): ${body?.error?.message || 'không đọc được metrics'}`)
    }
    output.push(...(body?.timeSeries || []))
    pageToken = body?.nextPageToken || ''
    if (!pageToken) break
  }
  return output
}

function sumSeries(series: MonitoringSeries[]): number {
  return series.reduce((total, row) => total + (row.points || []).reduce((sum, point) => sum + numericPoint(point), 0), 0)
}

function latestGauge(series: MonitoringSeries[]): number {
  return series.reduce((total, row) => {
    const latest = [...(row.points || [])].sort((left, right) =>
      String(right.interval?.endTime || '').localeCompare(String(left.interval?.endTime || ''))
    )[0]
    return total + (latest ? numericPoint(latest) : 0)
  }, 0)
}

async function checkFirestore(now: Date): Promise<{ status: OperationalServiceStatus; issues: OperationalIssue[] }> {
  // This read verifies the Admin SDK before querying external metrics.
  await adminDb.collection('systemHealth').doc('current').get()
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const storageStart = new Date(now.getTime() - 6 * 60 * 60 * 1000)
  const [reads, writes, deletes, storage, deniedRules, requests] = await Promise.all([
    monitoringSeries('firestore.googleapis.com/document/read_count', start, now),
    monitoringSeries('firestore.googleapis.com/document/write_count', start, now),
    monitoringSeries('firestore.googleapis.com/document/delete_count', start, now),
    monitoringSeries('firestore.googleapis.com/storage/data_and_index_storage_bytes', storageStart, now),
    monitoringSeries('firestore.googleapis.com/rules/evaluation_count', start, now, 'metric.labels.result = "DENY"'),
    monitoringSeries('firestore.googleapis.com/api/request_count', start, now),
  ])
  const metrics = {
    reads24h: sumSeries(reads),
    writes24h: sumSeries(writes),
    deletes24h: sumSeries(deletes),
    storageBytes: latestGauge(storage),
    deniedRules24h: sumSeries(deniedRules),
    resourceExhausted24h: sumSeries(requests.filter((row) =>
      /resource_exhausted|quota|429/i.test(String(row.metric?.labels?.response_code || ''))
    )),
  }
  const levels = [
    quotaHealthLevel(metrics.reads24h, freeTierLimits.reads),
    quotaHealthLevel(metrics.writes24h, freeTierLimits.writes),
    quotaHealthLevel(metrics.deletes24h, freeTierLimits.deletes),
    quotaHealthLevel(metrics.storageBytes, freeTierLimits.storageBytes),
    metrics.resourceExhausted24h > 0 ? 'critical' : 'healthy',
    metrics.deniedRules24h >= 100 ? 'warning' : 'healthy',
  ] satisfies OperationalSeverity[]
  const severity = overallHealthLevel(levels)
  const issues: OperationalIssue[] = []
  const quotaItems = [
    ['reads', 'lượt đọc', metrics.reads24h, freeTierLimits.reads],
    ['writes', 'lượt ghi', metrics.writes24h, freeTierLimits.writes],
    ['deletes', 'lượt xóa', metrics.deletes24h, freeTierLimits.deletes],
    ['storage', 'dung lượng', metrics.storageBytes, freeTierLimits.storageBytes],
  ] as const
  quotaItems.forEach(([code, label, value, limit]) => {
    const itemSeverity = quotaHealthLevel(value, limit)
    if (itemSeverity !== 'warning' && itemSeverity !== 'critical') return
    issues.push({
      service: 'firestore', code: `quota-${code}`, severity: itemSeverity,
      title: `Firestore gần giới hạn ${label}`,
      message: `${label}: ${formatNumber(value)} / ${formatNumber(limit)} (${Math.round(value / limit * 100)}%) trong cửa sổ theo dõi.`,
    })
  })
  if (metrics.resourceExhausted24h > 0) issues.push({
    service: 'firestore', code: 'resource-exhausted', severity: 'critical',
    title: 'Firestore đã ghi nhận lỗi hết quota',
    message: `Có ${formatNumber(metrics.resourceExhausted24h)} yêu cầu RESOURCE_EXHAUSTED/quota trong 24 giờ gần nhất.`,
  })
  if (metrics.deniedRules24h >= 100) issues.push({
    service: 'firestore', code: 'rules-denied-spike', severity: 'warning',
    title: 'Security Rules từ chối nhiều yêu cầu',
    message: `${formatNumber(metrics.deniedRules24h)} lượt bị từ chối trong 24 giờ gần nhất.`,
  })
  return {
    status: {
      service: 'firestore', severity, title: 'Firebase / Firestore',
      message: `${formatNumber(metrics.reads24h)} đọc · ${formatNumber(metrics.writes24h)} ghi · ${formatNumber(metrics.deletes24h)} xóa / 24h · ${formatBytes(metrics.storageBytes)} dữ liệu.`,
      metrics,
    },
    issues,
  }
}

function driveIssue(status: DriveStorageStatus): OperationalIssue | null {
  if (status.usagePercent == null) return null
  const severity = status.usagePercent >= 95 ? 'critical' : status.usagePercent >= 80 ? 'warning' : null
  if (!severity) return null
  return {
    service: 'drive', code: 'storage-quota', severity,
    title: 'Google Drive gần đầy',
    message: `Đã dùng ${status.usagePercent}% dung lượng của tài khoản lưu trữ.`,
  }
}

async function checkDrive(): Promise<{ status: OperationalServiceStatus; issues: OperationalIssue[] }> {
  const drive = await getDriveStorageStatus()
  const issue = driveIssue(drive)
  return {
    status: {
      service: 'drive', severity: issue?.severity || 'healthy', title: 'Google Drive',
      message: issue?.message || (drive.usagePercent == null
        ? `Kết nối bình thường · đã dùng ${formatBytes(drive.usageBytes)}.`
        : `Đã dùng ${drive.usagePercent}% (${formatBytes(drive.usageBytes)} / ${formatBytes(drive.limitBytes || 0)}).`),
      metrics: {
        accountEmail: drive.accountEmail,
        usageBytes: drive.usageBytes,
        limitBytes: drive.limitBytes,
        usagePercent: drive.usagePercent,
      },
    },
    issues: issue ? [issue] : [],
  }
}

async function checkJobs(now: Date): Promise<{ statuses: OperationalServiceStatus[]; issues: OperationalIssue[] }> {
  const [archiveRuns, jobRuns] = await Promise.all([
    adminDb.collection('archiveRuns').get(),
    adminDb.collection('systemJobs').get(),
  ])
  const failedArchiveCandidate = archiveRuns.docs
    .filter((item) => item.get('state') === 'failed')
    .sort((left, right) => Number((right.get('failedAt') as Timestamp | undefined)?.toMillis() || 0) - Number((left.get('failedAt') as Timestamp | undefined)?.toMillis() || 0))[0]
  const latestArchiveSuccess = archiveRuns.docs
    .map((item) => item.get('verifiedAt') || item.get('deletedAt'))
    .filter((value): value is Timestamp => value instanceof Timestamp)
    .sort((left, right) => right.toMillis() - left.toMillis())[0]
  const failedAt = failedArchiveCandidate?.get('failedAt')
  const failedArchive = failedArchiveCandidate
    && failedAt instanceof Timestamp
    && now.getTime() - failedAt.toMillis() <= 9 * 24 * 60 * 60 * 1000
    && (!latestArchiveSuccess || failedAt.toMillis() > latestArchiveSuccess.toMillis())
    ? failedArchiveCandidate
    : null
  const archiveStale = !latestArchiveSuccess || now.getTime() - latestArchiveSuccess.toMillis() > 9 * 24 * 60 * 60 * 1000
  const archiveIssues: OperationalIssue[] = []
  if (failedArchive) archiveIssues.push({
    service: 'archive', code: 'archive-failed', severity: 'critical',
    title: 'Lưu Google Drive đã thất bại',
    message: String(failedArchive.get('error') || 'Bản lưu gần nhất không thành công.').slice(0, 300),
  })
  else if (archiveStale) archiveIssues.push({
    service: 'archive', code: 'archive-stale', severity: 'warning',
    title: 'Chưa có bản lưu Drive mới',
    message: 'Không tìm thấy bản lưu được xác minh trong 9 ngày gần nhất.',
  })
  const failedJobs = jobRuns.docs.filter((item) => item.get('state') === 'failed')
  const staleJobs = jobRuns.docs.filter((item) => {
    const lastSuccessAt = item.get('lastSuccessAt')
    return !(lastSuccessAt instanceof Timestamp) || now.getTime() - lastSuccessAt.toMillis() > 9 * 24 * 60 * 60 * 1000
  })
  const cronIssues: OperationalIssue[] = [
    ...failedJobs.map((item): OperationalIssue => ({
      service: 'cron', code: `job-failed-${item.id}`, severity: 'critical',
      title: `Tác vụ ${item.id} thất bại`, message: String(item.get('lastError') || 'Cron không chạy thành công.').slice(0, 300),
    })),
    ...staleJobs.filter((item) => !failedJobs.some((failed) => failed.id === item.id)).map((item): OperationalIssue => ({
      service: 'cron', code: `job-stale-${item.id}`, severity: 'warning',
      title: `Tác vụ ${item.id} chưa chạy lại`, message: 'Không có lần chạy thành công trong 9 ngày gần nhất.',
    })),
  ]
  return {
    statuses: [
      { service: 'archive', severity: archiveIssues[0]?.severity || 'healthy', title: 'Bản lưu dữ liệu', message: archiveIssues[0]?.message || 'Các bản lưu gần nhất đã được xác minh.' },
      { service: 'cron', severity: cronIssues[0]?.severity || 'healthy', title: 'Tác vụ tự động', message: cronIssues[0]?.message || 'Các tác vụ tự động đang hoạt động.' },
    ],
    issues: [...archiveIssues, ...cronIssues],
  }
}

async function operationalRecipients(): Promise<string[]> {
  const snapshot = await adminDb.collection('employees').where('role', 'in', ['admin', 'manager', 'director']).get()
  return snapshot.docs.filter((item) => item.get('status') === 'active').map((item) => item.id)
}

async function notifyIssue(issue: OperationalIssue): Promise<void> {
  const alertRef = adminDb.collection('operationalAlerts').doc(`${issue.service}-${issue.code}`)
  const now = Timestamp.now()
  const shouldNotify = await adminDb.runTransaction(async (transaction) => {
    const current = await transaction.get(alertRef)
    const lastNotifiedAt = current.get('lastNotifiedAt')
    const severityChanged = current.get('severity') !== issue.severity
    const cooldownElapsed = !(lastNotifiedAt instanceof Timestamp) || now.toMillis() - lastNotifiedAt.toMillis() >= 12 * 60 * 60 * 1000
    const notify = !current.exists || current.get('status') !== 'active' || severityChanged || cooldownElapsed
    transaction.set(alertRef, {
      ...issue,
      status: 'active',
      occurrenceCount: Number(current.get('occurrenceCount') || 0) + 1,
      firstDetectedAt: current.get('firstDetectedAt') || now,
      lastDetectedAt: now,
      updatedAt: now,
      ...(notify ? { lastNotifiedAt: now } : {}),
    }, { merge: true })
    return notify
  })
  if (!shouldNotify) return
  const recipients = await operationalRecipients()
  const batch = adminDb.batch()
  recipients.forEach((employeeId) => batch.set(
    adminDb.collection('notifications').doc(`operations-${employeeId}-${issue.service}-${issue.code}-${now.toDate().toISOString().slice(0, 13)}`),
    {
      employeeId,
      title: issue.title,
      message: issue.message,
      type: issue.severity === 'critical' ? 'error' : 'warning',
      isRead: false,
      createdAt: now,
    },
    { merge: true }
  ))
  if (recipients.length) await batch.commit()
  try {
    await sendOperationalEmail({
      subject: `[${issue.severity === 'critical' ? 'KHẨN CẤP' : 'CẢNH BÁO'}] ${issue.title}`,
      text: [issue.message, '', `Dịch vụ: ${issue.service}`, `Mã: ${issue.code}`, `Thời gian: ${now.toDate().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`].join('\n'),
    })
  } catch (error) {
    console.error('Operational alert email failed:', cleanError(error))
    await alertRef.set({ emailError: cleanError(error), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  }
}

async function resolveMissingAlerts(activeKeys: Set<string>): Promise<void> {
  const active = await adminDb.collection('operationalAlerts').where('status', '==', 'active').get()
  const resolved = active.docs.filter((item) => !activeKeys.has(item.id))
  if (!resolved.length) return
  const batch = adminDb.batch()
  resolved.forEach((item) => batch.set(item.ref, { status: 'resolved', resolvedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true }))
  await batch.commit()
}

function failedService(service: OperationalIssue['service'], title: string, error: unknown): { status: OperationalServiceStatus; issue: OperationalIssue } {
  const message = cleanError(error)
  const permissionProblem = /permission|403|monitoring\.timeSeries\.list/i.test(message)
  const driveFull = service === 'drive' && /storageQuotaExceeded|storage quota.*exceed|drive.*full/i.test(message)
  const driveRateLimited = service === 'drive' && /rateLimitExceeded|userRateLimitExceeded|429/i.test(message)
  const driveAuthFailed = service === 'drive' && /invalid_grant|OAuth token|401/i.test(message)
  const firestoreExhausted = service === 'firestore' && /resource[_ -]?exhausted|quota.*exceed|429/i.test(message)
  const code = driveFull ? 'storage-full'
    : driveRateLimited ? 'rate-limited'
      : driveAuthFailed ? 'oauth-invalid'
        : firestoreExhausted ? 'resource-exhausted'
          : permissionProblem ? 'monitoring-permission'
            : 'health-check-failed'
  const severity: OperationalIssue['severity'] = driveFull || driveAuthFailed || firestoreExhausted
    ? 'critical'
    : permissionProblem || driveRateLimited
      ? 'warning'
      : 'critical'
  const issue: OperationalIssue = {
    service,
    code,
    severity,
    title: driveFull ? 'Google Drive đã đầy'
      : driveRateLimited ? 'Google Drive đang giới hạn lượt gọi'
        : driveAuthFailed ? 'Kết nối Google Drive đã hết hiệu lực'
          : firestoreExhausted ? 'Firestore đã hết hoặc vượt quota'
            : permissionProblem ? `${title} thiếu quyền giám sát`
              : `Không kiểm tra được ${title}`,
    message: permissionProblem
      ? 'Service account cần quyền Monitoring Viewer và Monitoring API phải được bật.'
      : message,
  }
  return { status: { service, severity: issue.severity, title, message: issue.message }, issue }
}

export async function runOperationalHealthCheck(now = new Date()): Promise<OperationalHealthSnapshot> {
  const services: OperationalServiceStatus[] = []
  const issues: OperationalIssue[] = []
  try {
    const firestore = await checkFirestore(now)
    services.push(firestore.status)
    issues.push(...firestore.issues)
  } catch (error) {
    console.error('Operational Firestore health check failed:', cleanError(error))
    const failed = failedService('firestore', 'Firebase / Firestore', error)
    services.push(failed.status)
    issues.push(failed.issue)
  }
  try {
    const drive = await checkDrive()
    services.push(drive.status)
    issues.push(...drive.issues)
  } catch (error) {
    console.error('Operational Drive health check failed:', cleanError(error))
    const failed = failedService('drive', 'Google Drive', error)
    services.push(failed.status)
    issues.push(failed.issue)
  }
  try {
    const jobs = await checkJobs(now)
    services.push(...jobs.statuses)
    issues.push(...jobs.issues)
  } catch (error) {
    console.error('Operational job health check failed:', cleanError(error))
    const failed = failedService('cron', 'tác vụ tự động', error)
    services.push(failed.status)
    issues.push(failed.issue)
  }
  const overall = overallHealthLevel(services.map((item) => item.severity))
  await adminDb.collection('systemHealth').doc('current').set({
    overall,
    checkedAt: Timestamp.fromDate(now),
    services,
    emailFallbackConfigured: operationalEmailConfigured(),
    emailFallbackAddress: process.env.OPERATIONS_ALERT_EMAIL?.trim() || process.env.GMAIL_FROM_EMAIL?.trim() || '',
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  for (const issue of issues) await notifyIssue(issue)
  await resolveMissingAlerts(new Set(issues.map((issue) => `${issue.service}-${issue.code}`)))
  return getOperationalHealthSnapshot()
}

export async function reportOperationalFailure(issue: OperationalIssue): Promise<void> {
  try {
    await notifyIssue(issue)
  } catch (error) {
    console.error('Could not persist operational alert:', cleanError(error))
    await sendOperationalEmail({ subject: `[KHẨN CẤP] ${issue.title}`, text: `${issue.message}\n\nFirestore không lưu được cảnh báo này.` })
  }
}

export async function recordOperationalJobSuccess(jobId: string, details: Record<string, unknown> = {}): Promise<void> {
  await adminDb.collection('systemJobs').doc(jobId).set({
    state: 'healthy', lastSuccessAt: FieldValue.serverTimestamp(), lastError: FieldValue.delete(), details, updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
}

export async function recordOperationalJobFailure(jobId: string, error: unknown): Promise<void> {
  const message = cleanError(error)
  try {
    await adminDb.collection('systemJobs').doc(jobId).set({
      state: 'failed', lastError: message, lastFailedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  } finally {
    await reportOperationalFailure({ service: 'cron', code: `job-failed-${jobId}`, severity: 'critical', title: `Tác vụ ${jobId} thất bại`, message })
  }
}

function isoTimestamp(value: unknown): string {
  return value instanceof Timestamp ? value.toDate().toISOString() : ''
}

async function getOperationalHealthSnapshot(): Promise<OperationalHealthSnapshot> {
  const [health, alerts] = await Promise.all([
    adminDb.collection('systemHealth').doc('current').get(),
    adminDb.collection('operationalAlerts').orderBy('updatedAt', 'desc').limit(30).get(),
  ])
  return {
    overall: (health.get('overall') || 'unknown') as OperationalSeverity,
    checkedAt: isoTimestamp(health.get('checkedAt')),
    services: Array.isArray(health.get('services')) ? health.get('services') : [],
    emailFallbackConfigured: health.get('emailFallbackConfigured') === true,
    emailFallbackAddress: String(health.get('emailFallbackAddress') || process.env.OPERATIONS_ALERT_EMAIL?.trim() || process.env.GMAIL_FROM_EMAIL?.trim() || ''),
    alerts: alerts.docs.map((item) => ({
      service: item.get('service'), code: item.get('code'), severity: item.get('severity'), title: item.get('title'), message: item.get('message'),
      status: item.get('status'), updatedAt: isoTimestamp(item.get('updatedAt')), lastNotifiedAt: isoTimestamp(item.get('lastNotifiedAt')) || undefined,
    })),
  }
}

export async function getOperationalHealth(actor: RequestActor): Promise<OperationalHealthSnapshot> {
  requireManager(actor)
  return getOperationalHealthSnapshot()
}

export async function runOperationalHealthNow(actor: RequestActor): Promise<OperationalHealthSnapshot> {
  requireManager(actor)
  return runOperationalHealthCheck()
}
