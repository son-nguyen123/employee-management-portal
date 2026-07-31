import { NextResponse } from 'next/server'
import { Packer, Paragraph } from 'docx'
import { Timestamp } from 'firebase-admin/firestore'
import { authenticateRequest } from '@/lib/server/api-auth'
import { adminDb } from '@/lib/server/firebase-admin'
import {
  landscapeReport,
  money,
  reportTable,
  reportTitle,
} from '@/lib/server/word-report'

export const runtime = 'nodejs'

function monthWindow(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const start = new Date(`${month}-01T00:00:00+07:00`)
  const nextYear = monthNumber === 12 ? year + 1 : year
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1
  const end = new Date(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+07:00`)
  return { start, end }
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request)
    if (!['admin', 'manager'].includes(actor.role)) {
      return NextResponse.json({ error: 'Bạn không có quyền xuất bảng phạt.' }, { status: 403 })
    }
    const month = new URL(request.url).searchParams.get('month') || ''
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return NextResponse.json({ error: 'Tháng xuất không hợp lệ.' }, { status: 400 })
    }

    const { start, end } = monthWindow(month)
    const [penalties, employees] = await Promise.all([
      adminDb.collection('penalties')
        .where('penaltyDate', '>=', Timestamp.fromDate(start))
        .where('penaltyDate', '<', Timestamp.fromDate(end))
        .get(),
      adminDb.collection('employees').get(),
    ])
    const employeeMap = new Map(employees.docs.map((snapshot) => [snapshot.id, snapshot.data()]))
    const totals = new Map<string, number>()
    penalties.docs.forEach((snapshot) => {
      const penalty = snapshot.data()
      if (penalty.status === 'Cancelled') return
      const employeeId = String(penalty.employeeId || '')
      totals.set(employeeId, (totals.get(employeeId) || 0) + Number(penalty.amount || 0))
    })

    const rows = [...totals.entries()]
      .map(([employeeId, total]) => {
        const employee = employeeMap.get(employeeId) || {}
        return {
          name: String(employee.fullName || 'Nhân viên'),
          code: String(employee.employeeCode || employeeId),
          total,
        }
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'vi'))
      .map((row, index) => [String(index + 1), row.name, row.code, money(row.total)])
    const grandTotal = [...totals.values()].reduce((sum, amount) => sum + amount, 0)
    if (rows.length) rows.push(['', 'TỔNG CỘNG', '', money(grandTotal)])

    const children = [
      ...reportTitle(
        `BẢNG TỔNG HỢP PHẠT THÁNG ${month.slice(5)}/${month.slice(0, 4)}`,
        'Chỉ gồm các khoản đang áp dụng; khoản đã hủy không tính vào tổng.'
      ),
      rows.length
        ? reportTable(
            ['STT', 'Họ và tên', 'Mã nhân viên', 'Tổng tiền phạt'],
            rows,
            [700, 5000, 2500, 5960],
            [0, 2, 3]
          )
        : new Paragraph('Tháng này chưa có khoản phạt đang áp dụng.'),
    ]
    const buffer = await Packer.toBuffer(landscapeReport(children))
    return new Response(buffer, {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-disposition': `attachment; filename="bang-phat-${month}.docx"`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Penalty Word export failed:', error)
    return NextResponse.json({ error: 'Chưa thể xuất bảng phạt.' }, { status: 500 })
  }
}
