export type PreviewScheduleStatus =
  | 'Pending'
  | 'Editing'
  | 'ChangesRequested'
  | 'Approved'
  | 'Rejected'
  | 'Cancelled'

export interface PreviewSchedule {
  id: string
  employeeId: string
  employeeName: string
  employeeCode: string
  phone: string
  facebookUrl: string
  date: string
  shift: 'Morning' | 'Afternoon' | 'Evening'
  note: string
  status: PreviewScheduleStatus
  reviewNote?: string
  editPreviousStatus?: PreviewScheduleStatus
  requiresReapproval?: boolean
  weeklyShiftCount?: number
  underMinimumWarning?: boolean
  autoApproved?: boolean
  reviewedAt?: string
}

const STORAGE_KEY = 'employee-portal-preview-schedules'

function nextWeekDate(dayOffset: number) {
  const today = new Date()
  const monday = new Date(today)
  const day = today.getDay() || 7
  monday.setDate(today.getDate() - day + 1 + 7 + dayOffset)
  monday.setHours(12, 0, 0, 0)
  return monday.toISOString()
}

function currentWeekDate(dayOffset: number) {
  const today = new Date()
  const monday = new Date(today)
  const day = today.getDay() || 7
  monday.setDate(today.getDate() - day + 1 + dayOffset)
  monday.setHours(12, 0, 0, 0)
  return monday.toISOString()
}

const defaultSchedules: PreviewSchedule[] = [
  {
    id: 'preview-schedule-1',
    employeeId: 'demo-user-001',
    employeeName: 'Nguyễn Minh An',
    employeeCode: 'NV-001',
    phone: '0901 234 567',
    facebookUrl: 'https://facebook.com/',
    date: nextWeekDate(0),
    shift: 'Morning',
    note: '',
    status: 'Approved',
    weeklyShiftCount: 5,
    underMinimumWarning: true,
    autoApproved: true,
    reviewedAt: new Date().toISOString(),
  },
  {
    id: 'preview-schedule-2',
    employeeId: 'demo-user-001',
    employeeName: 'Nguyễn Minh An',
    employeeCode: 'NV-001',
    phone: '0901 234 567',
    facebookUrl: 'https://facebook.com/',
    date: currentWeekDate(2),
    shift: 'Afternoon',
    note: '',
    status: 'Approved',
    weeklyShiftCount: 6,
    autoApproved: true,
    reviewedAt: new Date().toISOString(),
  },
  {
    id: 'preview-schedule-3',
    employeeId: 'preview-employee-2',
    employeeName: 'Trần Hải Yến',
    employeeCode: 'NV-008',
    phone: '0908 345 678',
    facebookUrl: 'https://facebook.com/',
    date: nextWeekDate(1),
    shift: 'Evening',
    note: '',
    status: 'Approved',
    weeklyShiftCount: 6,
    autoApproved: true,
    reviewedAt: new Date().toISOString(),
  },
  {
    id: 'preview-schedule-4',
    employeeId: 'preview-employee-approved',
    employeeName: 'Lê Gia Hân',
    employeeCode: 'NV-012',
    phone: '0912 345 678',
    facebookUrl: 'https://facebook.com/',
    date: nextWeekDate(3),
    shift: 'Morning',
    note: '',
    status: 'Approved',
    weeklyShiftCount: 6,
    autoApproved: true,
    reviewedAt: new Date().toISOString(),
  },
  {
    id: 'preview-schedule-5',
    employeeId: 'preview-employee-rejected',
    employeeName: 'Phạm Quốc Bảo',
    employeeCode: 'NV-015',
    phone: '0915 678 234',
    facebookUrl: 'https://facebook.com/',
    date: nextWeekDate(4),
    shift: 'Afternoon',
    note: '',
    status: 'Rejected',
    reviewNote: 'Cần đăng ký thêm ca phù hợp nhu cầu nhân sự.',
  },
]

export function getPreviewSchedules(): PreviewSchedule[] {
  if (typeof window === 'undefined') return defaultSchedules
  const stored = window.sessionStorage.getItem(STORAGE_KEY)
  if (!stored) {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(defaultSchedules))
    return defaultSchedules
  }
  return JSON.parse(stored) as PreviewSchedule[]
}

export function addPreviewSchedules(items: PreviewSchedule[]) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([...getPreviewSchedules(), ...items])
  )
}

export function updatePreviewSchedule(
  scheduleId: string,
  updates: Partial<PreviewSchedule>
) {
  if (typeof window === 'undefined') return
  const next = getPreviewSchedules().map((item) =>
    item.id === scheduleId ? { ...item, ...updates } : item
  )
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}
