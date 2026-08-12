import { beforeEach, describe, expect, it, vi } from 'vitest'
import ExcelJS from 'exceljs'

const mocks = vi.hoisted(() => {
  const employeeDocs = [
    { id: 'employee-1', data: () => ({ fullName: 'Nguyễn Minh An', employeeCode: 'NV-001', status: 'active' }) },
  ]
  const currentWeekStart = new Date()
  const day = currentWeekStart.getDay() || 7
  currentWeekStart.setDate(currentWeekStart.getDate() - day + 1)
  currentWeekStart.setHours(9, 0, 0, 0)
  const tuesday = new Date(currentWeekStart)
  tuesday.setDate(tuesday.getDate() + 1)
  const sunday = new Date(currentWeekStart)
  sunday.setDate(sunday.getDate() + 6)
  const scheduleDocs = [
    { id: 'schedule-1', data: () => ({ employeeId: 'employee-1', date: currentWeekStart, shift: 'Morning', status: 'Approved', note: '' }) },
    { id: 'schedule-2', data: () => ({ employeeId: 'employee-1', date: tuesday, shift: 'Morning', status: 'Approved', note: '[CUSTOM:13:00-21:00]' }) },
    { id: 'schedule-3', data: () => ({ employeeId: 'employee-1', date: sunday, shift: 'Afternoon', status: 'Approved', note: '[DUTY_ONLY]' }) },
  ]
  const collection = (docs: typeof employeeDocs | typeof scheduleDocs) => {
    const query = {
      where: vi.fn(() => query),
      get: vi.fn(async () => ({ docs })),
    }
    return query
  }
  return {
    employeeDocs,
    scheduleDocs,
    adminDb: { collection: vi.fn((name: string) => collection(name === 'employees' ? employeeDocs : scheduleDocs)) },
    authenticateRequest: vi.fn(async () => ({ role: 'admin', uid: 'admin-1' })),
  }
})

vi.mock('@/lib/server/api-auth', () => ({
  ApiError: class ApiError extends Error {
    constructor(public readonly status: number, message: string) {
      super(message)
    }
  },
  authenticateRequest: mocks.authenticateRequest,
}))

vi.mock('@/lib/server/firebase-admin', () => ({ adminDb: mocks.adminDb }))

import { GET } from '@/app/api/exports/next-week-schedule/route'
import { GET as GETDuty } from '@/app/api/exports/next-week-duty/route'

describe('current-week schedule export', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a Monday-to-Sunday workbook with shift marks and a total column', async () => {
    const response = await GET(new Request('http://localhost/api/exports/next-week-schedule', {
      headers: { authorization: 'Bearer test-token' },
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('spreadsheetml.sheet')

    const workbook = new ExcelJS.Workbook()
    const workbookBytes = Buffer.from(await response.arrayBuffer())
    await workbook.xlsx.load(workbookBytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
    if (process.env.NEXT_WEEK_EXPORT_VERIFY_PATH) {
      await workbook.xlsx.writeFile(process.env.NEXT_WEEK_EXPORT_VERIFY_PATH)
    }
    const sheet = workbook.getWorksheet('Lịch tuần')

    expect(sheet).toBeDefined()
    expect(sheet?.getCell('A1').value).toBe('LỊCH NHÂN SỰ TUẦN NÀY')
    expect(sheet?.getCell('D5').value).toBe('Sáng')
    expect(sheet?.getCell('G5').value).toBe('T/Ca')
    expect(String(sheet?.getCell('D4').value)).toContain('Thứ 2')
    expect(String(sheet?.getCell('AB4').value)).toContain('Chủ nhật')
    expect(sheet?.getCell('AB5').value).toBe('Sáng')
    expect(sheet?.getCell('AC5').value).toBe('Chiều')
    expect(sheet?.getCell('AD5').value).toBeNull()
    expect(sheet?.getCell('D6').value).toBe('X')
    expect(sheet?.getCell('A6').border.bottom).toMatchObject({ style: 'thin', color: { argb: 'FF334155' } })
    expect(sheet?.getCell('AC6').border.bottom).toMatchObject({ style: 'thin', color: { argb: 'FF334155' } })
    expect(sheet?.getCell('K6').value).toBe('13h-21h')
    expect(sheet?.getCell('AC6').value).toBe('T')
    expect(sheet?.getCell('D7').value).toMatchObject({ result: 1 })
    expect(sheet?.getCell('AC7').value).toMatchObject({ result: 1 })
  })

  it('creates a compact duty roster with one column per day', async () => {
    const response = await GETDuty(new Request('http://localhost/api/exports/next-week-duty', {
      headers: { authorization: 'Bearer test-token' },
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('spreadsheetml.sheet')

    const workbook = new ExcelJS.Workbook()
    const workbookBytes = Buffer.from(await response.arrayBuffer())
    await workbook.xlsx.load(workbookBytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
    if (process.env.NEXT_WEEK_DUTY_EXPORT_VERIFY_PATH) {
      await workbook.xlsx.writeFile(process.env.NEXT_WEEK_DUTY_EXPORT_VERIFY_PATH)
    }
    const sheet = workbook.getWorksheet('Lịch trực')

    expect(sheet).toBeDefined()
    expect(sheet?.getCell('A1').value).toBe('LỊCH TRỰC TUẦN NÀY')
    expect(String(sheet?.getCell('G4').value)).toContain('Chủ nhật')
    expect(String(sheet?.getCell('G5').value)).toContain('Nguyễn Minh An-001')
  })
})
