# lib - Firebase Backend Services

This directory contains all Firebase-related code and utilities for the Employee Management Application.

## Directory Structure

```
lib/
├── firebase.ts              # Firebase initialization
├── models/
│   ├── types.ts            # TypeScript interfaces for Firestore documents
│   └── index.ts            # Type exports
├── services/
│   ├── authService.ts      # Firebase Authentication
│   ├── employeeService.ts  # Employee management
│   ├── scheduleService.ts  # Work schedule management
│   ├── leaveService.ts     # Leave request management
│   ├── lateService.ts      # Late arrival request management
│   ├── salaryService.ts    # Salary advance management
│   ├── penaltyService.ts   # Penalty management
│   ├── rulesService.ts     # Company rules management
│   ├── notificationService.ts # Notifications
│   └── index.ts            # Service exports
├── hooks/
│   └── useAuth.ts          # Authentication context and hooks
├── utils.ts                # Utility functions (pre-existing)
└── README.md               # This file
```

## Quick Import Guide

### Import Firebase Initialization
```tsx
import { auth, db, storage } from '@/lib/firebase'
```

### Import Types
```tsx
import type {
  Employee,
  WorkSchedule,
  LeaveRequest,
  LateRequest,
  SalaryAdvance,
  Penalty,
  CompanyRule,
  Notification,
  AuthUser,
} from '@/lib/models'
```

### Import Services
```tsx
// Import all services
import {
  signIn,
  getEmployeeByUID,
  createWorkSchedule,
  getEmployeeLeaves,
  // ... etc
} from '@/lib/services'

// Or import specific service
import { signIn, logOut } from '@/lib/services/authService'
```

### Import Hooks
```tsx
import {
  useAuth,
  useIsAuthenticated,
  useUserRole,
  useIsAdmin,
  useIsManagerOrAdmin,
} from '@/lib/hooks/useAuth'
```

## Firebase Configuration

Firebase initialization happens in `firebase.ts`:

```typescript
const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
```

Environment variables are loaded from `.env.local`:
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

## Services Overview

### Authentication Service
Handles user authentication operations:
- `signUp()` - Create new user account
- `signIn()` - Sign in user
- `logOut()` - Sign out user
- `getCurrentUser()` - Get current user
- `subscribeToAuthState()` - Listen to auth changes
- `updateUserProfile()` - Update user profile
- `getUserIdToken()` - Get ID token

### Employee Service
Manages employee profiles:
- `getEmployeeByUID()` - Get employee data
- `createEmployee()` - Create employee profile
- `updateEmployee()` - Update employee data
- `getAllEmployees()` - List all employees (admin)
- `getActiveEmployees()` - List active employees

### Schedule Service
Manages work schedules:
- `createWorkSchedule()` - Add schedule
- `getEmployeeSchedules()` - Get employee schedules
- `getSchedulesByDateRange()` - Filter by date
- `updateWorkSchedule()` - Update schedule
- `deleteWorkSchedule()` - Remove schedule
- `getAllSchedules()` - Get all schedules (admin)

### Leave Service
Manages leave requests:
- `createLeaveRequest()` - Submit leave request
- `getEmployeeLeaves()` - Get leave requests
- `getPendingLeaveRequests()` - Get pending (manager)
- `updateLeaveStatus()` - Approve/reject leave
- `getAllLeaveRequests()` - Get all (admin)

### Late Service
Manages late arrival requests:
- `createLateRequest()` - Request late arrival
- `getEmployeeLateRequests()` - Get requests
- `getPendingLateRequests()` - Get pending (manager)
- `updateLateStatus()` - Approve/reject
- `getAllLateRequests()` - Get all (admin)

### Salary Service
Manages salary advance requests:
- `createSalaryAdvance()` - Request advance
- `getEmployeeSalaryAdvances()` - Get requests
- `getPendingSalaryAdvances()` - Get pending (manager)
- `updateSalaryAdvanceStatus()` - Approve/reject
- `getAllSalaryAdvances()` - Get all (admin)

### Penalty Service
Manages penalties:
- `createPenalty()` - Create penalty (admin)
- `getEmployeePenalties()` - Get employee penalties
- `getPenaltiesByCategory()` - Filter by category
- `getAllPenalties()` - Get all (admin)
- `getEmployeeTotalPenalties()` - Sum total

### Rules Service
Manages company rules:
- `createCompanyRule()` - Create rule (admin)
- `getActiveCompanyRules()` - Get active rules
- `getAllCompanyRules()` - Get all (admin)
- `updateCompanyRule()` - Update rule (admin)
- `deleteCompanyRule()` - Delete rule (admin)

### Notification Service
Manages notifications:
- `createNotification()` - Send notification
- `getEmployeeNotifications()` - Get notifications
- `getUnreadNotifications()` - Get unread
- `markNotificationAsRead()` - Mark as read
- `markAllNotificationsAsRead()` - Mark all as read
- `deleteNotification()` - Delete notification
- `subscribeToEmployeeNotifications()` - Real-time listener
- `getUnreadNotificationCount()` - Count unread

## Type System

All collections have corresponding TypeScript interfaces defined in `models/types.ts`:

```typescript
interface Employee {
  uid: string
  employeeCode: string
  fullName: string
  phone: string
  email: string
  role: 'admin' | 'manager' | 'employee'
  status: 'active' | 'inactive'
  joinDate: Timestamp | Date
  createdAt: Timestamp | Date
  updatedAt: Timestamp | Date
}

interface WorkSchedule {
  id?: string
  employeeId: string
  date: Timestamp | Date
  shift: 'Morning' | 'Afternoon' | 'Evening'
  status: 'Registered' | 'Approved' | 'Rejected'
  note: string
  createdAt: Timestamp | Date
  updatedAt: Timestamp | Date
}

// ... and more
```

## Authentication Context & Hooks

The `useAuth.ts` file provides React Context and custom hooks:

### AuthProvider
Wrap your app root with AuthProvider:
```tsx
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

### Custom Hooks
Use in any client component:
```tsx
// Get full context
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

## Usage Examples

### Create Schedule
```tsx
import { createWorkSchedule } from '@/lib/services'
import { useAuth } from '@/lib/hooks/useAuth'
import { Timestamp } from 'firebase/firestore'

const { authUser } = useAuth()

const scheduleId = await createWorkSchedule({
  employeeId: authUser.uid,
  date: Timestamp.now(),
  shift: 'Morning',
  status: 'Registered',
  note: 'Regular shift',
})
```

### Get Employee Data
```tsx
import { getEmployeePenalties } from '@/lib/services'

const penalties = await getEmployeePenalties('emp123')
penalties.forEach(p => console.log(p.title))
```

### Listen to Notifications
```tsx
import { subscribeToEmployeeNotifications } from '@/lib/services'

const unsubscribe = subscribeToEmployeeNotifications('emp123', (notifications) => {
  console.log('New notifications:', notifications)
})

// Later, cleanup
unsubscribe()
```

## Error Handling

All services throw errors on failure. Always use try-catch:

```tsx
try {
  const result = await getEmployeeByUID('uid123')
} catch (error) {
  console.error('Failed to get employee:', error)
  // Handle error
}
```

## Common Patterns

### Protected Component
```tsx
'use client'

import { useAuth } from '@/lib/hooks/useAuth'

export function ProtectedComponent() {
  const { authUser, isLoading } = useAuth()

  if (isLoading) return <div>Loading...</div>
  if (!authUser) return <div>Not authorized</div>

  return <div>Protected content</div>
}
```

### Role-Based Component
```tsx
'use client'

import { useIsAdmin } from '@/lib/hooks/useAuth'

export function AdminPanel() {
  const isAdmin = useIsAdmin()

  if (!isAdmin) return null

  return <div>Admin controls</div>
}
```

### Data Fetching Component
```tsx
'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { getEmployeePenalties } from '@/lib/services'
import { useEffect, useState } from 'react'

export function PenaltiesList() {
  const { authUser } = useAuth()
  const [penalties, setPenalties] = useState([])

  useEffect(() => {
    if (!authUser) return

    const loadPenalties = async () => {
      try {
        const data = await getEmployeePenalties(authUser.uid)
        setPenalties(data)
      } catch (error) {
        console.error('Error:', error)
      }
    }

    loadPenalties()
  }, [authUser])

  return (
    <ul>
      {penalties.map(p => (
        <li key={p.id}>{p.title}</li>
      ))}
    </ul>
  )
}
```

## Best Practices

1. **Use TypeScript** - Import types for type safety
2. **Error Handling** - Always use try-catch for async operations
3. **Loading States** - Show loading indicators while fetching
4. **Cleanup** - Unsubscribe from listeners on component unmount
5. **Performance** - Cache data with React Query or SWR
6. **Security** - Respect user roles and permissions
7. **Validation** - Validate input before sending to Firestore
8. **Timestamps** - Use `Timestamp.now()` for server timestamps
9. **Batch Operations** - Batch related updates together
10. **Real-time** - Use listeners for live data updates

## Troubleshooting

### "Module not found"
- Ensure imports use `@/lib/` prefix
- Check file paths are correct
- Verify `tsconfig.json` path alias

### "Permission denied"
- Check Firestore security rules
- Verify user role in database
- Ensure user is authenticated

### Services not initializing
- Check `.env.local` has Firebase credentials
- Verify Firebase services enabled
- Check browser console for errors

## Related Documentation

- **FIREBASE_SETUP.md** - Firebase configuration
- **DEVELOPER_GUIDE.md** - Usage examples
- **IMPLEMENTATION_SUMMARY.md** - Architecture overview
- **QUICK_START.md** - Quick setup guide

## Security

All Firebase operations are protected by Firestore security rules defined in `firestore.rules`. Rules enforce:
- Role-based access control (admin, manager, employee)
- Document-level security
- User data privacy
- Request validation

See `firestore.rules` for complete rule definitions.

---

All services are fully typed with TypeScript and follow Firebase best practices.
