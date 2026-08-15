import { NextResponse } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '@/lib/server/firebase-admin'
import { isFactoryId } from '@/lib/models/factory'
import { invalidateMonthDataCache } from '@/lib/server/month-data-cache'
import { employeeCodeAssignedToAnother, isValidEmployeeCode, normalizeEmployeeCode } from '@/lib/models/employee-code'

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
    const employeeCode = normalizeEmployeeCode(body.employeeCode)
    const codeKey = employeeCode
    const fullName = clean(body.fullName, 100)
    const phone = clean(body.phone, 30)
    const photoURL = clean(body.photoURL, 500)
    const facebookUrl = clean(body.facebookUrl, 500)
    const scheduleMode = body.scheduleMode === 'fixed' ? 'fixed' : 'rotating'
    const factoryId = isFactoryId(body.factoryId) ? body.factoryId : null
    if (!isValidEmployeeCode(employeeCode)) {
      return NextResponse.json({ error: 'Mã nhân viên chỉ được gồm từ 1 đến 9 chữ số.' }, { status: 400 })
    }
    if (!factoryId || !fullName || !phone || !/^https?:\/\//i.test(photoURL) || !/^https?:\/\//i.test(facebookUrl)) {
      return NextResponse.json({ error: 'Thông tin hồ sơ không hợp lệ.' }, { status: 400 })
    }
    const legacyEmployees = await adminDb.collection('employees').get()
    const codeAlreadyAssigned = employeeCodeAssignedToAnother(
      legacyEmployees.docs.map((item) => ({ uid: item.id, employeeCode: item.get('employeeCode') })),
      employeeCode,
      token.uid,
    )
    if (codeAlreadyAssigned) {
      return NextResponse.json({ error: 'Mã nhân viên này đã được liên kết với tài khoản khác.' }, { status: 409 })
    }
    const employeeRef = adminDb.collection('employees').doc(token.uid)
    const codeRef = adminDb.collection('employeeCodes').doc(codeKey)
    const managerIds = (await adminDb.collection('employees').where('status', '==', 'active').get()).docs
      .filter((item) => item.get('role') === 'director' || (
        ['admin', 'manager'].includes(String(item.get('role'))) &&
        String(item.get('factoryId') || 'factory-1') === factoryId
      ))
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
        factoryId,
        scheduleMode,
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
      // Reservations are permanent across pending, active, and inactive states.
      // Returning employees must reactivate their original account.
      transaction.set(codeRef, { uid: token.uid, employeeCode, createdAt: now })
      managerIds.forEach((managerId) => transaction.set(
        adminDb.collection('notifications').doc(`account-approval-${managerId}-${token.uid}`),
        { employeeId: managerId, title: 'Tài khoản mới chờ duyệt', message: `${fullName} · ${employeeCode} vừa đăng ký tài khoản.`, type: 'warning', isRead: false, createdAt: now }
      ))
    })
    invalidateMonthDataCache()
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
