import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/server/api-auth'
import { adminDb } from '@/lib/server/firebase-admin'

export const runtime = 'nodejs'

function isoDate(value: unknown): string | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString()
  }
  if (value instanceof Date) return value.toISOString()
  return null
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request)
    if (actor.role !== 'director') {
      return NextResponse.json({ error: 'Chỉ sếp/giám đốc được xem danh sách ứng lương đã duyệt.' }, { status: 403 })
    }

    const [advanceSnapshot, employeeSnapshot] = await Promise.all([
      adminDb.collection('salaryAdvances').get(),
      adminDb.collection('employees').get(),
    ])
    const employees = new Map(employeeSnapshot.docs.map((item) => [item.id, item.data()]))
    const items = advanceSnapshot.docs
      .filter((item) => item.get('status') === 'Approved')
      .map((item) => {
        const advance = item.data()
        const employee = employees.get(String(advance.employeeId)) || {}
        return {
          id: item.id,
          employeeId: String(advance.employeeId || ''),
          employeeName: String(employee.fullName || 'Nhân viên'),
          employeeCode: String(employee.employeeCode || advance.employeeId || ''),
          photoURL: typeof employee.photoURL === 'string' ? employee.photoURL : '',
          phone: typeof employee.phone === 'string' ? employee.phone : '',
          facebookUrl: typeof employee.facebookUrl === 'string' ? employee.facebookUrl : '',
          amount: Number(advance.amount || 0),
          reason: String(advance.reason || ''),
          bankName: typeof employee.bankName === 'string' ? employee.bankName : '',
          bankAccountName: typeof employee.bankAccountName === 'string' ? employee.bankAccountName : '',
          bankAccountNumber: typeof employee.bankAccountNumber === 'string' ? employee.bankAccountNumber : '',
          approvedAt: isoDate(advance.reviewedAt || advance.updatedAt || advance.createdAt),
        }
      })
      .sort((left, right) => String(right.approvedAt || '').localeCompare(String(left.approvedAt || '')))

    return NextResponse.json({ items }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    console.error('Director salary advances failed:', error)
    return NextResponse.json({ error: 'Chưa thể tải danh sách ứng lương đã duyệt.' }, { status: 500 })
  }
}
