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

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request)
    if (!['admin', 'manager', 'director'].includes(actor.role)) {
      return NextResponse.json({ error: 'Bạn không có quyền xuất lịch sử ứng lương.' }, { status: 403 })
    }

    const month = new URL(request.url).searchParams.get('month') || new Date().toISOString().slice(0, 7)
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: 'Tháng xuất không hợp lệ.' }, { status: 400 })
    const monthData = await getAuthorizedMonthData(actor, month, 'salaryAdvances')
    const employeeMap = new Map(monthData.employees.map((employee) => [String(employee.uid || employee.id), employee as Record<string, unknown>]))
    const approvedAdvances = monthData.records.filter((advance) => {
      const employee = employeeMap.get(String(advance.employeeId))
      return advance.status === 'Approved' && (monthData.source === 'drive' || employee?.status === 'active')
    })
    const rows = approvedAdvances.map((advance, index) => {
      const employee = employeeMap.get(String(advance.employeeId)) || {}
      return [
        String(index + 1),
        String(employee.fullName || 'Nhân viên'),
        String(employee.employeeCode || advance.employeeId || ''),
        Number(advance.amount || 0),
        String(employee.bankName || ''),
        String(employee.bankAccountName || ''),
        String(employee.bankAccountNumber || ''),
        toDate(advance.reviewedAt || advance.createdAt),
        String(advance.reason || 'Không có ghi chú'),
      ]
    })

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Employee Management Portal'
    workbook.created = new Date()
    workbook.modified = new Date()
    const sheet = workbook.addWorksheet('Ứng lương')
    configureReportSheet(sheet, [
      { key: 'index', width: 8 },
      { key: 'name', width: 26 },
      { key: 'code', width: 16 },
      { key: 'amount', width: 16 },
      { key: 'bankName', width: 18 },
      { key: 'accountName', width: 28 },
      { key: 'accountNumber', width: 20 },
      { key: 'reviewedAt', width: 15 },
      { key: 'reason', width: 38 },
    ])

    styleReportTitle(sheet, 'I', `DANH SÁCH ỨNG LƯƠNG ĐÃ DUYỆT THÁNG ${month.slice(5)}/${month.slice(0, 4)}`)

    const headers = ['STT', 'Họ và tên', 'Mã NV', 'Số tiền', 'Ngân hàng', 'Tên chủ tài khoản', 'Số tài khoản', 'Ngày duyệt', 'Lý do']
    styleReportHeader(sheet.getRow(3), headers)

    rows.forEach((row, index) => {
      const excelRow = sheet.addRow(row)
      styleReportBodyRow(excelRow, headers.length, { centerColumns: [1, 3, 4, 7, 8], wrapColumns: [9], stripe: index % 2 === 1 })
      excelRow.getCell(4).numFmt = '#,##0'
      excelRow.getCell(7).numFmt = '@'
      excelRow.getCell(8).numFmt = 'dd/mm/yyyy'
    })

    const totalRowNumber = rows.length + 4
    styleReportTotalRow(sheet, totalRowNumber, headers.length, 4, 3, rows.reduce((sum, row) => sum + Number(row[3] || 0), 0))

    const buffer = await workbook.xlsx.writeBuffer()
    return new Response(buffer, {
      headers: {
        'content-type': REPORT_XLSX_CONTENT_TYPE,
        'content-disposition': `attachment; filename="danh-sach-ung-luong-da-duyet-${month}.xlsx"`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Salary history Excel export failed:', error)
    return NextResponse.json({ error: 'Chưa thể xuất file Excel.' }, { status: 500 })
  }
}
