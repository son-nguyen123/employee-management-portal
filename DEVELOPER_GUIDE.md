# Developer Guide - Employee Management App

This guide explains how to use the Firebase backend services in the Employee Management Application.

## Project Structure

```
lib/
├── firebase.ts                 # Firebase initialization
├── models/
│   ├── types.ts               # TypeScript interfaces for all collections
│   └── index.ts               # Model exports
├── services/
│   ├── authService.ts         # Authentication operations
│   ├── employeeService.ts     # Employee profile operations
│   ├── scheduleService.ts     # Work schedule operations
│   ├── leaveService.ts        # Leave request operations
│   ├── lateService.ts         # Late arrival request operations
│   ├── salaryService.ts       # Salary advance operations
│   ├── penaltyService.ts      # Penalty operations
│   ├── rulesService.ts        # Company rules operations
│   ├── notificationService.ts # Notification operations
│   └── index.ts               # Service exports
└── hooks/
    └── useAuth.ts             # Authentication hook
```

## Quick Start

### 1. Set Up Environment

Copy `.env.local.example` to `.env.local` and add your Firebase credentials:

```bash
cp .env.local.example .env.local
```

### 2. Wrap App with AuthProvider

In your root layout or app wrapper, add:

```tsx
'use client'

import { AuthProvider } from '@/lib/hooks/useAuth'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
```

### 3. Use Auth in Components

```tsx
'use client'

import { useAuth, useIsAdmin } from '@/lib/hooks/useAuth'

export function MyComponent() {
  const { authUser, employee, logout } = useAuth()
  const isAdmin = useIsAdmin()

  if (!authUser) {
    return <div>Please sign in</div>
  }

  return (
    <div>
      <p>Welcome, {employee?.fullName}</p>
      {isAdmin && <p>Admin Panel</p>}
      <button onClick={logout}>Logout</button>
    </div>
  )
}
```

## Using Services

### Authentication Service

```tsx
import { signIn, signUp, logOut } from '@/lib/services'

// Sign up
const user = await signUp('email@example.com', 'password123', 'Full Name')

// Sign in
const user = await signIn('email@example.com', 'password123')

// Sign out
await logOut()
```

### Employee Service

```tsx
import {
  getEmployeeByUID,
  updateEmployee,
  getActiveEmployees,
  createEmployee,
} from '@/lib/services'

// Get employee by UID
const employee = await getEmployeeByUID('uid123')

// Update employee
await updateEmployee('uid123', { fullName: 'New Name', phone: '+1234567890' })

// Get all active employees (admin only)
const employees = await getActiveEmployees()

// Create employee
await createEmployee('uid123', {
  employeeCode: 'EMP-001',
  fullName: 'John Doe',
  email: 'john@example.com',
  phone: '+1234567890',
  role: 'employee',
  status: 'active',
  joinDate: new Date(),
})
```

### Work Schedule Service

```tsx
import {
  createWorkSchedule,
  getEmployeeSchedules,
  getSchedulesByDateRange,
  updateWorkSchedule,
} from '@/lib/services'
import { Timestamp } from 'firebase/firestore'

// Create schedule
const scheduleId = await createWorkSchedule({
  employeeId: 'emp123',
  date: Timestamp.now(),
  shift: 'Morning',
  status: 'Registered',
  note: 'Regular shift',
})

// Get employee schedules
const schedules = await getEmployeeSchedules('emp123')

// Get schedules by date range
const schedules = await getSchedulesByDateRange(
  'emp123',
  new Date('2024-01-01'),
  new Date('2024-12-31')
)

// Update schedule
await updateWorkSchedule(scheduleId, { status: 'Approved' })
```

### Leave Request Service

```tsx
import {
  createLeaveRequest,
  getEmployeeLeaves,
  updateLeaveStatus,
  getPendingLeaveRequests,
} from '@/lib/services'

// Create leave request
const leaveId = await createLeaveRequest({
  employeeId: 'emp123',
  leaveDate: new Date(),
  leaveType: 'sick',
  reason: 'Medical appointment',
  status: 'Pending',
})

// Get employee leaves
const leaves = await getEmployeeLeaves('emp123')

// Get pending requests (manager/admin)
const pending = await getPendingLeaveRequests()

// Approve/reject leave
await updateLeaveStatus(leaveId, 'Approved', 'manager123')
```

### Late Arrival Service

```tsx
import {
  createLateRequest,
  getEmployeeLateRequests,
  updateLateStatus,
  getPendingLateRequests,
} from '@/lib/services'

// Create late request
const lateId = await createLateRequest({
  employeeId: 'emp123',
  workScheduleId: 'schedule123',
  date: new Date(),
  shift: 'Morning',
  lateMinutes: 15,
  reason: 'Traffic',
  status: 'Pending',
})

// Get employee late requests
const lateRequests = await getEmployeeLateRequests('emp123')

// Get pending requests (manager/admin)
const pending = await getPendingLateRequests()

// Approve/reject late request
await updateLateStatus(lateId, 'Approved', 'manager123')
```

### Salary Advance Service

```tsx
import {
  createSalaryAdvance,
  getEmployeeSalaryAdvances,
  updateSalaryAdvanceStatus,
  getPendingSalaryAdvances,
} from '@/lib/services'

// Create salary advance request
const advanceId = await createSalaryAdvance({
  employeeId: 'emp123',
  amount: 5000,
  reason: 'Emergency expense',
  status: 'Pending',
})

// Get employee salary advances
const advances = await getEmployeeSalaryAdvances('emp123')

// Get pending requests (manager/admin)
const pending = await getPendingSalaryAdvances()

// Approve/reject advance
await updateSalaryAdvanceStatus(advanceId, 'Approved', 'manager123')
```

### Penalty Service

```tsx
import {
  createPenalty,
  getEmployeePenalties,
  getEmployeeTotalPenalties,
  getPenaltiesByCategory,
} from '@/lib/services'

// Create penalty (admin/manager only)
const penaltyId = await createPenalty({
  employeeId: 'emp123',
  title: 'Late Arrival',
  description: 'Arrived 30 minutes late on 2024-01-15',
  category: 'Late',
  amount: 100,
  penaltyDate: new Date(),
  createdBy: 'manager123',
})

// Get employee penalties
const penalties = await getEmployeePenalties('emp123')

// Get total penalty amount
const total = await getEmployeeTotalPenalties('emp123')

// Get penalties by category
const lateP = await getPenaltiesByCategory('Late')
```

### Company Rules Service

```tsx
import {
  createCompanyRule,
  getActiveCompanyRules,
  updateCompanyRule,
  deleteCompanyRule,
} from '@/lib/services'

// Get active rules (employees)
const rules = await getActiveCompanyRules()

// Create rule (admin only)
const ruleId = await createCompanyRule({
  title: 'Attendance Policy',
  content: 'Employees must be on time...',
  order: 1,
  isActive: true,
})

// Update rule
await updateCompanyRule(ruleId, { content: 'Updated policy...' })

// Delete rule
await deleteCompanyRule(ruleId)
```

### Notification Service

```tsx
import {
  createNotification,
  getEmployeeNotifications,
  getUnreadNotifications,
  markNotificationAsRead,
  subscribeToEmployeeNotifications,
} from '@/lib/services'

// Create notification (admin only)
const notifId = await createNotification({
  employeeId: 'emp123',
  title: 'Request Approved',
  message: 'Your leave request has been approved',
  type: 'success',
  isRead: false,
})

// Get notifications
const notifications = await getEmployeeNotifications('emp123')

// Get unread notifications
const unread = await getUnreadNotifications('emp123')

// Mark as read
await markNotificationAsRead(notifId)

// Subscribe to real-time updates
const unsubscribe = subscribeToEmployeeNotifications('emp123', (notifications) => {
  console.log('New notifications:', notifications)
})

// Clean up subscription
unsubscribe()
```

## Using Auth Hooks

```tsx
import {
  useAuth,
  useIsAuthenticated,
  useUserRole,
  useIsAdmin,
  useIsManagerOrAdmin,
} from '@/lib/hooks/useAuth'

// Get full auth context
const { authUser, employee, isLoading, isAuthenticated, logout } = useAuth()

// Check if authenticated
const isAuth = useIsAuthenticated()

// Get user role
const role = useUserRole() // 'admin' | 'manager' | 'employee' | null

// Check if admin
const isAdmin = useIsAdmin()

// Check if manager or admin
const isManager = useIsManagerOrAdmin()
```

## Common Patterns

### Create a Form to Add Work Schedule

```tsx
'use client'

import { useState } from 'react'
import { createWorkSchedule } from '@/lib/services'
import { useAuth } from '@/lib/hooks/useAuth'
import { Timestamp } from 'firebase/firestore'

export function ScheduleForm() {
  const { authUser } = useAuth()
  const [shift, setShift] = useState('Morning')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!authUser) return

    setLoading(true)
    try {
      await createWorkSchedule({
        employeeId: authUser.uid,
        date: Timestamp.now(),
        shift: shift as 'Morning' | 'Afternoon' | 'Evening',
        status: 'Registered',
        note: '',
      })
      alert('Schedule created successfully!')
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <select value={shift} onChange={(e) => setShift(e.target.value)}>
        <option>Morning</option>
        <option>Afternoon</option>
        <option>Evening</option>
      </select>
      <button type="submit" disabled={loading}>
        {loading ? 'Creating...' : 'Create Schedule'}
      </button>
    </form>
  )
}
```

### Display Employee Data with Auth Protection

```tsx
'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useEffect, useState } from 'react'
import { getEmployeePenalties } from '@/lib/services'
import { Penalty } from '@/lib/models'

export function PenaltiesView() {
  const { authUser } = useAuth()
  const [penalties, setPenalties] = useState<Penalty[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!authUser) return

    fetchPenalties()
  }, [authUser])

  const fetchPenalties = async () => {
    try {
      const data = await getEmployeePenalties(authUser!.uid)
      setPenalties(data)
    } catch (error) {
      console.error('Error fetching penalties:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div>Loading...</div>
  if (!authUser) return <div>Not authenticated</div>

  return (
    <div>
      {penalties.map((penalty) => (
        <div key={penalty.id}>
          <h3>{penalty.title}</h3>
          <p>{penalty.description}</p>
          <p>Amount: ${penalty.amount}</p>
        </div>
      ))}
    </div>
  )
}
```

## Error Handling

All services throw errors. Always wrap service calls in try-catch:

```tsx
try {
  const result = await someServiceFunction()
} catch (error) {
  console.error('Error:', error)
  // Handle error appropriately
}
```

## Best Practices

1. **Always use TypeScript types** - Import types from `@/lib/models`
2. **Wrap components with AuthProvider** - Do this at the app root level
3. **Use hooks for auth state** - Don't query Firestore directly in components
4. **Handle loading states** - Services are async and may take time
5. **Implement error boundaries** - Catch and handle errors gracefully
6. **Test security rules** - Verify users can only access their own data
7. **Monitor Firestore costs** - Watch read/write operations
8. **Use batch operations** - For multiple related updates, batch them
9. **Cache data when appropriate** - Use React Query or SWR for caching
10. **Validate input data** - Validate before sending to Firestore

## Troubleshooting

### "Permission denied" Error
- Check Firestore security rules
- Verify user has proper role in database
- Ensure user is authenticated

### "Document not found" Error
- Verify the document ID exists
- Check if user has permission to read it
- Make sure collection name is correct

### Services not working
- Verify `.env.local` has correct Firebase credentials
- Check that Firebase services are enabled in Firebase Console
- Ensure AuthProvider is wrapping your app

## Additional Resources

- [FIREBASE_SETUP.md](./FIREBASE_SETUP.md) - Firebase configuration guide
- [Firestore Documentation](https://firebase.google.com/docs/firestore)
- [Firebase Security Rules](https://firebase.google.com/docs/rules)
