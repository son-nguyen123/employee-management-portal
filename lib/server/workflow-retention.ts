import 'server-only'

import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/server/firebase-admin'

const DELETE_BATCH_SIZE = 100

export async function cleanupExpiredWorkflowRequests(now = new Date()): Promise<{ deleted: number; hasMore: boolean }> {
  const snapshot = await adminDb.collection('workflowRequests')
    .where('expiresAt', '<=', Timestamp.fromDate(now))
    .orderBy('expiresAt', 'asc')
    .limit(DELETE_BATCH_SIZE)
    .get()

  if (snapshot.empty) return { deleted: 0, hasMore: false }

  const batch = adminDb.batch()
  snapshot.docs.forEach((document) => batch.delete(document.ref))
  await batch.commit()
  return { deleted: snapshot.size, hasMore: snapshot.size === DELETE_BATCH_SIZE }
}
