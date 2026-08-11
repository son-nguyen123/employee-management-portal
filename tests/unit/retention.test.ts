import { describe, expect, it } from 'vitest'
import { previousVietnamMonth, previousVietnamWeek, scheduleShareText, vietnamWeekContaining } from '@/lib/archive/retention'

describe('quy tắc lưu và reset dữ liệu', () => {
  it('giữ tuần hiện tại và tuần trước, chỉ chọn tuần cách đây hai tuần để xóa', () => {
    const now = new Date('2026-08-17T01:00:00+07:00')
    expect(vietnamWeekContaining(now).key).toBe('2026-08-17')
    expect(previousVietnamWeek(now, 1).key).toBe('2026-08-10')
    expect(previousVietnamWeek(now, 2).key).toBe('2026-08-03')
  })

  it('tính tuần đúng khi thời gian UTC còn thuộc ngày hôm trước', () => {
    const now = new Date('2026-08-10T00:05:00+07:00')
    expect(vietnamWeekContaining(now).start.toISOString()).toBe('2026-08-09T17:00:00.000Z')
    expect(previousVietnamWeek(now).end.toISOString()).toBe('2026-08-09T17:00:00.000Z')
  })

  it('reset đúng tháng trước theo múi giờ Việt Nam, kể cả đổi năm', () => {
    const window = previousVietnamMonth(new Date('2027-01-01T00:15:00+07:00'))
    expect(window.key).toBe('2026-12')
    expect(window.start.toISOString()).toBe('2026-11-30T17:00:00.000Z')
    expect(window.end.toISOString()).toBe('2026-12-31T17:00:00.000Z')
  })
})

describe('câu gửi lịch tự động', () => {
  it('có tên, mã và khoảng tuần', () => {
    expect(scheduleShareText({
      fullName: 'Nguyễn Văn An',
      employeeCode: 'NV-018',
      weekStart: new Date(2026, 7, 10),
      weekEnd: new Date(2026, 7, 16),
    })).toBe('Em là Nguyễn Văn An, mã NV-018, gửi lịch làm tuần 10/8–16/8.')
  })
})
