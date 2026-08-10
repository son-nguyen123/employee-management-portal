import { NextResponse } from 'next/server'
import { AlignmentType, Packer, Paragraph, TextRun } from 'docx'
import { Timestamp } from 'firebase-admin/firestore'
import { authenticateRequest } from '@/lib/server/api-auth'
import { adminDb } from '@/lib/server/firebase-admin'
import {
  landscapeReport,
  money,
  reportDate,
  reportTable,
  reportSectionHeading,
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
    const grouped = new Map<string, { name: string; code: string; penalties: Array<{ date: unknown; title: string; reason: string; amount: number }> }>()
    penalties.docs.forEach((snapshot) => {
      const penalty = snapshot.data()
      if (penalty.status === 'Cancelled') return
      const employeeId = String(penalty.employeeId || '')
      const employee = employeeMap.get(employeeId) || {}
      const group = grouped.get(employeeId) || {
        name: String(employee.fullName || 'Nhân viên'),
        code: String(employee.employeeCode || employeeId),
        penalties: [],
      }
      group.penalties.push({
        date: penalty.penaltyDate,
        title: String(penalty.title || 'Khoản phạt'),
        reason: String(penalty.description || 'Không có lý do'),
        amount: Number(penalty.amount || 0),
      })
      grouped.set(employeeId, group)
    })

    const employeeGroups = [...grouped.values()]
      .sort((left, right) => left.name.localeCompare(right.name, 'vi'))

    const children = [
      ...reportTitle(
        `BẢNG TỔNG HỢP PHẠT THÁNG ${month.slice(5)}/${month.slice(0, 4)}`,
        'Tách riêng từng nhân viên · Chỉ gồm các khoản đang áp dụng; khoản đã hủy không tính.'
      ),
      ...(employeeGroups.length
        ? employeeGroups.flatMap((group) => {
            const rows = group.penalties
              .sort((left, right) => String(left.date).localeCompare(String(right.date)))
              .map((penalty, index) => [
                String(index + 1),
                reportDate(penalty.date),
                penalty.title,
                penalty.reason,
                money(penalty.amount),
              ])
            const total = group.penalties.reduce((sum, penalty) => sum + penalty.amount, 0)
            return [
              reportSectionHeading(`${group.name} · ${group.code}`),
              new Paragraph({
                spacing: { after: 100 },
                children: [new TextRun({ text: `${group.penalties.length} khoản phạt đang áp dụng`, bold: true, size: 18, color: '64748B', font: 'Arial' })],
              }),
              reportTable(
                ['STT', 'Ngày phạt', 'Khoản phạt', 'Lý do', 'Số tiền'],
                rows,
                [700, 1500, 3000, 6400, 2560],
                [0, 1, 4]
              ),
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { before: 100, after: 180 },
                children: [new TextRun({ text: `Tổng của ${group.name}: ${money(total)}`, bold: true, size: 19, color: 'BE123C', font: 'Arial' })],
              }),
            ]
          })
        : [new Paragraph('Tháng này chưa có khoản phạt đang áp dụng.')]),
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
