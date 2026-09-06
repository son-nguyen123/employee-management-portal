import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { authenticateRequest } from '@/lib/server/api-auth'
import { getAuthorizedMonthData } from '@/lib/server/month-data'
import {
  configureReportSheet,
  REPORT_XLSX_CONTENT_TYPE,
  styleReportBodyRow,
  styleReportHeader,
  styleReportTitle,
  styleReportTotalRow,
} from '@/lib/server/excel-report'

export const runtime = 'nodejs'

function toDate(value: unknown): Date | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate()
  }
  if (value instanceof Date) return value
  const parsed = new Date(String(value || ''))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function repairMojibake(value: unknown, fallback: string) {
  const text = String(value ?? '').trim()
  if (!text) return fallback
  if (!/(?:Ã.|Â.|Ä.|Æ.|Ð.|Ø.|á(?:º|»|¼|½|¾|¿)|â[\u0080-\u009f]|ðŸ)/.test(text)) return text
  try {
    const repaired = Buffer.from(text, 'latin1').toString('utf8')
    return repaired.includes('�') ? text : repaired
  } catch {
    return text
  }
}

function normalizeLegacyPenaltyText(value: unknown, fallback: string) {
  const repaired = repairMojibake(value, fallback)
  const compact = repaired.replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi')

  // A previous client stored these automatic schedule-penalty strings with
  // question marks in place of Vietnamese characters. Keep old exports readable
  // without changing the original Firestore records in the request itself.
  if (/^dang k\s+l\?ch tr\? h?n$/.test(compact)) return 'Đăng ký lịch trễ hạn'
  if (compact.startsWith('l?ch tu?n du?c g?i sau h?n dang k')) {
    return 'Lịch tuần được gửi sau hạn đăng ký. Khoản phạt được bổ sung theo lịch sử đăng ký.'
  }

  return repaired
}

type PenaltyRow = {
  employeeId: string
  employeeName: string
  employeeCode: string
  date: Date | null
  title: string
  reason: string
  amount: number
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

    const monthData = await getAuthorizedMonthData(actor, month, 'penalties')
    const employeeMap = new Map(monthData.employees.map((employee) => [String(employee.uid || employee.id), employee as Record<string, unknown>]))
    const penaltyRows: PenaltyRow[] = []

    monthData.records.forEach((penalty) => {
      if (penalty.status === 'Cancelled') return
      const employeeId = String(penalty.employeeId || '')
      const employee = employeeMap.get(employeeId) || {}
      penaltyRows.push({
        employeeId,
        employeeName: normalizeLegacyPenaltyText(employee.fullName, 'Nhân viên'),
        employeeCode: normalizeLegacyPenaltyText(employee.employeeCode, employeeId),
        date: toDate(penalty.penaltyDate),
        title: normalizeLegacyPenaltyText(penalty.title, 'Khoản phạt'),
        reason: normalizeLegacyPenaltyText(penalty.description, 'Không có lý do'),
        amount: Number(penalty.amount || 0),
      })
    })

    const sortedRows = [...penaltyRows].sort((left, right) =>
      left.employeeName.localeCompare(right.employeeName, 'vi') ||
      (left.date?.getTime() || 0) - (right.date?.getTime() || 0)
    )

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Employee Management Portal'
    workbook.created = new Date()
    workbook.modified = new Date()

    const report = workbook.addWorksheet('Bảng phạt')
    configureReportSheet(report, [
      { key: 'index', width: 8 },
      { key: 'employee', width: 28 },
      { key: 'code', width: 16 },
      { key: 'date', width: 15 },
      { key: 'title', width: 28 },
      { key: 'amount', width: 16 },
      { key: 'reason', width: 45 },
    ])
    styleReportTitle(report, 'G', `DANH SÁCH KHOẢN PHẠT THÁNG ${month.slice(5)}/${month.slice(0, 4)}`)
    const headers = ['STT', 'Họ và tên', 'Mã NV', 'Ngày phạt', 'Khoản phạt', 'Số tiền', 'Lý do']
    styleReportHeader(report.getRow(3), headers)

    sortedRows.forEach((row, index) => {
      const excelRow = report.addRow([index + 1, row.employeeName, row.employeeCode, row.date, row.title, row.amount, row.reason])
      styleReportBodyRow(excelRow, headers.length, { centerColumns: [1, 3, 4, 6], wrapColumns: [5, 7], stripe: index % 2 === 1 })
      excelRow.getCell(4).numFmt = 'dd/mm/yyyy'
      excelRow.getCell(6).numFmt = '#,##0'
      if (row.reason.length > 70) excelRow.height = 36
    })

    if (!sortedRows.length) {
      const emptyRow = report.addRow(['Tháng này chưa có khoản phạt đang áp dụng.'])
      report.mergeCells('A4:G4')
      emptyRow.getCell(1).font = { name: 'Arial', size: 11, italic: true, color: { argb: 'FF64748B' } }
      emptyRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' }
      emptyRow.height = 30
    }
    styleReportTotalRow(report, sortedRows.length + 4 + (sortedRows.length ? 0 : 1), headers.length, 6, 5, sortedRows.reduce((sum, row) => sum + row.amount, 0))

    const buffer = await workbook.xlsx.writeBuffer()
    return new Response(buffer, {
      headers: {
        'content-type': REPORT_XLSX_CONTENT_TYPE,
        'content-disposition': `attachment; filename="bang-phat-${month}.xlsx"`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Penalty Excel export failed:', error)
    return NextResponse.json({ error: 'Chưa thể xuất bảng phạt Excel.' }, { status: 500 })
  }
}
