import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { ApiError, authenticateRequest } from '@/lib/server/api-auth'
import { adminDb } from '@/lib/server/firebase-admin'

export const runtime = 'nodejs'

const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'
const SHIFT_KEYS = ['Morning', 'Afternoon', 'Evening'] as const
type ShiftKey = typeof SHIFT_KEYS[number]
const DAY_COLUMN_KEYS = [...SHIFT_KEYS, 'Custom'] as const
type DayColumnKey = typeof DAY_COLUMN_KEYS[number]
const SUNDAY_COLUMN_KEYS = ['Morning', 'Afternoon'] as const satisfies readonly DayColumnKey[]

const DAY_COLUMN_LABELS: Record<DayColumnKey, string> = {
  Morning: 'Sáng',
  Afternoon: 'Chiều',
  Evening: 'Tối',
  Custom: 'T/Ca',
}

const WEEKDAY_LABELS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật']
const SHIFT_FILLS: Record<ShiftKey, string> = {
  Morning: 'FFFDE68A',
  Afternoon: 'FFBBF7D0',
  Evening: 'FFFED7AA',
}
const CUSTOM_FILL = 'FFCBD5E1'
const SUNDAY_SHIFT_FILLS: Record<ShiftKey, string> = {
  Morning: 'FFFDA4AF',
  Afternoon: 'FFFBCFE8',
  Evening: 'FFF9A8D4',
}
const SUNDAY_CUSTOM_FILL = 'FFF9A8D4'

type DateParts = { year: number; month: number; day: number }
type EmployeeRecord = { uid: string; employeeCode?: unknown; fullName?: unknown }

function datePartsInVietnam(value: Date): DateParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const result = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return { year: Number(result.year), month: Number(result.month), day: Number(result.day) }
}

function dateKey(parts: DateParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function dateFromParts(parts: DateParts): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
}

function currentWeekBounds(now = new Date()) {
  const today = dateFromParts(datePartsInVietnam(now))
  const day = today.getUTCDay() || 7
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - (day - 1))
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)

  // Vietnam has a fixed UTC+07:00 offset. These are the exact UTC bounds for
  // the local Monday 00:00 through Sunday 23:59:59.999 window.
  const firestoreStart = new Date(start.getTime() - 7 * 60 * 60 * 1000)
  const firestoreEnd = new Date(end.getTime() + 17 * 60 * 60 * 1000 - 1)
  return { start, end, firestoreStart, firestoreEnd }
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate()
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: VIETNAM_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(value)
}

function columnLetter(column: number): string {
  let value = column
  let result = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

function isExportableSchedule(status: unknown, note: string): boolean {
  return !['Draft', 'Rejected', 'Cancelled'].includes(String(status)) && !note.includes('[NO_SHIFTS]')
}

function scheduleMark(note: string): string {
  return note.includes('[DUTY_ONLY]') ? 'T' : 'X'
}

function customShiftLabel(note: string): string | null {
  const match = note.match(/\[CUSTOM:(\d\d:\d\d)-(\d\d:\d\d)\]/)
  if (!match) return null
  const formatTime = (value: string) => {
    const [hour, minute] = value.split(':')
    return `${Number(hour)}h${minute === '00' ? '' : minute}`
  }
  return `${formatTime(match[1])}-${formatTime(match[2])}`
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request)
    if (!['admin', 'manager', 'director'].includes(actor.role)) {
      return NextResponse.json({ error: 'Chỉ tài khoản quản trị được xuất lịch nhân sự.' }, { status: 403 })
    }

    const bounds = currentWeekBounds()
    const [employeeSnapshot, scheduleSnapshot] = await Promise.all([
      adminDb.collection('employees').where('status', '==', 'active').get(),
      adminDb.collection('workSchedules')
        .where('date', '>=', bounds.firestoreStart)
        .where('date', '<=', bounds.firestoreEnd)
        .get(),
    ])

    const employees: EmployeeRecord[] = employeeSnapshot.docs
      .map((snapshot) => ({ uid: snapshot.id, ...snapshot.data() }) as EmployeeRecord)
      .sort((left, right) => {
        const codeOrder = String(left.employeeCode || '').localeCompare(String(right.employeeCode || ''), 'vi', { numeric: true })
        return codeOrder || String(left.fullName || '').localeCompare(String(right.fullName || ''), 'vi')
      })

    const employeeIds = new Set(employees.map((employee) => employee.uid))
    const scheduleCells = new Map<string, string[]>()
    scheduleSnapshot.docs.forEach((snapshot) => {
      const data = snapshot.data()
      const employeeId = String(data.employeeId || '')
      const shift = data.shift as ShiftKey
      const scheduleDate = toDate(data.date)
      const note = String(data.note || '')
      if (!employeeIds.has(employeeId) || !scheduleDate || !SHIFT_KEYS.includes(shift) || !isExportableSchedule(data.status, note)) return

      const customLabel = customShiftLabel(note)
      const columnKey: DayColumnKey = customLabel ? 'Custom' : shift
      const key = `${employeeId}-${dateKey(datePartsInVietnam(scheduleDate))}-${columnKey}`
      const marks = scheduleCells.get(key) || []
      marks.push(customLabel || scheduleMark(note))
      scheduleCells.set(key, marks)
    })

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Employee Management Portal'
    workbook.created = new Date()
    workbook.modified = new Date()
    const sheet = workbook.addWorksheet('Lịch tuần', {
      views: [{ state: 'frozen', xSplit: 3, ySplit: 5, showGridLines: false }],
      properties: { defaultRowHeight: 22 },
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    })
    sheet.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 }

    const dayStartColumn = 4
    const dayColumnKeys = WEEKDAY_LABELS.map((_, dayIndex) => dayIndex === 6 ? SUNDAY_COLUMN_KEYS : DAY_COLUMN_KEYS)
    const dayStartColumns: number[] = []
    let nextDayColumn = dayStartColumn
    dayColumnKeys.forEach((columns) => {
      dayStartColumns.push(nextDayColumn)
      nextDayColumn += columns.length
    })
    const totalColumns = nextDayColumn - 1
    const lastColumn = columnLetter(totalColumns)
    const dayDates = Array.from({ length: 7 }, (_, index) => {
      const value = new Date(bounds.start)
      value.setUTCDate(value.getUTCDate() + index)
      return value
    })

    sheet.columns = [
      { key: 'index', width: 6 },
      { key: 'code', width: 14 },
      { key: 'name', width: 28 },
      ...WEEKDAY_LABELS.flatMap((_, dayIndex) => dayColumnKeys[dayIndex].map((columnKey) => ({ key: `day${dayIndex}-${columnKey}`, width: 10 }))),
    ]

    sheet.mergeCells(`A1:${lastColumn}1`)
    sheet.getCell('A1').value = 'LỊCH NHÂN SỰ TUẦN NÀY'
    sheet.getCell('A1').font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' }
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }
    sheet.getRow(1).height = 30

    sheet.mergeCells(`A2:${lastColumn}2`)
    sheet.getCell('A2').value = `Tuần từ ${formatDate(bounds.start)} đến ${formatDate(bounds.end)} · Xuất lúc ${new Intl.DateTimeFormat('vi-VN', { timeZone: VIETNAM_TIME_ZONE, dateStyle: 'short', timeStyle: 'short' }).format(new Date())}`
    sheet.getCell('A2').font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF475569' } }
    sheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' }
    sheet.getRow(2).height = 22

    sheet.mergeCells(`A3:${lastColumn}3`)
    sheet.getCell('A3').value = 'T/Ca = giờ tăng ca · X = có ca làm · T = ca trực · ô trống = chưa có lịch'
    sheet.getCell('A3').font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF64748B' } }
    sheet.getCell('A3').alignment = { horizontal: 'left', vertical: 'middle' }
    sheet.getRow(3).height = 20

    ;[
      ['A4', 'A5', 'STT'],
      ['B4', 'B5', 'Mã NV'],
      ['C4', 'C5', 'Họ và tên'],
    ].forEach(([from, to, value]) => {
      sheet.mergeCells(`${from}:${to}`)
      sheet.getCell(from).value = value
    })

    WEEKDAY_LABELS.forEach((weekday, dayIndex) => {
      const columns = dayColumnKeys[dayIndex]
      const startColumn = dayStartColumns[dayIndex]
      const endColumn = startColumn + columns.length - 1
      const dayCell = sheet.getCell(4, startColumn)
      sheet.mergeCells(4, startColumn, 4, endColumn)
      dayCell.value = `${weekday}\n${formatDate(dayDates[dayIndex])}`
      dayCell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
      dayCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      dayCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: dayIndex === 6 ? 'FFBE123C' : 'FF334E68' } }

      columns.forEach((columnKey, columnIndex) => {
        const cell = sheet.getCell(5, startColumn + columnIndex)
        cell.value = DAY_COLUMN_LABELS[columnKey]
        cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF334155' } }
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
        const fill = columnKey === 'Custom'
          ? (dayIndex === 6 ? SUNDAY_CUSTOM_FILL : CUSTOM_FILL)
          : (dayIndex === 6 ? SUNDAY_SHIFT_FILLS[columnKey] : SHIFT_FILLS[columnKey])
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
      })
    })

    for (let rowIndex = 4; rowIndex <= 5; rowIndex += 1) {
      for (let column = 1; column <= totalColumns; column += 1) {
        sheet.getCell(rowIndex, column).border = { top: { style: 'thin', color: { argb: 'FFCBD5E1' } }, bottom: { style: 'thin', color: { argb: 'FF64748B' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } }
      }
    }
    ;['A4', 'B4', 'C4'].forEach((address) => {
      const cell = sheet.getCell(address)
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    })
    sheet.getRow(4).height = 34
    sheet.getRow(5).height = 22

    const dataStartRow = 6
    employees.forEach((employee, employeeIndex) => {
      const values: ExcelJS.CellValue[] = [employeeIndex + 1, String(employee.employeeCode || ''), String(employee.fullName || '')]
      dayDates.forEach((day, dayIndex) => {
        const dayKey = dateKey({ year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate() })
        dayColumnKeys[dayIndex].forEach((columnKey) => {
          const marks = scheduleCells.get(`${employee.uid}-${dayKey}-${columnKey}`) || []
          const uniqueMarks = Array.from(new Set(marks))
          values.push((uniqueMarks.length ? uniqueMarks.join('/') : null) as ExcelJS.CellValue)
        })
      })

      const row = sheet.addRow(values)
      row.height = 22
      for (let columnNumber = 1; columnNumber <= totalColumns; columnNumber += 1) {
        const cell = row.getCell(columnNumber)
        cell.font = { name: 'Arial', size: 10, color: { argb: 'FF0F172A' } }
        cell.alignment = { horizontal: columnNumber <= 3 ? (columnNumber === 3 ? 'left' : 'center') : 'center', vertical: 'middle', wrapText: false }
        cell.border = { bottom: { style: 'thin', color: { argb: 'FF334155' } }, left: { style: 'hair', color: { argb: 'FFE2E8F0' } }, right: { style: 'hair', color: { argb: 'FFE2E8F0' } } }
      }
      row.getCell(3).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF0F172A' } }
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
      row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
      row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }

      dayDates.forEach((_, dayIndex) => {
        dayColumnKeys[dayIndex].forEach((columnKey, columnIndex) => {
          const cell = row.getCell(dayStartColumns[dayIndex] + columnIndex)
          const fill = columnKey === 'Custom'
            ? (dayIndex === 6 ? SUNDAY_CUSTOM_FILL : CUSTOM_FILL)
            : (dayIndex === 6 ? SUNDAY_SHIFT_FILLS[columnKey] : SHIFT_FILLS[columnKey])
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
          if (cell.value) {
            cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: columnKey === 'Custom' ? 'FF475569' : dayIndex === 6 ? 'FF9F1239' : 'FF166534' } }
          }
        })
      })
    })

    const dataEndRow = Math.max(dataStartRow, dataStartRow + employees.length - 1)
    const summaryRow = dataEndRow + 1
    sheet.mergeCells(`A${summaryRow}:C${summaryRow}`)
    sheet.getCell(`A${summaryRow}`).value = `Tổng nhân sự: ${employees.length} · Có lịch: ${employees.filter((employee) => Array.from(scheduleCells.keys()).some((key) => key.startsWith(`${employee.uid}-`))).length}`
    sheet.getCell(`A${summaryRow}`).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF334155' } }
    sheet.getCell(`A${summaryRow}`).alignment = { horizontal: 'left', vertical: 'middle' }
    dayColumnKeys.forEach((columns, dayIndex) => {
      const dayKey = dateKey({ year: dayDates[dayIndex].getUTCFullYear(), month: dayDates[dayIndex].getUTCMonth() + 1, day: dayDates[dayIndex].getUTCDate() })
      columns.forEach((columnKey, columnIndex) => {
        const column = dayStartColumns[dayIndex] + columnIndex
        const cell = sheet.getCell(summaryRow, column)
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF334155' } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        if (employees.length) {
          const letter = columnLetter(column)
          const count = employees.reduce((total, employee) => total + Number(scheduleCells.has(`${employee.uid}-${dayKey}-${columnKey}`)), 0)
          cell.value = { formula: `COUNTIF(${letter}${dataStartRow}:${letter}${dataEndRow},"<>")`, result: count }
        }
      })
    })
    for (let column = 1; column <= totalColumns; column += 1) {
      sheet.getCell(summaryRow, column).border = { top: { style: 'thin', color: { argb: 'FF94A3B8' } }, bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } }
    }
    sheet.getRow(summaryRow).height = 24

    const buffer = await workbook.xlsx.writeBuffer()
    const fileDate = dateKey({ year: bounds.start.getUTCFullYear(), month: bounds.start.getUTCMonth() + 1, day: bounds.start.getUTCDate() })
    return new Response(buffer, {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="lich-nhan-su-tuan-nay-${fileDate}.xlsx"`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('Current week schedule Excel export failed:', error)
    return NextResponse.json({ error: 'Chưa thể xuất lịch nhân sự tuần này.' }, { status: 500 })
  }
}
