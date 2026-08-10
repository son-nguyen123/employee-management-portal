import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { Timestamp } from 'firebase-admin/firestore'
import { authenticateRequest } from '@/lib/server/api-auth'
import { adminDb } from '@/lib/server/firebase-admin'

export const runtime = 'nodejs'

function monthWindow(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const start = new Date(`${month}-01T00:00:00+07:00`)
  const nextYear = monthNumber === 12 ? year + 1 : year
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1
  const end = new Date(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+07:00`)
  return { start, end }
}

function toDate(value: unknown): Date | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate()
  }
  if (value instanceof Date) return value
  const parsed = new Date(String(value || ''))
  return Number.isNaN(parsed.getTime()) ? null : parsed
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

function styleTitle(cell: ExcelJS.Cell, fill: string, size: number, color = 'FFFFFFFF') {
  cell.font = { name: 'Arial', size, bold: true, color: { argb: color } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
}

function styleHeader(cell: ExcelJS.Cell) {
  cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  cell.border = { bottom: { style: 'medium', color: { argb: 'FF0F766E' } } }
}

function styleBody(cell: ExcelJS.Cell, columnNumber: number, stripe: boolean) {
  cell.font = { name: 'Arial', size: 10, color: { argb: 'FF0F172A' } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: stripe ? 'FFF8FAFC' : 'FFFFFFFF' } }
  cell.alignment = {
    horizontal: [1, 2, 5].includes(columnNumber) ? 'center' : 'left',
    vertical: 'middle',
    wrapText: columnNumber === 4,
  }
  cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } }
}

function configureSheet(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: 'frozen', ySplit: 3, showGridLines: false }]
  sheet.properties.defaultRowHeight = 22
  sheet.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  }
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
    const penaltyRows: PenaltyRow[] = []

    penalties.docs.forEach((snapshot) => {
      const penalty = snapshot.data()
      if (penalty.status === 'Cancelled') return
      const employeeId = String(penalty.employeeId || '')
      const employee = employeeMap.get(employeeId) || {}
      penaltyRows.push({
        employeeId,
        employeeName: String(employee.fullName || 'Nhân viên'),
        employeeCode: String(employee.employeeCode || employeeId),
        date: toDate(penalty.penaltyDate),
        title: String(penalty.title || 'Khoản phạt'),
        reason: String(penalty.description || 'Không có lý do'),
        amount: Number(penalty.amount || 0),
      })
    })

    const grouped = new Map<string, PenaltyRow[]>()
    penaltyRows.forEach((row) => grouped.set(row.employeeId, [...(grouped.get(row.employeeId) || []), row]))
    const employeeGroups = [...grouped.values()]
      .sort((left, right) => left[0].employeeName.localeCompare(right[0].employeeName, 'vi'))

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Employee Management Portal'
    workbook.created = new Date()
    workbook.modified = new Date()

    const report = workbook.addWorksheet('Bảng phạt')
    configureSheet(report)
    report.columns = [
      { key: 'index', width: 8 },
      { key: 'date', width: 15 },
      { key: 'title', width: 28 },
      { key: 'reason', width: 52 },
      { key: 'amount', width: 18 },
    ]
    report.mergeCells('A1:E1')
    report.getCell('A1').value = `BẢNG PHẠT THÁNG ${month.slice(5)}/${month.slice(0, 4)}`
    styleTitle(report.getCell('A1'), 'FFBE123C', 18)
    report.getRow(1).height = 34
    report.mergeCells('A2:E2')
    report.getCell('A2').value = 'Danh sách được nhóm riêng theo từng nhân viên · Không bao gồm khoản phạt đã hủy'
    styleTitle(report.getCell('A2'), 'FFFCE7F3', 10, 'FF9F1239')
    report.getRow(2).height = 24

    let currentRow = 4
    employeeGroups.forEach((group) => {
      const sortedGroup = [...group].sort((left, right) => (left.date?.getTime() || 0) - (right.date?.getTime() || 0))
      const groupHeaderRow = currentRow
      const dataHeaderRow = currentRow + 1
      const dataStartRow = currentRow + 2
      const dataEndRow = dataStartRow + sortedGroup.length - 1

      report.mergeCells(`A${groupHeaderRow}:C${groupHeaderRow}`)
      report.getCell(`A${groupHeaderRow}`).value = `${sortedGroup[0].employeeName} · ${sortedGroup[0].employeeCode}`
      report.getCell(`D${groupHeaderRow}`).value = `${sortedGroup.length} khoản`
      report.getCell(`E${groupHeaderRow}`).value = { formula: `SUM(E${dataStartRow}:E${dataEndRow})` }
      for (const column of ['A', 'B', 'C', 'D', 'E']) {
        const cell = report.getCell(`${column}${groupHeaderRow}`)
        cell.font = { name: 'Arial', size: column === 'E' ? 12 : 11, bold: true, color: { argb: 'FF9F1239' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE7F3' } }
        cell.alignment = { horizontal: column === 'E' ? 'right' : column === 'D' ? 'center' : 'left', vertical: 'middle' }
      }
      report.getCell(`E${groupHeaderRow}`).numFmt = '#,##0" đ"'
      report.getRow(groupHeaderRow).height = 26

      report.getRow(dataHeaderRow).values = ['STT', 'Ngày phạt', 'Khoản phạt', 'Lý do', 'Số tiền']
      report.getRow(dataHeaderRow).height = 28
      report.getRow(dataHeaderRow).eachCell(styleHeader)

      sortedGroup.forEach((row, index) => {
        const excelRow = report.getRow(dataStartRow + index)
        excelRow.values = [index + 1, row.date, row.title, row.reason, row.amount]
        excelRow.height = row.reason.length > 70 ? 36 : 24
        excelRow.eachCell((cell, columnNumber) => styleBody(cell, columnNumber, index % 2 === 1))
        excelRow.getCell(2).numFmt = 'dd/mm/yyyy'
        excelRow.getCell(5).numFmt = '#,##0" đ"'
      })
      currentRow = dataEndRow + 2
    })

    if (!employeeGroups.length) {
      report.mergeCells('A4:E4')
      report.getCell('A4').value = 'Tháng này chưa có khoản phạt đang áp dụng.'
      report.getCell('A4').font = { name: 'Arial', size: 11, italic: true, color: { argb: 'FF64748B' } }
      report.getCell('A4').alignment = { horizontal: 'center', vertical: 'middle' }
      report.getRow(4).height = 30
    }

    const detail = workbook.addWorksheet('Chi tiết')
    configureSheet(detail)
    detail.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }]
    detail.columns = [
      { key: 'index', width: 8 },
      { key: 'employee', width: 27 },
      { key: 'code', width: 16 },
      { key: 'date', width: 15 },
      { key: 'title', width: 28 },
      { key: 'reason', width: 52 },
      { key: 'amount', width: 18 },
    ]
    const detailHeaders = ['STT', 'Nhân viên', 'Mã NV', 'Ngày phạt', 'Khoản phạt', 'Lý do', 'Số tiền']
    detail.getRow(1).values = detailHeaders
    detail.getRow(1).height = 30
    detail.getRow(1).eachCell(styleHeader)
    const detailRows = [...penaltyRows]
      .sort((left, right) => left.employeeName.localeCompare(right.employeeName, 'vi') || (left.date?.getTime() || 0) - (right.date?.getTime() || 0))
    detailRows.forEach((row, index) => {
      const excelRow = detail.addRow([index + 1, row.employeeName, row.employeeCode, row.date, row.title, row.reason, row.amount])
      excelRow.height = row.reason.length > 70 ? 36 : 24
      excelRow.eachCell((cell, columnNumber) => styleBody(cell, columnNumber, index % 2 === 1))
      excelRow.getCell(4).numFmt = 'dd/mm/yyyy'
      excelRow.getCell(7).numFmt = '#,##0" đ"'
    })
    if (detailRows.length) {
      detail.addTable({
        name: 'PenaltyDetailsTable',
        ref: `A1:G${detailRows.length + 1}`,
        headerRow: true,
        columns: detailHeaders.map((name) => ({ name })),
        rows: detailRows.map((row, index) => [index + 1, row.employeeName, row.employeeCode, row.date, row.title, row.reason, row.amount]),
        style: { theme: 'TableStyleMedium2', showRowStripes: true, showColumnStripes: false },
      })
    }
    detail.autoFilter = `A1:G${Math.max(detailRows.length + 1, 1)}`

    const buffer = await workbook.xlsx.writeBuffer()
    return new Response(buffer, {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="bang-phat-${month}.xlsx"`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Penalty Excel export failed:', error)
    return NextResponse.json({ error: 'Chưa thể xuất bảng phạt Excel.' }, { status: 500 })
  }
}
