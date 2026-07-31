import { NextResponse } from 'next/server'
import { Packer, Paragraph } from 'docx'
import { authenticateRequest } from '@/lib/server/api-auth'
import { adminDb } from '@/lib/server/firebase-admin'
import {
  landscapeReport,
  money,
  reportDate,
  reportTable,
  reportTitle,
  statusLabel,
} from '@/lib/server/word-report'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request)
    if (!['admin', 'manager'].includes(actor.role)) {
      return NextResponse.json({ error: 'Bạn không có quyền xuất lịch sử ứng lương.' }, { status: 403 })
    }

    const [advances, employees] = await Promise.all([
      adminDb.collection('salaryAdvances').orderBy('createdAt', 'desc').get(),
      adminDb.collection('employees').get(),
    ])
    const employeeMap = new Map(employees.docs.map((snapshot) => [snapshot.id, snapshot.data()]))
    const rows = advances.docs.map((snapshot, index) => {
      const advance = snapshot.data()
      const employee = employeeMap.get(String(advance.employeeId)) || {}
      const bank = employee.bankName && employee.bankAccountNumber
        ? `${employee.bankName}\n${employee.bankAccountName || ''}\n${employee.bankAccountNumber}`
        : 'Chưa cập nhật'
      return [
        String(index + 1),
        String(employee.fullName || 'Nhân viên'),
        String(employee.employeeCode || advance.employeeId || ''),
        money(advance.amount),
        statusLabel(advance.status),
        reportDate(advance.createdAt),
        String(advance.reason || 'Không có ghi chú'),
        bank,
      ]
    })

    const children = [
      ...reportTitle(
        'BẢNG LỊCH SỬ ỨNG LƯƠNG',
        `Toàn bộ trạng thái · Xuất lúc ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`
      ),
      rows.length
        ? reportTable(
            ['STT', 'Họ và tên', 'Mã NV', 'Số tiền', 'Trạng thái', 'Ngày gửi', 'Lý do', 'Tài khoản nhận'],
            rows,
            [700, 2100, 1150, 1350, 1200, 1250, 2550, 3860],
            [0, 2, 3, 4, 5]
          )
        : new Paragraph('Chưa có lịch sử ứng lương.'),
    ]
    const buffer = await Packer.toBuffer(landscapeReport(children))
    const date = new Date().toISOString().slice(0, 10)
    return new Response(buffer, {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-disposition': `attachment; filename="lich-su-ung-luong-${date}.docx"`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Salary history Word export failed:', error)
    return NextResponse.json({ error: 'Chưa thể xuất file Word.' }, { status: 500 })
  }
}
