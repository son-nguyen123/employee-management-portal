import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { authenticateRequest } from '@/lib/server/api-auth'
import { adminDb } from '@/lib/server/firebase-admin'

export const runtime = 'nodejs'

function toDate(value: unknown): Date | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate()
  }
  if (value instanceof Date) return value
  const parsed = new Date(String(value || ''))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function statusLabel(value: unknown): string {
  const labels: Record<string, string> = {
    Pending: 'Chờ duyệt',
    Approved: 'Đã duyệt',
    Rejected: 'Từ chối',
    Cancelled: 'Đã hủy',
  }
  return labels[String(value)] || String(value || '')
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
    const rows = advances.docs.map((snapshot, index) => {
      const advance = snapshot.data()
      const employee = employeeMap.get(String(advance.employeeId)) || {}
      return [
        String(index + 1),
        String(employee.fullName || 'Nhân viên'),
        String(employee.employeeCode || advance.employeeId || ''),
        Number(advance.amount || 0),
        String(employee.bankName || ''),
        String(employee.bankAccountName || ''),
        String(employee.bankAccountNumber || ''),
        toDate(advance.createdAt),
        statusLabel(advance.status),
        String(advance.reason || 'Không có ghi chú'),
      ]
    })

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Employee Management Portal'
    workbook.created = new Date()
    workbook.modified = new Date()
    const sheet = workbook.addWorksheet('Ứng lương', {
      views: [{ state: 'frozen', ySplit: 6, showGridLines: false }],
      properties: { defaultRowHeight: 22 },
    })
    sheet.columns = [
      { key: 'index', width: 8 },
      { key: 'name', width: 26 },
      { key: 'code', width: 16 },
      { key: 'amount', width: 16 },
      { key: 'bankName', width: 18 },
      { key: 'accountName', width: 28 },
      { key: 'accountNumber', width: 20 },
      { key: 'createdAt', width: 15 },
      { key: 'status', width: 14 },
      { key: 'reason', width: 38 },
    ]

    sheet.mergeCells('A1:J1')
    sheet.getCell('A1').value = 'LỊCH SỬ ỨNG LƯƠNG'
    sheet.getCell('A1').font = { name: 'Aptos Display', size: 18, bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' }
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } }
    sheet.getRow(1).height = 32

    sheet.mergeCells('A2:J2')
    sheet.getCell('A2').value = `Toàn bộ trạng thái · Xuất lúc ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`
    sheet.getCell('A2').font = { name: 'Aptos', size: 10, italic: true, color: { argb: 'FF475569' } }
    sheet.getCell('A2').alignment = { horizontal: 'center' }
    sheet.getRow(2).height = 22

    const lastDataRow = Math.max(rows.length + 6, 7)
    sheet.getCell('A4').value = 'Tổng yêu cầu'
    sheet.getCell('B4').value = { formula: `COUNTA(A7:A${lastDataRow})` }
    sheet.getCell('D4').value = 'Tổng tiền'
    sheet.getCell('E4').value = { formula: `SUM(D7:D${lastDataRow})` }
    sheet.getCell('G4').value = 'Đã duyệt'
    sheet.getCell('H4').value = { formula: `COUNTIF(I7:I${lastDataRow},"Đã duyệt")` }
    for (const address of ['A4', 'D4', 'G4']) {
      const cell = sheet.getCell(address)
      cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FF0F766E' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6FFFB' } }
    }
    for (const address of ['B4', 'E4', 'H4']) {
      const cell = sheet.getCell(address)
      cell.font = { name: 'Aptos', size: 11, bold: true, color: { argb: 'FF0F172A' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6FFFB' } }
      cell.alignment = { horizontal: 'right' }
    }
    sheet.getCell('E4').numFmt = '#,##0" đ"'

    const headers = ['STT', 'Họ và tên', 'Mã NV', 'Số tiền', 'Ngân hàng', 'Tên chủ tài khoản', 'Số tài khoản', 'Ngày gửi', 'Trạng thái', 'Lý do']
    sheet.getRow(6).values = headers
    sheet.getRow(6).height = 30
    sheet.getRow(6).eachCell((cell) => {
      cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      cell.border = { bottom: { style: 'medium', color: { argb: 'FF0F766E' } } }
    })

    rows.forEach((row) => {
      const excelRow = sheet.addRow(row)
      excelRow.height = 24
      excelRow.eachCell((cell, columnNumber) => {
        cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF0F172A' } }
        cell.alignment = { vertical: 'middle', horizontal: [1, 3, 4, 7, 8, 9].includes(columnNumber) ? 'center' : 'left', wrapText: columnNumber === 10 }
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } }
      })
      excelRow.getCell(4).numFmt = '#,##0" đ"'
      excelRow.getCell(7).numFmt = '@'
      excelRow.getCell(8).numFmt = 'dd/mm/yyyy'
      if (String(row[8]) === 'Đã duyệt') {
        excelRow.getCell(9).font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FF047857' } }
      }
    })

    if (rows.length) {
      sheet.addTable({
        name: 'SalaryAdvancesTable',
        ref: `A6:J${rows.length + 6}`,
        headerRow: true,
        columns: headers.map((name) => ({ name })),
        rows: rows.map((row) => row as ExcelJS.CellValue[]),
        style: { theme: 'TableStyleMedium2', showRowStripes: true, showColumnStripes: false },
      })
    }
    sheet.autoFilter = `A6:J${rows.length + 6}`
    sheet.getRow(4).height = 24

    const buffer = await workbook.xlsx.writeBuffer()
    const date = new Date().toISOString().slice(0, 10)
    return new Response(buffer, {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="lich-su-ung-luong-${date}.xlsx"`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Salary history Excel export failed:', error)
    return NextResponse.json({ error: 'Chưa thể xuất file Excel.' }, { status: 500 })
  }
}
