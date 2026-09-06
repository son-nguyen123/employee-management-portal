import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { authenticateRequest } from '@/lib/server/api-auth'
import { getAuthorizedMonthData } from '@/lib/server/month-data'

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
    const sheet = workbook.addWorksheet('Ứng lương', {
      views: [{ state: 'frozen', ySplit: 3, showGridLines: true }],
      properties: { defaultRowHeight: 22 },
      pageSetup: {
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        paperSize: 9,
        margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
      },
    })
    sheet.columns = [
      { key: 'index', width: 8 },
      { key: 'name', width: 26 },
      { key: 'code', width: 16 },
      { key: 'amount', width: 16 },
      { key: 'bankName', width: 18 },
      { key: 'accountName', width: 28 },
      { key: 'accountNumber', width: 20 },
      { key: 'reviewedAt', width: 15 },
      { key: 'reason', width: 38 },
    ]

    sheet.mergeCells('A2:I2')
    sheet.getCell('A2').value = `DANH SÁCH ỨNG LƯƠNG ĐÃ DUYỆT THÁNG ${month.slice(5)}/${month.slice(0, 4)}`
    sheet.getCell('A2').font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FF000000' } }
    sheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' }
    sheet.getRow(2).height = 34.5

    const headers = ['STT', 'Họ và tên', 'Mã NV', 'Số tiền', 'Ngân hàng', 'Tên chủ tài khoản', 'Số tài khoản', 'Ngày duyệt', 'Lý do']
    const thinBlackBorder: Partial<ExcelJS.Borders> = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } },
    }
    sheet.getRow(3).values = headers
    sheet.getRow(3).height = 30
    sheet.getRow(3).eachCell((cell) => {
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF000000' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      cell.border = thinBlackBorder
    })

    rows.forEach((row) => {
      const excelRow = sheet.addRow(row)
      excelRow.height = 24
      for (let columnNumber = 1; columnNumber <= headers.length; columnNumber += 1) {
        const cell = excelRow.getCell(columnNumber)
        cell.font = { name: 'Arial', size: 10, color: { argb: 'FF000000' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
        cell.alignment = { vertical: 'middle', horizontal: [1, 3, 4, 7, 8].includes(columnNumber) ? 'center' : 'left', wrapText: columnNumber === 9 }
        cell.border = thinBlackBorder
      }
      excelRow.getCell(4).numFmt = '#,##0'
      excelRow.getCell(7).numFmt = '@'
      excelRow.getCell(8).numFmt = 'dd/mm/yyyy'
    })

    const totalRowNumber = rows.length + 4
    const totalRow = sheet.getRow(totalRowNumber)
    for (let columnNumber = 1; columnNumber <= headers.length; columnNumber += 1) {
      const cell = totalRow.getCell(columnNumber)
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF000000' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
      cell.alignment = { horizontal: columnNumber === 4 ? 'right' : 'center', vertical: 'middle' }
      cell.border = thinBlackBorder
    }
    sheet.mergeCells(`A${totalRowNumber}:C${totalRowNumber}`)
    sheet.getCell(`A${totalRowNumber}`).value = 'TỔNG'
    sheet.getCell(`D${totalRowNumber}`).value = rows.reduce((sum, row) => sum + Number(row[3] || 0), 0)
    sheet.getCell(`D${totalRowNumber}`).numFmt = '#,##0'
    totalRow.height = 24

    const buffer = await workbook.xlsx.writeBuffer()
    return new Response(buffer, {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="danh-sach-ung-luong-da-duyet-${month}.xlsx"`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Salary history Excel export failed:', error)
    return NextResponse.json({ error: 'Chưa thể xuất file Excel.' }, { status: 500 })
  }
}
