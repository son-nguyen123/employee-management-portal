import { Timestamp } from 'firebase/firestore'

// Employee Document
export interface Employee {
  uid: string
  employeeCode: string
  fullName: string
  phone: string
  photoURL?: string
  facebookUrl?: string
  bankName?: string
  bankAccountName?: string
  bankAccountNumber?: string
  email: string
  role: 'admin' | 'manager' | 'employee'
  status: 'active' | 'inactive'
  joinDate: Timestamp | Date
  createdAt: Timestamp | Date
  updatedAt: Timestamp | Date
}

// Work Schedule Document
export type ScheduleStatus =
  | 'Registered'
  | 'Draft'
  | 'Pending'
  | 'Editing'
  | 'ChangesRequested'
  | 'Approved'
  | 'Rejected'
  | 'Cancelled'

export interface WorkSchedule {
  id?: string
  employeeId: string
  date: Timestamp | Date
  shift: 'Morning' | 'Afternoon' | 'Evening'
  status: ScheduleStatus
  note: string
  reviewNote?: string
  reviewedBy?: string
  reviewedAt?: Timestamp | Date
  lockedAt?: Timestamp | Date | null
  batchKey?: string
  editPreviousStatus?: ScheduleStatus
  editingAt?: Timestamp | Date
  requiresReapproval?: boolean
  revisionCount?: number
  createdAt: Timestamp | Date
  updatedAt: Timestamp | Date
}

export type StaffRequestType = 'overtime' | 'note' | 'scheduleChange'
export type StaffRequestStatus = 'Pending' | 'Approved' | 'Rejected'

export interface StaffRequestShift {
  date: Timestamp | Date
  shift: 'Morning' | 'Afternoon' | 'Evening'
}

export interface StaffRequest {
  id?: string
  employeeId: string
  type: StaffRequestType
  content: string
  weekStart?: Timestamp | Date
  shifts?: StaffRequestShift[]
  removedShifts?: Array<StaffRequestShift & { scheduleId: string }>
  status: StaffRequestStatus
  reviewNote?: string
  reviewedBy?: string
  reviewedAt?: Timestamp | Date
  createdAt: Timestamp | Date
  updatedAt: Timestamp | Date
}

// Leave Request Document
export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled'
export type LeaveType = 'sick' | 'casual' | 'earned' | 'personal'

export interface LeaveRequest {
  id?: string
  employeeId: string
  workScheduleId?: string
  workScheduleIds?: string[]
  leaveDate: Timestamp | Date
  endDate?: Timestamp | Date
  duration?: 'short' | 'long'
  noticeClass?: 'onTime' | 'late'
  penaltyIfApproved?: number
  penaltyIfRejected?: number
  leaveType: LeaveType
  reason: string
  status: LeaveStatus
  approvedBy?: string
  reviewNote?: string
  reviewedBy?: string
  reviewedAt?: Timestamp | Date
  createdAt: Timestamp | Date
  updatedAt: Timestamp | Date
}

// Late Request Document
export type LateStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled'

export interface LateRequest {
  id?: string
  employeeId: string
  workScheduleId: string
  date: Timestamp | Date
  shift: 'Morning' | 'Afternoon' | 'Evening'
  lateMinutes: number
  reason: string
  expectedArrival?: string
  status: LateStatus
  approvedBy?: string
  reviewNote?: string
  reviewedBy?: string
  reviewedAt?: Timestamp | Date
  createdAt: Timestamp | Date
  updatedAt: Timestamp | Date
}

// Salary Advance Document
export type AdvanceStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled'

export interface SalaryAdvance {
  id?: string
  employeeId: string
  amount: number
  reason: string
  status: AdvanceStatus
  approvedBy?: string
  reviewNote?: string
  reviewedBy?: string
  reviewedAt?: Timestamp | Date
  createdAt: Timestamp | Date
  updatedAt: Timestamp | Date
}

// Penalty Document
export type PenaltyCategory = 'Late' | 'Probation' | 'Performance' | 'Other'

export interface Penalty {
  id?: string
  employeeId: string
  title: string
  description: string
  category: PenaltyCategory
  amount: number
  penaltyDate: Timestamp | Date
  createdBy: string
  sourceType?: string
  sourceId?: string
  createdAt: Timestamp | Date
  status?: 'Active' | 'Cancelled'
  originalAmount?: number
  adjustedBy?: string
  adjustedAt?: Timestamp | Date
  adjustmentReason?: string
  cancelledAmount?: number
  cancelledBy?: string
  cancelledAt?: Timestamp | Date
  cancellationReason?: string
  updatedAt?: Timestamp | Date
}

// Company Rule Document
export interface CompanyRule {
  id?: string
  title: string
  content: string
  order: number
  isActive: boolean
  createdAt: Timestamp | Date
  updatedAt: Timestamp | Date
}

// Notification Document
export type NotificationType = 'info' | 'success' | 'warning' | 'error'

export interface Notification {
  id?: string
  employeeId: string
  title: string
  message: string
  type: NotificationType
  isRead: boolean
  createdAt: Timestamp | Date
}

// Current user context
export interface AuthUser {
  uid: string
  email?: string | null
  displayName?: string | null
  photoURL?: string | null
}
