import { NextResponse } from 'next/server'
import { Packer, Paragraph, Table } from 'docx'
import { authenticateRequest } from '@/lib/server/api-auth'
import { listWeeklyArchives, readWeeklyArchive } from '@/lib/server/google-drive-archive'
import {
  landscapeReport,
  money,
  reportDate,
  reportSectionHeading,
  reportTable,
  reportTitle,
  shiftLabel,
  statusLabel,
} from '@/lib/server/word-report'

export const runtime = 'nodejs'

type ArchiveRecord = { id: string; path: string; data: Record<string, unknown> }
type ArchivePayload = { records?: Record<string, ArchiveRecord[]> }

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
  const date = new Date(String(value || ''))
  return !Number.isNaN(date.getTime()) && localMonth(date) === month
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request)
    if (!['admin', 'manager'].includes(actor.role)) {
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
    payloads.forEach((payload) => Object.entries(payload.records || {}).forEach(([collection, rows]) => {
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
    const children: Array<Paragraph | Table> = [
      ...reportTitle(
        `BÁO CÁO NHÂN SỰ THÁNG ${month.slice(5)}/${month.slice(0, 4)}`,
        `Tổng hợp từ kho dữ liệu Google Drive · Xuất lúc ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`
      ),
    ]

    const schedules = rowsOf('workSchedules').map((record, index) => {
      const employee = identity(record.data.employeeId)
      return [
        String(index + 1),
        employee.name,
        employee.code,
        reportDate(record.data.date),
        shiftLabel(record.data.shift),
        statusLabel(record.data.status),
      ]
    })
    if (schedules.length) {
      children.push(reportSectionHeading(`Lịch làm (${schedules.length} ca)`))
      children.push(reportTable(
        ['STT', 'Họ và tên', 'Mã NV', 'Ngày', 'Ca', 'Trạng thái'],
        schedules,
        [600, 3900, 2200, 2400, 2200, 2860],
        [0, 2, 3, 4, 5]
      ))
    }

    const leaves = rowsOf('leaveRequests').map((record, index) => {
      const employee = identity(record.data.employeeId)
      return [
        String(index + 1),
        employee.name,
        employee.code,
        reportDate(record.data.leaveDate),
        reportDate(record.data.endDate || record.data.leaveDate),
        statusLabel(record.data.status),
        String(record.data.reason || ''),
      ]
    })
    if (leaves.length) {
      children.push(reportSectionHeading(`Xin nghỉ (${leaves.length} yêu cầu)`))
      children.push(reportTable(
        ['STT', 'Họ và tên', 'Mã NV', 'Từ ngày', 'Đến ngày', 'Trạng thái', 'Lý do'],
        leaves,
        [500, 2800, 1700, 1700, 1700, 1600, 4160],
        [0, 2, 3, 4, 5]
      ))
    }

    const lateRows = rowsOf('lateRequests').map((record, index) => {
      const employee = identity(record.data.employeeId)
      return [
        String(index + 1),
        employee.name,
        employee.code,
        reportDate(record.data.date),
        String(record.data.lateMinutes || 0),
        statusLabel(record.data.status),
        String(record.data.reason || ''),
      ]
    })
    if (lateRows.length) {
      children.push(reportSectionHeading(`Đi trễ (${lateRows.length} yêu cầu)`))
      children.push(reportTable(
        ['STT', 'Họ và tên', 'Mã NV', 'Ngày', 'Số phút', 'Trạng thái', 'Lý do'],
        lateRows,
        [500, 2800, 1700, 1800, 1300, 1600, 4460],
        [0, 2, 3, 4, 5]
      ))
    }

    const salaryRows = rowsOf('salaryAdvances').map((record, index) => {
      const employee = identity(record.data.employeeId)
      return [
        String(index + 1),
        employee.name,
        employee.code,
        money(record.data.amount),
        statusLabel(record.data.status),
        reportDate(record.data.createdAt),
        String(record.data.reason || ''),
      ]
    })
    if (salaryRows.length) {
      children.push(reportSectionHeading(`Ứng lương (${salaryRows.length} yêu cầu)`))
      children.push(reportTable(
        ['STT', 'Họ và tên', 'Mã NV', 'Số tiền', 'Trạng thái', 'Ngày gửi', 'Lý do'],
        salaryRows,
        [500, 2800, 1700, 1800, 1600, 1800, 3960],
        [0, 2, 3, 4, 5]
      ))
    }

    const staffRequestLabels: Record<string, string> = {
      overtime: 'Làm thêm',
      scheduleChange: 'Đổi / thêm ca',
      note: 'Ghi chú',
    }
    const staffRequests = rowsOf('staffRequests').map((record, index) => {
      const employee = identity(record.data.employeeId)
      return [
        String(index + 1),
        employee.name,
        employee.code,
        staffRequestLabels[String(record.data.type || '')] || 'Yêu cầu khác',
        statusLabel(record.data.status),
        String(record.data.content || record.data.reason || ''),
      ]
    })
    if (staffRequests.length) {
      children.push(reportSectionHeading(`Yêu cầu khác (${staffRequests.length} yêu cầu)`))
      children.push(reportTable(
        ['STT', 'Họ và tên', 'Mã NV', 'Loại', 'Trạng thái', 'Nội dung'],
        staffRequests,
        [500, 3000, 1800, 2200, 1800, 4860],
        [0, 2, 3, 4]
      ))
    }

    const penalties = rowsOf('penalties').map((record, index) => {
      const employee = identity(record.data.employeeId)
      return [
        String(index + 1),
        employee.name,
        employee.code,
        money(record.data.status === 'Cancelled' ? 0 : record.data.amount),
        statusLabel(record.data.status || 'Active'),
        String(record.data.description || record.data.reason || ''),
      ]
    })
    if (penalties.length) {
      children.push(reportSectionHeading(`Khoản phạt (${penalties.length} khoản)`))
      children.push(reportTable(
        ['STT', 'Họ và tên', 'Mã NV', 'Số tiền', 'Trạng thái', 'Lý do'],
        penalties,
        [500, 3000, 1800, 1800, 1600, 5460],
        [0, 2, 3, 4]
      ))
    }

    if (children.length === 2) children.push(new Paragraph('Tháng này chưa có dữ liệu đã lưu.'))

    const buffer = await Packer.toBuffer(landscapeReport(children))
    return new Response(buffer, {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-disposition': `attachment; filename="bao-cao-nhan-su-${month}.docx"`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Archive month Word export failed:', error)
    return NextResponse.json({ error: 'Chưa thể xuất báo cáo tháng.' }, { status: 500 })
  }
}
