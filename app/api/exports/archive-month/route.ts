import { NextResponse } from 'next/server'
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx'
import { authenticateRequest } from '@/lib/server/api-auth'
import { listWeeklyArchives, readWeeklyArchive } from '@/lib/server/google-drive-archive'

export const runtime = 'nodejs'

type ArchiveRecord = { id: string; path: string; data: Record<string, unknown> }
type ArchivePayload = { records?: Record<string, ArchiveRecord[]> }

const collectionLabels: Record<string, string> = {
  workSchedules: 'Lịch làm',
  leaveRequests: 'Xin nghỉ',
  lateRequests: 'Đi trễ',
  salaryAdvances: 'Ứng lương',
  staffRequests: 'Làm thêm và ghi chú',
  penalties: 'Khoản phạt',
  employeeProfiles: 'Hồ sơ nhân viên',
  auditEvents: 'Lịch sử thao tác',
}

const fieldLabels: Record<string, string> = {
  employeeId: 'Mã nhân viên',
  employeeCode: 'Mã nhân viên',
  employeeName: 'Nhân viên',
  fullName: 'Họ và tên',
  date: 'Ngày',
  leaveDate: 'Ngày nghỉ',
  endDate: 'Đến ngày',
  shift: 'Ca',
  lateMinutes: 'Số phút đi trễ',
  expectedArrival: 'Giờ dự kiến',
  reason: 'Lý do',
  content: 'Nội dung',
  amount: 'Số tiền',
  status: 'Trạng thái',
  reviewNote: 'Phản hồi quản lý',
  bankName: 'Ngân hàng',
  bankAccountName: 'Chủ tài khoản',
  bankAccountNumber: 'Số tài khoản',
  createdAt: 'Thời gian tạo',
  updatedAt: 'Cập nhật lúc',
  reviewedAt: 'Xử lý lúc',
  cancellationReason: 'Lý do hủy',
}

function sourceWeekKey(archiveKey: string) {
  return archiveKey.split('-test-')[0]
}

function fileTouchesMonth(archiveKey: string, month: string) {
  const start = new Date(`${sourceWeekKey(archiveKey)}T12:00:00+07:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const key = (date: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
  }).format(date)
  return key(start) === month || key(end) === month
}

function belongsToMonth(collection: string, data: Record<string, unknown>, month: string) {
  const value = collection === 'workSchedules' || collection === 'lateRequests'
    ? data.date
    : collection === 'leaveRequests'
      ? data.leaveDate
      : collection === 'penalties'
        ? data.penaltyDate
        : data.reviewedAt || data.updatedAt || data.createdAt
  const date = new Date(String(value || ''))
  if (Number.isNaN(date.getTime())) return collection === 'employeeProfiles'
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
  }).format(date) === month
}

function displayValue(key: string, value: unknown) {
  if (value == null || value === '') return ''
  if (key === 'status') return value === 'Approved' ? 'Đã duyệt' : value === 'Rejected' ? 'Từ chối' : value === 'Cancelled' ? 'Đã hủy' : value === 'Pending' ? 'Chờ duyệt' : String(value)
  if (key === 'shift') return value === 'Morning' ? 'Ca sáng' : value === 'Afternoon' ? 'Ca chiều' : 'Ca tối'
  if (key === 'amount') return `${Number(value || 0).toLocaleString('vi-VN')}đ`
  if (key.toLowerCase().includes('date') || key.endsWith('At')) {
    const date = new Date(String(value))
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
  }
  if (Array.isArray(value)) return value.map(String).join(', ')
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
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
      if (!current || (current.archiveKey.includes('-test-') && !file.archiveKey.includes('-test-'))) canonical.set(key, file)
    })
    const payloads = await Promise.all([...canonical.values()].map((file) => readWeeklyArchive(file.id) as Promise<ArchivePayload>))
    const records = new Map<string, ArchiveRecord[]>()
    payloads.forEach((payload) => Object.entries(payload.records || {}).forEach(([collection, rows]) => {
      const accepted = rows.filter((record) => belongsToMonth(collection, record.data || {}, month))
      if (accepted.length) records.set(collection, [...(records.get(collection) || []), ...accepted])
    }))
    const employeeNames = new Map<string, string>()
    ;(records.get('employeeProfiles') || []).forEach((record) => {
      const name = String(record.data.fullName || '').trim()
      if (name) employeeNames.set(record.id, name)
    })

    const children: Paragraph[] = [
      new Paragraph({
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: `KHO DỮ LIỆU THÁNG ${month.slice(5)}/${month.slice(0, 4)}`, bold: true })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun(`Xuất lúc ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`)],
      }),
      new Paragraph(''),
    ]
    for (const [collection, rows] of records) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: `${collectionLabels[collection] || collection} (${rows.length})`, bold: true })],
      }))
      rows.forEach((record, index) => {
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({
            text: `${index + 1}. ${String(
              record.data.fullName ||
              record.data.employeeName ||
              employeeNames.get(String(record.data.employeeId || '')) ||
              record.data.employeeCode ||
              record.id
            )}`,
            bold: true,
          })],
        }))
        Object.entries(record.data || {})
          .filter(([key, value]) => key in fieldLabels && displayValue(key, value))
          .forEach(([key, value]) => children.push(new Paragraph({
            children: [
              new TextRun({ text: `${fieldLabels[key]}: `, bold: true }),
              new TextRun(displayValue(key, value)),
            ],
          })))
        children.push(new Paragraph(''))
      })
    }
    if (!records.size) children.push(new Paragraph('Tháng này chưa có dữ liệu lưu trữ.'))
    const buffer = await Packer.toBuffer(new Document({ sections: [{ children }] }))
    return new Response(buffer, {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-disposition': `attachment; filename="kho-du-lieu-${month}.docx"`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Archive month Word export failed:', error)
    return NextResponse.json({ error: 'Chưa thể xuất kho dữ liệu tháng.' }, { status: 500 })
  }
}
