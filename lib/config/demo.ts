/**
 * Demo Mode Configuration
 * 
 * This file controls demo/development mode for UI review without Firebase.
 * Set DEMO_MODE = true to enable demo mode and skip authentication.
 * Set DEMO_MODE = false to use production Firebase auth.
 */

export const DEMO_MODE = false // Set to false to enable Firebase

const PREVIEW_MODE_SESSION_KEY = 'employee-portal-preview-mode'
const PREVIEW_ROLE_SESSION_KEY = 'employee-portal-preview-role'

export type PreviewRole = 'admin' | 'employee'

export function isPreviewModeEnabled(): boolean {
  if (DEMO_MODE) return true
  if (typeof window === 'undefined') return false
  return window.sessionStorage.getItem(PREVIEW_MODE_SESSION_KEY) === 'true'
}

export function getPreviewRole(): PreviewRole {
  if (typeof window === 'undefined') return 'employee'
  return window.sessionStorage.getItem(PREVIEW_ROLE_SESSION_KEY) === 'admin'
    ? 'admin'
    : 'employee'
}

export function enablePreviewMode(role: PreviewRole = 'employee'): void {
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    window.sessionStorage.setItem(PREVIEW_MODE_SESSION_KEY, 'true')
    window.sessionStorage.setItem(PREVIEW_ROLE_SESSION_KEY, role)
  }
}

export function disablePreviewMode(): void {
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(PREVIEW_MODE_SESSION_KEY)
    window.sessionStorage.removeItem(PREVIEW_ROLE_SESSION_KEY)
  }
}

export const DEMO_USER = {
  uid: 'demo-user-001',
  email: 'demo@example.com',
  displayName: 'Nguyễn Minh An',
  role: 'employee' as const,
}

export const DEMO_EMPLOYEE = {
  uid: DEMO_USER.uid,
  email: DEMO_USER.email,
  fullName: DEMO_USER.displayName,
  employeeCode: '001',
  phone: '0901 234 567',
  joinDate: new Date('2024-01-15'),
  role: DEMO_USER.role,
  status: 'active' as const,
  scheduleMode: 'rotating' as const,
}

// Feature flags for demo mode
export const DEMO_FEATURES = {
  skipAuth: DEMO_MODE,
  useMockData: DEMO_MODE,
  showSkipLoginButton: DEMO_MODE,
}
