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

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request)
    if (!['admin', 'manager', 'director'].includes(actor.role)) {
      return NextResponse.json({ error: 'Bạn không có quyền xuất lịch sử ứng lương.' }, { status: 403 })
    }

    const [advances, employees] = await Promise.all([
      adminDb.collection('salaryAdvances').orderBy('createdAt', 'desc').get(),
      adminDb.collection('employees').get(),
    ])
    const employeeMap = new Map(employees.docs.map((snapshot) => [snapshot.id, snapshot.data()]))
    const approvedAdvances = advances.docs.filter((snapshot) => {
      const employee = employeeMap.get(String(snapshot.get('employeeId')))
      const sameFactory = actor.role === 'director' || String(employee?.factoryId || 'factory-1') === actor.factoryId
      return snapshot.get('status') === 'Approved' && employee?.status === 'active' && sameFactory
    })
    const rows = approvedAdvances.map((snapshot, index) => {
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
        toDate(advance.reviewedAt || advance.createdAt),
        String(advance.reason || 'Không có ghi chú'),
      ]
    })

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Employee Management Portal'
    workbook.created = new Date()
    workbook.modified = new Date()
    const sheet = workbook.addWorksheet('Ứng lương', {
      views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
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
      { key: 'reviewedAt', width: 15 },
      { key: 'reason', width: 38 },
    ]

    sheet.mergeCells('A1:I1')
    sheet.getCell('A1').value = 'DANH SÁCH ỨNG LƯƠNG ĐÃ ĐƯỢC DUYỆT'
    sheet.getCell('A1').font = { name: 'Arial', size: 18, bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' }
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } }
    sheet.getRow(1).height = 32

    sheet.mergeCells('A2:I2')
    sheet.getCell('A2').value = `Chỉ gồm yêu cầu đã được quản lý duyệt · Xuất lúc ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`
    sheet.getCell('A2').font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF475569' } }
    sheet.getCell('A2').alignment = { horizontal: 'center' }
    sheet.getRow(2).height = 22

    const headers = ['STT', 'Họ và tên', 'Mã NV', 'Số tiền', 'Ngân hàng', 'Tên chủ tài khoản', 'Số tài khoản', 'Ngày duyệt', 'Lý do']
    sheet.getRow(4).values = headers
    sheet.getRow(4).height = 30
    sheet.getRow(4).eachCell((cell) => {
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      cell.border = { bottom: { style: 'medium', color: { argb: 'FF0F766E' } } }
    })

    rows.forEach((row) => {
      const excelRow = sheet.addRow(row)
      excelRow.height = 24
      excelRow.eachCell((cell, columnNumber) => {
        cell.font = { name: 'Arial', size: 10, color: { argb: 'FF0F172A' } }
        cell.alignment = { vertical: 'middle', horizontal: [1, 3, 4, 7, 8].includes(columnNumber) ? 'center' : 'left', wrapText: columnNumber === 9 }
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } }
      })
      excelRow.getCell(4).numFmt = '#,##0" đ"'
      excelRow.getCell(7).numFmt = '@'
      excelRow.getCell(8).numFmt = 'dd/mm/yyyy'
    })

    if (rows.length) {
      sheet.addTable({
        name: 'SalaryAdvancesTable',
        ref: `A4:I${rows.length + 4}`,
        headerRow: true,
        columns: headers.map((name) => ({ name })),
        rows: rows.map((row) => row as ExcelJS.CellValue[]),
        style: { theme: 'TableStyleMedium2', showRowStripes: true, showColumnStripes: false },
      })
    }
    sheet.autoFilter = `A4:I${Math.max(rows.length + 4, 4)}`

    const summaryRow = Math.max(rows.length + 6, 6)
    sheet.mergeCells(`A${summaryRow}:I${summaryRow}`)
    sheet.getCell(`A${summaryRow}`).value = `Tổng người được duyệt: ${rows.length}   |   Tổng tiền đã duyệt: ${rows.reduce((sum, row) => sum + Number(row[3] || 0), 0).toLocaleString('vi-VN')} đ`
    sheet.getCell(`A${summaryRow}`).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF475569' } }
    sheet.getCell(`A${summaryRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
    sheet.getCell(`A${summaryRow}`).alignment = { horizontal: 'center', vertical: 'middle' }
    sheet.getCell(`A${summaryRow}`).border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } }
    sheet.getRow(summaryRow).height = 22

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
