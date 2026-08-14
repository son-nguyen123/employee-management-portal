import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { ApiError, authenticateRequest } from '@/lib/server/api-auth'
import { adminAuth, adminDb } from '@/lib/server/firebase-admin'
import { invalidateMonthDataCache } from '@/lib/server/month-data-cache'

export const runtime = 'nodejs'

const profileKeys = new Set(['fullName', 'phone', 'photoURL', 'facebookUrl', 'bankName', 'bankAccountName', 'bankAccountNumber'])
const bankKeys = ['bankName', 'bankAccountName', 'bankAccountNumber'] as const

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'Dữ liệu hồ sơ không hợp lệ.')
  }
  return value as Record<string, unknown>
}

function textValue(value: unknown, field: string, max: number, required = true): string {
  if (value == null && !required) return ''
  if (typeof value !== 'string') throw new ApiError(400, `${field} không hợp lệ.`)
  const result = value.trim()
  if ((required && !result) || result.length > max) {
    throw new ApiError(400, `${field} không hợp lệ.`)
  }
  return result
}

function urlValue(value: unknown, field: string): string {
  const result = textValue(value, field, 500)
  if (!/^https?:\/\//i.test(result)) throw new ApiError(400, `${field} phải là đường dẫn http hoặc https.`)
  return result
}

function bankAccountValue(value: unknown): string {
  const result = textValue(value, 'Số tài khoản', 24)
  if (!/^\d{6,24}$/.test(result)) throw new ApiError(400, 'Số tài khoản chỉ gồm 6–24 chữ số.')
  return result
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request)
    const body = objectBody(await request.json())
    const unexpectedKey = Object.keys(body).find((key) => !profileKeys.has(key))
    if (unexpectedKey) throw new ApiError(400, `Không được cập nhật trường ${unexpectedKey}.`)

    const profileRef = adminDb.collection('employees').doc(actor.uid)
    const profile = await profileRef.get()
    if (!profile.exists) throw new ApiError(404, 'Chưa tìm thấy hồ sơ nhân viên.')

    const current = profile.data() || {}
    const fullName = 'fullName' in body
      ? textValue(body.fullName, 'Họ và tên', 100)
      : textValue(current.fullName, 'Họ và tên', 100)
    const phone = 'phone' in body
      ? textValue(body.phone, 'Số điện thoại', 30)
      : textValue(current.phone, 'Số điện thoại', 30)
    const photoURL = 'photoURL' in body
      ? urlValue(body.photoURL, 'Ảnh đại diện')
      : urlValue(current.photoURL, 'Ảnh đại diện')
    const facebookUrl = 'facebookUrl' in body
      ? urlValue(body.facebookUrl, 'Facebook')
      : urlValue(current.facebookUrl, 'Facebook')

    const updates: Record<string, unknown> = { fullName, phone, photoURL, facebookUrl }
    const hasBankUpdate = bankKeys.some((key) => key in body)
    if (hasBankUpdate) {
      const bankValues = bankKeys.map((key) => textValue(body[key], key, key === 'bankAccountName' ? 150 : 100, false))
      if (bankValues.some(Boolean)) {
        if (bankValues.some((value) => !value)) {
          throw new ApiError(400, 'Vui lòng điền đủ ngân hàng, tên chủ tài khoản và số tài khoản.')
        }
        updates.bankName = bankValues[0]
        updates.bankAccountName = bankValues[1]
        updates.bankAccountNumber = bankAccountValue(bankValues[2])
      } else {
        // Clear the optional bank section so legacy values cannot remain.
        bankKeys.forEach((key) => { updates[key] = FieldValue.delete() })
      }
    }

    await profileRef.update({ ...updates, updatedAt: FieldValue.serverTimestamp() })
    invalidateMonthDataCache()
    await adminAuth.updateUser(actor.uid, { displayName: fullName, photoURL })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Profile update failed:', error)
    return NextResponse.json({ error: 'Chưa thể lưu thông tin hồ sơ.' }, { status: 500 })
  }
}
