import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { authenticateRequest } from '@/lib/server/api-auth'
import { listWeeklyArchives, readWeeklyArchive } from '@/lib/server/google-drive-archive'
import { shiftLabel, statusLabel } from '@/lib/server/word-report'
import { scopeArchivePayload } from '@/lib/server/archive-scope'
import {
  configureReportSheet,
  REPORT_XLSX_CONTENT_TYPE,
  styleReportBodyRow,
  styleReportHeader,
  styleReportTitle,
} from '@/lib/server/excel-report'

export const runtime = 'nodejs'

type ArchiveRecord = { id: string; path: string; data: Record<string, unknown> }
type ArchivePayload = { records?: Record<string, ArchiveRecord[]> }

function archiveDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (value && typeof value === 'object') {
    if ('toDate' in value && typeof value.toDate === 'function') {
      const converted = value.toDate()
      return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null
    }
    if ('_seconds' in value && typeof value._seconds === 'number') {
      const converted = new Date(value._seconds * 1000)
      return Number.isNaN(converted.getTime()) ? null : converted
    }
  }
  const converted = new Date(String(value || ''))
  return Number.isNaN(converted.getTime()) ? null : converted
}

function archiveNumber(value: unknown) {
  const amount = Number(value || 0)
  return Number.isFinite(amount) ? amount : 0
}

function lastColumnLetter(columnCount: number) {
  return String.fromCharCode(64 + columnCount)
}

function styleCountRow(sheet: ExcelJS.Worksheet, rowNumber: number, columnCount: number, count: number) {
  const row = sheet.getRow(rowNumber)
  for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
    const cell = row.getCell(columnNumber)
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF000000' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
    cell.alignment = { horizontal: columnNumber === 1 ? 'center' : 'left', vertical: 'middle' }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } },
    }
  }
  const endColumn = lastColumnLetter(columnCount)
  sheet.mergeCells(`B${rowNumber}:${endColumn}${rowNumber}`)
  sheet.getCell(`A${rowNumber}`).value = 'TỔNG'
  sheet.getCell(`B${rowNumber}`).value = `${count} bản ghi`
  row.height = 24
}

function addArchiveSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  title: string,
  columns: Array<{ key: string; width: number }>,
  headers: string[],
  rows: Array<Array<ExcelJS.CellValue>>,
  options: { dateColumns?: number[]; amountColumns?: number[]; centerColumns?: number[]; wrapColumns?: number[] } = {},
) {
  const sheet = workbook.addWorksheet(name)
  configureReportSheet(sheet, columns)
  styleReportTitle(sheet, lastColumnLetter(headers.length), title)
  styleReportHeader(sheet.getRow(3), headers)

  rows.forEach((values, index) => {
    const row = sheet.addRow(values)
    styleReportBodyRow(row, headers.length, {
      centerColumns: options.centerColumns || [],
      wrapColumns: options.wrapColumns || [],
      stripe: false,
    })
    options.dateColumns?.forEach((columnNumber) => { row.getCell(columnNumber).numFmt = 'dd/mm/yyyy' })
    options.amountColumns?.forEach((columnNumber) => { row.getCell(columnNumber).numFmt = '#,##0' })
    if (values.some((value, columnIndex) => options.wrapColumns?.includes(columnIndex + 1) && String(value || '').length > 80)) row.height = 36
    if (index % 2 === 1) row.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } } })
  })

  if (!rows.length) {
    const empty = sheet.addRow(['Tháng này chưa có dữ liệu.'])
    sheet.mergeCells(`A4:${lastColumnLetter(headers.length)}4`)
    empty.getCell(1).font = { name: 'Arial', size: 11, italic: true, color: { argb: 'FF64748B' } }
    empty.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' }
    empty.height = 30
  }
  styleCountRow(sheet, rows.length + 4 + (rows.length ? 0 : 1), headers.length, rows.length)
  if (rows.length) sheet.autoFilter = `A3:${lastColumnLetter(headers.length)}${rows.length + 3}`
  return sheet
}

function sourceWeekKey(archiveKey: string) {
  return archiveKey.split('-test-')[0]
}

function localMonth(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date)
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`
}

function fileTouchesMonth(archiveKey: string, month: string) {
  const start = new Date(`${sourceWeekKey(archiveKey)}T12:00:00+07:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return localMonth(start) === month || localMonth(end) === month
}

function belongsToMonth(collection: string, data: Record<string, unknown>, month: string) {
  if (collection === 'employeeProfiles') return true
  const value = collection === 'workSchedules' || collection === 'lateRequests'
    ? data.date
    : collection === 'leaveRequests'
      ? data.leaveDate
      : collection === 'penalties'
        ? data.penaltyDate
        : data.reviewedAt || data.updatedAt || data.createdAt
  const date = archiveDate(value)
  return !!date && localMonth(date) === month
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request)
    if (!['admin', 'manager', 'director'].includes(actor.role)) {
      return NextResponse.json({ error: 'Bạn không có quyền xuất kho dữ liệu.' }, { status: 403 })
    }
    const month = new URL(request.url).searchParams.get('month') || ''
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return NextResponse.json({ error: 'Tháng không hợp lệ.' }, { status: 400 })
    }

    const files = await listWeeklyArchives()
    const canonical = new Map<string, typeof files[number]>()
    files.filter((file) => fileTouchesMonth(file.archiveKey, month)).forEach((file) => {
      const key = sourceWeekKey(file.archiveKey)
      const current = canonical.get(key)
      if (!current || (current.archiveKey.includes('-test-') && !file.archiveKey.includes('-test-'))) {
        canonical.set(key, file)
      }
    })
    const payloads = await Promise.all([...canonical.values()].map((file) =>
      readWeeklyArchive(file.id) as Promise<ArchivePayload>
    ))
    const records = new Map<string, Map<string, ArchiveRecord>>()
    payloads.forEach((payload) => Object.entries(scopeArchivePayload(actor, payload).records || {}).forEach(([collection, rows]) => {
      const target = records.get(collection) || new Map<string, ArchiveRecord>()
      rows.filter((record) => belongsToMonth(collection, record.data || {}, month))
        .forEach((record) => target.set(record.id, record))
      records.set(collection, target)
    }))

    const profiles = records.get('employeeProfiles') || new Map<string, ArchiveRecord>()
    const identity = (employeeId: unknown) => {
      const profile = profiles.get(String(employeeId))?.data || {}
      return {
        name: String(profile.fullName || 'Nhân viên'),
        code: String(profile.employeeCode || employeeId || ''),
      }
    }
    const rowsOf = (collection: string) => [...(records.get(collection)?.values() || [])]
    const reportMonth = `${month.slice(5)}/${month.slice(0, 4)}`
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Employee Management Portal'
    workbook.created = new Date()
    workbook.modified = new Date()

    const summaryRows = [
      ['Lịch làm', rowsOf('workSchedules').length],
      ['Xin nghỉ', rowsOf('leaveRequests').length],
      ['Đi trễ', rowsOf('lateRequests').length],
      ['Ứng lương', rowsOf('salaryAdvances').length],
      ['Yêu cầu khác', rowsOf('staffRequests').length],
      ['Khoản phạt', rowsOf('penalties').length],
    ] as Array<[string, number]>
    const summary = workbook.addWorksheet('Tổng hợp')
    configureReportSheet(summary, [
      { key: 'index', width: 8 },
      { key: 'type', width: 28 },
      { key: 'count', width: 18 },
    ])
    styleReportTitle(summary, 'C', `BÁO CÁO KHO DỮ LIỆU THÁNG ${reportMonth}`)
    styleReportHeader(summary.getRow(3), ['STT', 'Nhóm dữ liệu', 'Số bản ghi'])
    summaryRows.forEach(([label, count], index) => {
      const row = summary.addRow([index + 1, label, count])
      styleReportBodyRow(row, 3, { centerColumns: [1, 3], stripe: false })
      row.getCell(3).numFmt = '#,##0'
    })
    if (!summaryRows.length) {
      const empty = summary.addRow(['Tháng này chưa có dữ liệu.'])
      summary.mergeCells('A4:C4')
      empty.getCell(1).font = { name: 'Arial', size: 11, italic: true, color: { argb: 'FF64748B' } }
      empty.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' }
      empty.height = 30
    }
    styleCountRow(summary, summaryRows.length + 4 + (summaryRows.length ? 0 : 1), 3, summaryRows.reduce((sum, [, count]) => sum + count, 0))

    const schedules = rowsOf('workSchedules')
      .sort((left, right) => (archiveDate(left.data.date)?.getTime() || 0) - (archiveDate(right.data.date)?.getTime() || 0))
      .map((record, index) => {
        const employee = identity(record.data.employeeId)
        return [index + 1, employee.name, employee.code, archiveDate(record.data.date), shiftLabel(record.data.shift), statusLabel(record.data.status)]
      })
    addArchiveSheet(workbook, 'Lịch làm', `LỊCH LÀM THÁNG ${reportMonth}`,
      [
        { key: 'index', width: 8 }, { key: 'employee', width: 28 }, { key: 'code', width: 16 },
        { key: 'date', width: 15 }, { key: 'shift', width: 16 }, { key: 'status', width: 18 },
      ], ['STT', 'Họ và tên', 'Mã NV', 'Ngày', 'Ca', 'Trạng thái'], schedules,
      { dateColumns: [4], centerColumns: [1, 3, 4, 5, 6] })

    const leaves = rowsOf('leaveRequests')
      .sort((left, right) => (archiveDate(left.data.leaveDate)?.getTime() || 0) - (archiveDate(right.data.leaveDate)?.getTime() || 0))
      .map((record, index) => {
        const employee = identity(record.data.employeeId)
        return [index + 1, employee.name, employee.code, archiveDate(record.data.leaveDate), archiveDate(record.data.endDate || record.data.leaveDate), statusLabel(record.data.status), String(record.data.reason || '')]
      })
    addArchiveSheet(workbook, 'Xin nghỉ', `DANH SÁCH XIN NGHỈ THÁNG ${reportMonth}`,
      [
        { key: 'index', width: 8 }, { key: 'employee', width: 28 }, { key: 'code', width: 16 },
        { key: 'startDate', width: 15 }, { key: 'endDate', width: 15 }, { key: 'status', width: 18 }, { key: 'reason', width: 42 },
      ], ['STT', 'Họ và tên', 'Mã NV', 'Từ ngày', 'Đến ngày', 'Trạng thái', 'Lý do'], leaves,
      { dateColumns: [4, 5], centerColumns: [1, 3, 4, 5, 6], wrapColumns: [7] })

    const lateRows = rowsOf('lateRequests')
      .sort((left, right) => (archiveDate(left.data.date)?.getTime() || 0) - (archiveDate(right.data.date)?.getTime() || 0))
      .map((record, index) => {
        const employee = identity(record.data.employeeId)
        return [index + 1, employee.name, employee.code, archiveDate(record.data.date), archiveNumber(record.data.lateMinutes), statusLabel(record.data.status), String(record.data.reason || '')]
      })
    addArchiveSheet(workbook, 'Đi trễ', `DANH SÁCH ĐI TRỄ THÁNG ${reportMonth}`,
      [
        { key: 'index', width: 8 }, { key: 'employee', width: 28 }, { key: 'code', width: 16 },
        { key: 'date', width: 15 }, { key: 'minutes', width: 14 }, { key: 'status', width: 18 }, { key: 'reason', width: 42 },
      ], ['STT', 'Họ và tên', 'Mã NV', 'Ngày', 'Số phút', 'Trạng thái', 'Lý do'], lateRows,
      { dateColumns: [4], centerColumns: [1, 3, 4, 5, 6], wrapColumns: [7] })

    const salaryRows = rowsOf('salaryAdvances')
      .sort((left, right) => (archiveDate(left.data.createdAt)?.getTime() || 0) - (archiveDate(right.data.createdAt)?.getTime() || 0))
      .map((record, index) => {
        const employee = identity(record.data.employeeId)
        return [index + 1, employee.name, employee.code, archiveNumber(record.data.amount), statusLabel(record.data.status), archiveDate(record.data.createdAt), String(record.data.reason || '')]
      })
    addArchiveSheet(workbook, 'Ứng lương', `DANH SÁCH ỨNG LƯƠNG THÁNG ${reportMonth}`,
      [
        { key: 'index', width: 8 }, { key: 'employee', width: 28 }, { key: 'code', width: 16 },
        { key: 'amount', width: 16 }, { key: 'status', width: 18 }, { key: 'createdAt', width: 15 }, { key: 'reason', width: 42 },
      ], ['STT', 'Họ và tên', 'Mã NV', 'Số tiền', 'Trạng thái', 'Ngày gửi', 'Lý do'], salaryRows,
      { dateColumns: [6], amountColumns: [4], centerColumns: [1, 3, 4, 5, 6], wrapColumns: [7] })

    const staffRequestLabels: Record<string, string> = {
      overtime: 'Làm thêm',
      scheduleChange: 'Đổi / thêm ca',
      scheduleModeChange: 'Đổi chế độ làm việc',
      factoryChange: 'Đổi xưởng',
      note: 'Ghi chú',
    }
    const staffRequests = rowsOf('staffRequests')
      .sort((left, right) => (archiveDate(left.data.createdAt)?.getTime() || 0) - (archiveDate(right.data.createdAt)?.getTime() || 0))
      .map((record, index) => {
        const employee = identity(record.data.employeeId)
        return [index + 1, employee.name, employee.code, staffRequestLabels[String(record.data.type || '')] || 'Yêu cầu khác', statusLabel(record.data.status), String(record.data.content || record.data.reason || '')]
      })
    addArchiveSheet(workbook, 'Yêu cầu khác', `DANH SÁCH YÊU CẦU KHÁC THÁNG ${reportMonth}`,
      [
        { key: 'index', width: 8 }, { key: 'employee', width: 28 }, { key: 'code', width: 16 },
        { key: 'type', width: 24 }, { key: 'status', width: 18 }, { key: 'content', width: 48 },
      ], ['STT', 'Họ và tên', 'Mã NV', 'Loại', 'Trạng thái', 'Nội dung'], staffRequests,
      { centerColumns: [1, 3, 4, 5], wrapColumns: [6] })

    const penalties = rowsOf('penalties')
      .sort((left, right) => (archiveDate(left.data.penaltyDate)?.getTime() || 0) - (archiveDate(right.data.penaltyDate)?.getTime() || 0))
      .map((record, index) => {
        const employee = identity(record.data.employeeId)
        return [index + 1, employee.name, employee.code, archiveNumber(record.data.amount), statusLabel(record.data.status || 'Active'), String(record.data.description || record.data.reason || '')]
      })
    addArchiveSheet(workbook, 'Khoản phạt', `DANH SÁCH KHOẢN PHẠT THÁNG ${reportMonth}`,
      [
        { key: 'index', width: 8 }, { key: 'employee', width: 28 }, { key: 'code', width: 16 },
        { key: 'amount', width: 16 }, { key: 'status', width: 18 }, { key: 'reason', width: 48 },
      ], ['STT', 'Họ và tên', 'Mã NV', 'Số tiền', 'Trạng thái', 'Lý do'], penalties,
      { amountColumns: [4], centerColumns: [1, 3, 4, 5], wrapColumns: [6] })

    const buffer = await workbook.xlsx.writeBuffer()
    return new Response(buffer, {
      headers: {
        'content-type': REPORT_XLSX_CONTENT_TYPE,
        'content-disposition': `attachment; filename="kho-du-lieu-${month}.xlsx"`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Archive month Excel export failed:', error)
    return NextResponse.json({ error: 'Chưa thể xuất báo cáo tháng.' }, { status: 500 })
  }
}
