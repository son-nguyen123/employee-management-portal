import { describe, expect, it, vi } from 'vitest'
import ExcelJS from 'exceljs'

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(async () => ({ role: 'admin', uid: 'admin-1', factoryId: 'factory-1' })),
  getAuthorizedMonthData: vi.fn(async () => ({
    source: 'firestore',
    employees: [{
      id: 'employee-1',
      uid: 'employee-1',
      fullName: 'Nguyễn Văn An',
      employeeCode: '0012',
      status: 'active',
      bankName: 'Vietcombank',
      bankAccountName: 'NGUYEN VAN AN',
      bankAccountNumber: '0012345678',
    }],
    records: [{
      id: 'advance-1',
      employeeId: 'employee-1',
      amount: 2_000_000,
      status: 'Approved',
      reviewedAt: new Date('2026-09-05T03:00:00.000Z'),
      reason: 'Việc gia đình',
    }],
  })),
}))

vi.mock('@/lib/server/api-auth', () => ({ authenticateRequest: mocks.authenticateRequest }))
vi.mock('@/lib/server/month-data', () => ({ getAuthorizedMonthData: mocks.getAuthorizedMonthData }))

import { GET } from '@/app/api/exports/salary-advances/route'

describe('salary advance Excel export', () => {
  it('uses the simple bank-table layout while retaining all existing columns', async () => {
    const response = await GET(new Request('http://localhost/api/exports/salary-advances?month=2026-09', {
      headers: { authorization: 'Bearer test-token' },
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('danh-sach-ung-luong-da-duyet-2026-09.xlsx')

    const workbook = new ExcelJS.Workbook()
    const bytes = Buffer.from(await response.arrayBuffer())
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
    const sheet = workbook.getWorksheet('Ứng lương')

    expect(sheet?.getCell('A2').value).toBe('DANH SÁCH ỨNG LƯƠNG ĐÃ DUYỆT THÁNG 09/2026')
    expect(sheet?.getRow(3).values).toEqual([
      undefined,
      'STT', 'Họ và tên', 'Mã NV', 'Số tiền', 'Ngân hàng',
      'Tên chủ tài khoản', 'Số tài khoản', 'Ngày duyệt', 'Lý do',
    ])
    expect(sheet?.getCell('A3').fill).toMatchObject({ fgColor: { argb: 'FFFFFF00' } })
    expect(sheet?.getCell('A3').border.top).toMatchObject({ style: 'thin', color: { argb: 'FF000000' } })
    expect(sheet?.getCell('B4').value).toBe('Nguyễn Văn An')
    expect(sheet?.getCell('G4').value).toBe('0012345678')
    expect(sheet?.getCell('G4').numFmt).toBe('@')
    expect(sheet?.getCell('A5').value).toBe('TỔNG')
    expect(sheet?.getCell('D5').value).toBe(2_000_000)
    expect(sheet?.views[0]).toMatchObject({ state: 'frozen', ySplit: 3, showGridLines: true })
  })
})
