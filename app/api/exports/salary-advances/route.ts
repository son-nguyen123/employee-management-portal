import { NextResponse } from 'next/server'
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { Timestamp } from 'firebase-admin/firestore'
import { authenticateRequest } from '@/lib/server/api-auth'
import { adminDb } from '@/lib/server/firebase-admin'

export const runtime = 'nodejs'

const statusLabels: Record<string, string> = {
  Pending: 'Chờ duyệt',
  Approved: 'Đã duyệt',
  Rejected: 'Từ chối',
  Cancelled: 'Đã hủy',
}

function cell(text: string, bold = false) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold, size: 20 })] })],
  })
}

function asDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate()
  if (value instanceof Date) return value
  return null
}

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
    const rows: Array<Record<string, unknown> & { id: string }> = advances.docs.map((snapshot) => ({
      id: snapshot.id,
      ...(snapshot.data() as Record<string, unknown>),
    }))
    const children: Array<Paragraph | Table> = [
      new Paragraph({
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: 'LỊCH SỬ ỨNG LƯƠNG', bold: true })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun(`Xuất lúc ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`)],
      }),
      new Paragraph(''),
    ]

    for (const status of ['Pending', 'Approved', 'Rejected', 'Cancelled']) {
      const group = rows.filter((row) => row.status === status)
      if (!group.length) continue
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: `${statusLabels[status]} (${group.length})`, bold: true })],
      }))
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: ['STT', 'Nhân viên', 'Số tiền', 'Ngày gửi', 'Lý do', 'Tài khoản nhận tiền']
              .map((label) => cell(label, true)),
          }),
          ...group.map((row, index) => {
            const employee = employeeMap.get(String(row.employeeId)) || {}
            const bank = employee.bankName && employee.bankAccountNumber
              ? `${employee.bankName}\n${employee.bankAccountName || ''}\n${employee.bankAccountNumber}`
              : 'Chưa cập nhật'
            return new TableRow({
              children: [
                cell(String(index + 1)),
                cell(`${employee.fullName || 'Nhân viên'}\n${employee.employeeCode || row.employeeId || ''}`),
                cell(`${Number(row.amount || 0).toLocaleString('vi-VN')}đ`),
                cell(asDate(row.createdAt)?.toLocaleDateString('vi-VN') || ''),
                cell(String(row.reason || 'Không có ghi chú')),
                cell(bank),
              ],
            })
          }),
        ],
      }))
      children.push(new Paragraph(''))
    }
    if (!rows.length) children.push(new Paragraph('Chưa có lịch sử ứng lương.'))

    const buffer = await Packer.toBuffer(new Document({ sections: [{ children }] }))
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
