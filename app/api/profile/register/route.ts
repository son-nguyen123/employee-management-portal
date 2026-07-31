import { NextResponse } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '@/lib/server/firebase-admin'

export const runtime = 'nodejs'

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export async function POST(request: Request) {
  try {
    const registrationSetting = await adminDb.collection('managementSettings').doc('accountRegistration').get()
    const closesAt = registrationSetting.get('closesAt')
    if (registrationSetting.get('isOpen') !== true || !(closesAt instanceof Timestamp) || closesAt.toDate().getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Cổng tạo tài khoản đã đóng. Vui lòng liên hệ admin để được mở lại.' }, { status: 403 })
    }
    const authorization = request.headers.get('authorization')
    if (!authorization?.startsWith('Bearer ')) return NextResponse.json({ error: 'Bạn cần đăng nhập.' }, { status: 401 })
    const token = await adminAuth.verifyIdToken(authorization.slice(7), true)
    const body = await request.json() as Record<string, unknown>
    const employeeCode = clean(body.employeeCode, 30).toUpperCase()
    const codeKey = employeeCode.replace(/[^A-Z0-9]/g, '')
    const fullName = clean(body.fullName, 100)
    const phone = clean(body.phone, 30)
    const photoURL = clean(body.photoURL, 500)
    const facebookUrl = clean(body.facebookUrl, 500)
    if (codeKey.length < 3 || !fullName || !phone || !/^https?:\/\//i.test(photoURL) || !/^https?:\/\//i.test(facebookUrl)) {
      return NextResponse.json({ error: 'Thông tin hồ sơ không hợp lệ.' }, { status: 400 })
    }
    const legacyEmployees = await adminDb.collection('employees').get()
    const legacyDuplicate = legacyEmployees.docs.find((item) =>
      String(item.get('employeeCode') || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === codeKey && item.id !== token.uid
    )
    if (legacyDuplicate) {
      return NextResponse.json({ error: 'Mã nhân viên này đã được liên kết với tài khoản khác.' }, { status: 409 })
    }
    const employeeRef = adminDb.collection('employees').doc(token.uid)
    const codeRef = adminDb.collection('employeeCodes').doc(codeKey)
    const managerIds = (await adminDb.collection('employees').where('status', '==', 'active').get()).docs
      .filter((item) => item.get('role') === 'admin')
      .map((item) => item.id)
    await adminDb.runTransaction(async (transaction) => {
      const [existing, reservation] = await Promise.all([transaction.get(employeeRef), transaction.get(codeRef)])
      if (existing.exists) throw new Error('PROFILE_EXISTS')
      if (reservation.exists && reservation.get('uid') !== token.uid) throw new Error('CODE_EXISTS')
      const now = FieldValue.serverTimestamp()
      transaction.create(employeeRef, {
        uid: token.uid,
        employeeCode,
        fullName,
        phone,
        email: token.email || '',
        photoURL,
        facebookUrl,
        ...(clean(body.bankName, 100) && clean(body.bankAccountName, 150) && clean(body.bankAccountNumber, 24) ? {
          bankName: clean(body.bankName, 100),
          bankAccountName: clean(body.bankAccountName, 150),
          bankAccountNumber: clean(body.bankAccountNumber, 24),
        } : {}),
        role: 'employee',
        status: 'pending',
        joinDate: Timestamp.now(),
        createdAt: now,
        updatedAt: now,
      })
      transaction.set(codeRef, { uid: token.uid, employeeCode, createdAt: now })
      managerIds.forEach((managerId) => transaction.set(
        adminDb.collection('notifications').doc(`account-approval-${managerId}-${token.uid}`),
        { employeeId: managerId, title: 'Tài khoản mới chờ duyệt', message: `${fullName} · ${employeeCode} vừa đăng ký tài khoản.`, type: 'warning', isRead: false, createdAt: now }
      ))
    })
    return NextResponse.json({ ok: true, status: 'pending' })
  } catch (error) {
    const message = error instanceof Error && error.message === 'CODE_EXISTS'
      ? 'Mã nhân viên này đã được liên kết với tài khoản khác.'
      : error instanceof Error && error.message === 'PROFILE_EXISTS'
        ? 'Tài khoản đã có hồ sơ.'
        : 'Chưa thể gửi hồ sơ đăng ký.'
    return NextResponse.json({ error: message }, { status: message.includes('Mã nhân viên') ? 409 : 400 })
  }
}
