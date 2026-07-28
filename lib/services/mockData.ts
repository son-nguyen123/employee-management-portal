import { DEMO_USER, DEMO_EMPLOYEE } from '@/lib/config/demo'

export const mockSchedules = [
  {
    id: 'sched-001',
    employeeId: DEMO_USER.uid,
    date: new Date(new Date().getTime() + 86400000),
    shift: 'Morning' as const,
    status: 'Registered' as const,
    note: '',
  },
  {
    id: 'sched-002',
    employeeId: DEMO_USER.uid,
    date: new Date(new Date().getTime() + 172800000),
    shift: 'Afternoon' as const,
    status: 'Approved' as const,
    note: 'Confirmed',
  },
  {
    id: 'sched-003',
    employeeId: DEMO_USER.uid,
    date: new Date(new Date().getTime() + 259200000),
    shift: 'Evening' as const,
    status: 'Registered' as const,
    note: '',
  },
]

export const mockLeaveRequests = [
  {
    id: 'leave-001',
    employeeId: DEMO_USER.uid,
    leaveType: 'casual' as const,
    leaveDate: new Date(new Date().getTime() - 2592000000),
    reason: 'Family vacation',
    status: 'Approved' as const,
    createdAt: new Date(new Date().getTime() - 2592000000),
  },
  {
    id: 'leave-002',
    employeeId: DEMO_USER.uid,
    leaveType: 'sick' as const,
    leaveDate: new Date(new Date().getTime() - 864000000),
    reason: 'Medical appointment',
    status: 'Approved' as const,
    createdAt: new Date(new Date().getTime() - 864000000),
  },
  {
    id: 'leave-003',
    employeeId: DEMO_USER.uid,
    leaveType: 'personal' as const,
    leaveDate: new Date(),
    reason: 'Personal matter',
    status: 'Pending' as const,
    createdAt: new Date(),
  },
]

export const mockLateRequests = [
  {
    id: 'late-001',
    employeeId: DEMO_USER.uid,
    shift: 'Morning' as const,
    lateMinutes: 15,
    reason: 'Traffic',
    status: 'Approved' as const,
    date: new Date(new Date().getTime() - 1728000000),
  },
  {
    id: 'late-002',
    employeeId: DEMO_USER.uid,
    shift: 'Afternoon' as const,
    lateMinutes: 10,
    reason: 'Car issue',
    status: 'Pending' as const,
    date: new Date(),
  },
]

export const mockSalaryAdvances = [
  {
    id: 'salary-001',
    employeeId: DEMO_USER.uid,
    amount: 5000,
    reason: 'Emergency expense',
    status: 'Approved' as const,
    createdAt: new Date(new Date().getTime() - 5184000000),
  },
  {
    id: 'salary-002',
    employeeId: DEMO_USER.uid,
    amount: 3000,
    reason: 'Holiday shopping',
    status: 'Approved' as const,
    createdAt: new Date(new Date().getTime() - 2592000000),
  },
  {
    id: 'salary-003',
    employeeId: DEMO_USER.uid,
    amount: 2000,
    reason: 'Medical bills',
    status: 'Pending' as const,
    createdAt: new Date(),
  },
]

export const mockPenalties = [
  {
    id: 'penalty-001',
    employeeId: DEMO_USER.uid,
    type: 'Late' as const,
    amount: 500,
    description: 'Late arrival by 30 minutes',
    date: new Date(new Date().getTime() - 7776000000),
    status: 'Processed' as const,
  },
  {
    id: 'penalty-002',
    employeeId: DEMO_USER.uid,
    type: 'Unauthorized Leave' as const,
    amount: 1500,
    description: 'Absence without notice on 2024-06-15',
    date: new Date(new Date().getTime() - 2592000000),
    status: 'Processed' as const,
  },
  {
    id: 'penalty-003',
    employeeId: DEMO_USER.uid,
    type: 'Dress Code' as const,
    amount: 250,
    description: 'Violation of company dress code',
    date: new Date(new Date().getTime() - 864000000),
    status: 'Processed' as const,
  },
]

export const mockNotifications = [
  {
    id: 'notif-001',
    employeeId: DEMO_USER.uid,
    title: 'Leave Request Approved',
    message: 'Your casual leave request for 2024-07-20 has been approved.',
    type: 'leave' as const,
    isRead: false,
    createdAt: new Date(),
  },
  {
    id: 'notif-002',
    employeeId: DEMO_USER.uid,
    title: 'Salary Advance Pending',
    message: 'Your salary advance request for 2000 is pending approval.',
    type: 'salary' as const,
    isRead: false,
    createdAt: new Date(new Date().getTime() - 3600000),
  },
  {
    id: 'notif-003',
    employeeId: DEMO_USER.uid,
    title: 'New Penalty Applied',
    message: 'A dress code violation penalty of 250 has been applied.',
    type: 'penalty' as const,
    isRead: true,
    createdAt: new Date(new Date().getTime() - 86400000),
  },
  {
    id: 'notif-004',
    employeeId: DEMO_USER.uid,
    title: 'Shift Confirmed',
    message: 'Your work schedule shift for morning has been confirmed.',
    type: 'schedule' as const,
    isRead: true,
    createdAt: new Date(new Date().getTime() - 172800000),
  },
]

export const mockCompanyRules = [
  {
    id: 'rule-001',
    title: 'Punctuality',
    description: 'Employees must arrive by the scheduled start time. Late arrivals will incur penalties.',
    active: true,
  },
  {
    id: 'rule-002',
    title: 'Professional Conduct',
    description: 'Maintain professional behavior at all times. Respect colleagues and follow company policies.',
    active: true,
  },
  {
    id: 'rule-003',
    title: 'Dress Code',
    description: 'Business casual attire is required. No jeans, t-shirts, or casual wear.',
    active: true,
  },
  {
    id: 'rule-004',
    title: 'Communication',
    description: 'All company communications must be professional and respectful. No harassment will be tolerated.',
    active: true,
  },
  {
    id: 'rule-005',
    title: 'Data Security',
    description: 'Protect company data and client information. No sharing of confidential information.',
    active: true,
  },
  {
    id: 'rule-006',
    title: 'Equipment Care',
    description: 'Company equipment must be handled with care. Report any damage immediately.',
    active: true,
  },
]
