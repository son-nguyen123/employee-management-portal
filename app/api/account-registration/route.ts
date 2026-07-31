import { NextResponse } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/server/firebase-admin'

export const runtime = 'nodejs'

export async function GET() {
  const snapshot = await adminDb.collection('managementSettings').doc('accountRegistration').get()
  const closesAt = snapshot.get('closesAt')
  const closesAtDate = closesAt instanceof Timestamp ? closesAt.toDate() : null
  return NextResponse.json({
    isOpen: snapshot.get('isOpen') === true && !!closesAtDate && closesAtDate.getTime() > Date.now(),
    closesAt: closesAtDate?.toISOString() || null,
  })
}
