export type EmployeeReviewLevel = 'stable' | 'attention' | 'warning' | 'neutral'

export interface EmployeeReviewWeek {
  weekStart: string
  weekEnd: string
  scheduledShifts: number
  approvedShifts: number
  leaveRequests: number
  approvedLeaveRequests: number
  lateRequests: number
  shortNoticeEvents: number
  hasLongLeave: boolean
  source: 'firestore' | 'drive' | 'mixed' | 'none'
}

export interface ConfirmedPenaltySummary {
  id: string
  date: string
  title: string
  amount: number
}

export interface EmployeeReviewContext {
  employeeId: string
  referenceWeekStart: string
  minimumWeeklyShifts: number
  level: EmployeeReviewLevel
  headline: string
  explanation: string
  facts: string[]
  weeks: EmployeeReviewWeek[]
  archiveUsed: boolean
  archiveAvailable: boolean
  liveWarnings?: string[]
  confirmedPenaltyCount: number
  confirmedPenaltyAmount: number
  confirmedPenalties: ConfirmedPenaltySummary[]
  disclaimer: string
}
