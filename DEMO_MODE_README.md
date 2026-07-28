# Demo Mode - Frontend UI Review

This app now includes a **Demo Mode** that allows you to review all frontend pages and UI without Firebase authentication or database connections.

## Quick Start

The demo mode is **enabled by default**. Simply navigate to any page and all features will work with mock data.

### Enter Demo Mode

1. Navigate to `http://localhost:3000/` - The home page loads immediately with demo data
2. Or visit any page directly (schedule, leave-request, late-arrival, etc.)
3. A **Skip Login** FAB button appears on auth pages for quick access to the dashboard

## What's Included in Demo Mode

All pages are fully functional with realistic mock data:

- **Home Dashboard** - Shows upcoming schedules, notifications, and quick access to all features
- **Work Schedule** - View 3 mock upcoming shifts with statuses
- **Leave Requests** - Submit leave forms (locally) with 3 previous request examples
- **Late Arrival** - Submit late arrival requests with history
- **Salary Advance** - Request advances with 3 previous request examples
- **Penalties** - View penalty records and history
- **Rules** - Browse company rules and guidelines
- **Notifications** - View 4 mock notifications
- **Profile** - View employee profile data

## Feature Flag Control

Demo mode is controlled via a feature flag in `/lib/config/demo.ts`:

```typescript
export const DEMO_MODE = true // Set to false to enable Firebase
```

### To Re-enable Firebase:

1. Open `/lib/config/demo.ts`
2. Change `DEMO_MODE = false`
3. The app will now require Firebase authentication
4. All existing auth and database code remains intact and active

## Mock Data Structure

Mock data is organized in `/lib/services/mockData.ts` and includes:

- **mockSchedules** - 3 work shifts with dates and statuses
- **mockLeaveRequests** - 3 leave requests (approved, approved, pending)
- **mockLateRequests** - 2 late arrival requests
- **mockSalaryAdvances** - 3 salary advance requests
- **mockPenalties** - 3 penalty records
- **mockNotifications** - 4 unread/read notifications
- **mockCompanyRules** - 6 company rules

All mock data uses the demo user:
- **Email**: demo@example.com
- **Name**: John Demo
- **Employee Code**: EMP-2024-001

## Key Files Modified

1. **`lib/config/demo.ts`** - Demo mode configuration and feature flags
2. **`lib/hooks/useAuth.ts`** - Modified to support demo mode authentication
3. **`lib/services/mockData.ts`** - All mock data for demo pages
4. **`components/demo/skip-login-fab.tsx`** - Skip login button component
5. **`app/layout.tsx`** - Added SkipLoginFAB to layout
6. **Pages Updated** - All data-loading pages now check for demo mode:
   - `app/page.tsx` (home)
   - `app/schedule/page.tsx`
   - `app/leave-request/page.tsx`
   - `app/late-arrival/page.tsx`
   - `app/salary-advance/page.tsx`

## Firebase Code Remains Intact

All Firebase integration code remains functional:
- Auth service functions are unchanged
- Database queries are ready to use
- Simply switch `DEMO_MODE = false` to activate

## Development Notes

- Mock data uses realistic dates and times
- All notifications and requests show appropriate statuses (Approved, Pending, etc.)
- Form submissions work locally but don't save to a real database in demo mode
- Theme provider and UI components all render correctly
- Mock data updates in AuthProvider on app load

## Next Steps When Ready

1. When Firebase is connected and working:
   - Set `DEMO_MODE = false` in `/lib/config/demo.ts`
   - Users will be directed to login
   - Real data will flow from Firestore

2. The SkipLoginFAB button will automatically hide when demo mode is disabled
