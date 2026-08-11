import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { ApiError, authenticateRequest } from '@/lib/server/api-auth'
import { adminDb } from '@/lib/server/firebase-admin'

export const runtime = 'nodejs'

const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'
const WEEKDAY_LABELS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật']
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

function nextWeekBounds(now = new Date()) {
  const today = dateFromParts(datePartsInVietnam(now))
  const day = today.getUTCDay() || 7
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() + (8 - day))
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)
  return {
    start,
    end,
    firestoreStart: new Date(start.getTime() - 7 * 60 * 60 * 1000),
    firestoreEnd: new Date(end.getTime() + 17 * 60 * 60 * 1000 - 1),
  }
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

function isDutySchedule(status: unknown, note: string): boolean {
  return !['Draft', 'Rejected', 'Cancelled'].includes(String(status))
    && !note.includes('[NO_SHIFTS]')
    && note.includes('[DUTY')
}

function displayEmployeeCode(value: unknown, fallback: string): string {
  const code = String(value || fallback).trim()
  return code.replace(/^NV[-\s]?/i, '')
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request)
    if (!['admin', 'manager'].includes(actor.role)) {
      return NextResponse.json({ error: 'Chỉ quản lý hoặc admin được xuất lịch trực.' }, { status: 403 })
    }

    const bounds = nextWeekBounds()
    const [employeeSnapshot, scheduleSnapshot] = await Promise.all([
      adminDb.collection('employees').where('status', '==', 'active').get(),
      adminDb.collection('workSchedules')
        .where('date', '>=', bounds.firestoreStart)
        .where('date', '<=', bounds.firestoreEnd)
        .get(),
    ])
    const employees: EmployeeRecord[] = employeeSnapshot.docs
      .map((snapshot) => ({ uid: snapshot.id, ...snapshot.data() }) as EmployeeRecord)
    const employeeMap = new Map(employees.map((employee) => [employee.uid, employee]))
    const dayDates = Array.from({ length: 7 }, (_, index) => {
      const value = new Date(bounds.start)
      value.setUTCDate(value.getUTCDate() + index)
      return value
    })
    const dayKeys = dayDates.map((date) => dateKey({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }))
    const rosters = dayDates.map(() => new Map<string, string>())

    scheduleSnapshot.docs.forEach((snapshot) => {
      const data = snapshot.data()
      const note = String(data.note || '')
      const employeeId = String(data.employeeId || '')
      const scheduleDate = toDate(data.date)
      const dayIndex = scheduleDate ? dayKeys.indexOf(dateKey(datePartsInVietnam(scheduleDate))) : -1
      const employee = employeeMap.get(employeeId)
      if (dayIndex < 0 || !employee || !isDutySchedule(data.status, note)) return
      const fullName = String(employee.fullName || 'Nhân viên')
      const employeeCode = displayEmployeeCode(employee.employeeCode, employeeId)
      rosters[dayIndex].set(employeeId, `${fullName}-${employeeCode}`)
    })

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Employee Management Portal'
    workbook.created = new Date()
    workbook.modified = new Date()
    const sheet = workbook.addWorksheet('Lịch trực', {
      views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
      properties: { defaultRowHeight: 22 },
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 9 },
    })
    sheet.pageSetup.margins = { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 }
    sheet.columns = WEEKDAY_LABELS.map((_, index) => ({ key: `day-${index}`, width: 23 }))

    sheet.mergeCells('A1:G1')
    sheet.getCell('A1').value = 'LỊCH TRỰC TUẦN TỚI'
    sheet.getCell('A1').font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' }
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B21B6' } }
    sheet.getRow(1).height = 30

    sheet.mergeCells('A2:G2')
    sheet.getCell('A2').value = `Tuần từ ${formatDate(bounds.start)} đến ${formatDate(bounds.end)}`
    sheet.getCell('A2').font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF475569' } }
    sheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' }

    sheet.mergeCells('A3:G3')
    sheet.getCell('A3').value = 'Danh sách người đăng ký trực theo từng ngày'
    sheet.getCell('A3').font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF64748B' } }
    sheet.getCell('A3').alignment = { horizontal: 'left', vertical: 'middle' }

    const headerRow = sheet.getRow(4)
    dayDates.forEach((date, index) => {
      const cell = headerRow.getCell(index + 1)
      cell.value = `${WEEKDAY_LABELS[index]}\n${formatDate(date)}`
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index === 6 ? 'FFBE123C' : 'FF6D28D9' } }
      cell.border = { top: { style: 'thin', color: { argb: 'FFCBD5E1' } }, bottom: { style: 'thin', color: { argb: 'FF64748B' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } }
    })
    headerRow.height = 34

    const rosterValues = rosters.map((roster) => [...roster.values()].sort((left, right) => left.localeCompare(right, 'vi')).join('\n'))
    const rosterRow = sheet.addRow(rosterValues)
    rosterRow.height = Math.max(30, Math.min(150, Math.max(...rosters.map((roster) => roster.size), 1) * 22 + 10))
    rosterRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: columnNumber === 7 ? 'FF9F1239' : 'FF4C1D95' } }
      cell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: columnNumber === 7 ? 'FFFFE4E6' : 'FFF5F3FF' } }
      cell.border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } }
    })

    const totalRosterCount = rosters.reduce((total, roster) => total + roster.size, 0)
    sheet.mergeCells('A6:G6')
    sheet.getCell('A6').value = `Tổng lượt trực: ${totalRosterCount}`
    sheet.getCell('A6').font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF475569' } }
    sheet.getCell('A6').alignment = { horizontal: 'left', vertical: 'middle' }
    sheet.getCell('A6').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } }
    sheet.getRow(6).height = 24

    const buffer = await workbook.xlsx.writeBuffer()
    const fileDate = dateKey({ year: bounds.start.getUTCFullYear(), month: bounds.start.getUTCMonth() + 1, day: bounds.start.getUTCDate() })
    return new Response(buffer, {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="lich-truc-tuan-toi-${fileDate}.xlsx"`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('Next week duty Excel export failed:', error)
    return NextResponse.json({ error: 'Chưa thể xuất lịch trực tuần tới.' }, { status: 500 })
  }
}
