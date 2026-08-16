import 'server-only'

import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/server/firebase-admin'

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1'

function env(name: string): string {
  return process.env[name]?.trim() || ''
}

export function auditEmailEnvironmentEnabled(): boolean {
  return process.env.AUDIT_EMAIL_ENABLED === 'true'
}

export function auditEmailConfigured(): boolean {
  return auditEmailEnvironmentEnabled() && Boolean(
    env('GMAIL_CLIENT_ID') &&
    env('GMAIL_CLIENT_SECRET') &&
    env('GMAIL_REFRESH_TOKEN') &&
    env('GMAIL_FROM_EMAIL')
  )
}

async function gmailAccessToken(): Promise<string> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GMAIL_CLIENT_ID'),
      client_secret: env('GMAIL_CLIENT_SECRET'),
      refresh_token: env('GMAIL_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  })
  const result = await response.json() as { access_token?: string; error?: string }
  if (!response.ok || !result.access_token) {
    throw new Error(`Gmail OAuth failed: ${result.error || response.status}`)
  }
  return result.access_token
}

function encodedHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

function rawEmail(params: { to: string; subject: string; text: string }): string {
  const message = [
    `From: ${env('GMAIL_FROM_NAME') || 'Trí Candy'} <${env('GMAIL_FROM_EMAIL')}>`,
    `To: ${params.to}`,
    `Subject: ${encodedHeader(params.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(params.text, 'utf8').toString('base64'),
  ].join('\r\n')
  return Buffer.from(message, 'utf8').toString('base64url')
}

async function sendGmail(params: { to: string; subject: string; text: string }): Promise<string> {
  const token = await gmailAccessToken()
  const response = await fetch(`${GMAIL_API}/users/me/messages/send`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ raw: rawEmail(params) }),
    cache: 'no-store',
  })
  const result = await response.json() as { id?: string; error?: { message?: string } }
  if (!response.ok || !result.id) {
    throw new Error(`Gmail send failed: ${result.error?.message || response.status}`)
  }
  return result.id
}

export function operationalEmailConfigured(): boolean {
  return Boolean(
    env('GMAIL_CLIENT_ID') &&
    env('GMAIL_CLIENT_SECRET') &&
    env('GMAIL_REFRESH_TOKEN') &&
    env('GMAIL_FROM_EMAIL') &&
    (env('OPERATIONS_ALERT_EMAIL') || env('GMAIL_FROM_EMAIL'))
  )
}

export async function sendOperationalEmail(params: { subject: string; text: string }): Promise<string | null> {
  if (!operationalEmailConfigured()) return null
  return sendGmail({
    to: env('OPERATIONS_ALERT_EMAIL') || env('GMAIL_FROM_EMAIL'),
    subject: params.subject,
    text: params.text,
  })
}

export async function dispatchQueuedAuditEmails(limit = 3): Promise<void> {
  if (!auditEmailConfigured()) return
  const setting = await adminDb.collection('managementSettings').doc('auditReceipts').get()
  if (setting.get('emailEnabled') !== true) return

  const staleSending = await adminDb.collection('auditEmailOutbox')
    .where('state', '==', 'sending')
    .limit(10)
    .get()
  const staleCutoff = Date.now() - 10 * 60 * 1000
  const recoveryBatch = adminDb.batch()
  let recoveryCount = 0
  staleSending.docs.forEach((document) => {
    const lastAttemptAt = document.get('lastAttemptAt')
    if (lastAttemptAt instanceof Timestamp && lastAttemptAt.toMillis() >= staleCutoff) return
    recoveryBatch.set(document.ref, {
      state: 'queued',
      lastError: 'Recovered after an interrupted send attempt.',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    recoveryCount += 1
  })
  if (recoveryCount) await recoveryBatch.commit()

  const snapshot = await adminDb.collection('auditEmailOutbox')
    .where('state', '==', 'queued')
    .limit(Math.max(1, Math.min(limit, 10)))
    .get()

  for (const document of snapshot.docs) {
    const data = document.data()
    if (
      typeof data.to !== 'string' ||
      typeof data.subject !== 'string' ||
      typeof data.text !== 'string'
    ) {
      await document.ref.set({
        state: 'failed',
        lastError: 'Invalid email outbox payload.',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      continue
    }

    const attempts = Number(data.attempts || 0) + 1
    const claimed = await adminDb.runTransaction(async (transaction) => {
      const [current, currentSetting] = await Promise.all([
        transaction.get(document.ref),
        transaction.get(adminDb.collection('managementSettings').doc('auditReceipts')),
      ])
      if (
        !current.exists ||
        current.get('state') !== 'queued' ||
        currentSetting.get('emailEnabled') !== true
      ) {
        return false
      }
      transaction.set(document.ref, {
        state: 'sending',
        attempts,
        lastAttemptAt: Timestamp.now(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return true
    })
    if (!claimed) continue

    try {
      const gmailMessageId = await sendGmail({
        to: data.to,
        subject: data.subject,
        text: data.text,
      })
      await document.ref.set({
        state: 'sent',
        gmailMessageId,
        sentAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    } catch (error) {
      await document.ref.set({
        state: attempts >= 5 ? 'failed' : 'queued',
        lastError: error instanceof Error ? error.message.slice(0, 300) : 'Unknown Gmail error',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }
  }
}

export async function cancelQueuedAuditEmails(): Promise<number> {
  let cancelled = 0
  while (true) {
    const snapshot = await adminDb.collection('auditEmailOutbox')
      .where('state', '==', 'queued')
      .limit(400)
      .get()
    if (snapshot.empty) break
    const batch = adminDb.batch()
    snapshot.docs.forEach((document) => {
      batch.set(document.ref, {
        state: 'cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    })
    await batch.commit()
    cancelled += snapshot.size
  }
  return cancelled
}
