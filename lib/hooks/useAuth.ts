'use client'

import React, { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react'
import { User } from 'firebase/auth'
import { subscribeToAuthState, convertFirebaseUserToAuthUser, logOut } from '@/lib/services/authService'
import { getEmployeeByUID, subscribeToEmployeeByUID } from '@/lib/services/employeeService'
import { AuthUser, Employee } from '@/lib/models/types'
import {
  DEMO_MODE,
  DEMO_USER,
  DEMO_EMPLOYEE,
  disablePreviewMode,
  getPreviewRole,
  isPreviewModeEnabled,
} from '@/lib/config/demo'

interface AuthContextType {
  authUser: AuthUser | null
  employee: Employee | null
  isLoading: boolean
  isAuthenticated: boolean
  isPreviewMode: boolean
  refreshEmployee: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

/**
 * AuthProvider component - Wrap your app with this
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [demoMode, setDemoMode] = useState(DEMO_MODE)

  useEffect(() => {
    const previewModeEnabled = isPreviewModeEnabled()
    if (previewModeEnabled !== demoMode) {
      setDemoMode(previewModeEnabled)
      return
    }

    // Demo mode - use mock data
    if (demoMode) {
      const previewRole = getPreviewRole()
      const mockAuthUser: AuthUser = {
        uid: previewRole === 'admin' ? 'demo-admin-001' : DEMO_USER.uid,
        email: previewRole === 'admin' ? 'admin@example.com' : DEMO_USER.email,
        displayName: previewRole === 'admin' ? 'Quản lý Minh Sơn' : DEMO_USER.displayName,
      }
      setAuthUser(mockAuthUser)
      setEmployee({
        ...DEMO_EMPLOYEE,
        uid: mockAuthUser.uid,
        email: mockAuthUser.email,
        fullName: mockAuthUser.displayName,
        employeeCode: previewRole === 'admin' ? 'QL-001' : DEMO_EMPLOYEE.employeeCode,
        role: previewRole,
      } as Employee)
      setIsLoading(false)
      return
    }

    // Production mode - Subscribe to Firebase auth state changes
    let unsubscribeEmployee: undefined | (() => void)
    const unsubscribe = subscribeToAuthState((firebaseUser: User | null) => {
      setIsLoading(true)
      unsubscribeEmployee?.()
      unsubscribeEmployee = undefined

      if (firebaseUser) {
        const authUserData = convertFirebaseUserToAuthUser(firebaseUser)
        setAuthUser(authUserData)
        unsubscribeEmployee = subscribeToEmployeeByUID(
          firebaseUser.uid,
          (employeeData) => {
            setEmployee(employeeData)
            setIsLoading(false)
          },
          (error) => {
            console.error('Error subscribing to employee data:', error)
            setEmployee(null)
            setIsLoading(false)
          }
        )
      } else {
        setAuthUser(null)
        setEmployee(null)
        setIsLoading(false)
      }
    })

    // Cleanup subscription on unmount
    return () => {
      unsubscribeEmployee?.()
      unsubscribe()
    }
  }, [demoMode])

  const handleLogout = async () => {
    try {
      if (demoMode) {
        disablePreviewMode()
        setDemoMode(false)
        setAuthUser(null)
        setEmployee(null)
        return
      }
      
      await logOut()
      setAuthUser(null)
      setEmployee(null)
    } catch (error) {
      console.error('Error logging out:', error)
      throw error
    }
  }

  const refreshEmployee = useCallback(async () => {
    if (!authUser || demoMode) return
    setEmployee(await getEmployeeByUID(authUser.uid))
  }, [authUser, demoMode])

  const value: AuthContextType = {
    authUser,
    employee,
    isLoading,
    isAuthenticated: !!authUser,
    isPreviewMode: demoMode,
    refreshEmployee,
    logout: handleLogout,
  }

  return React.createElement(AuthContext.Provider, { value }, children)
}

/**
 * Custom hook to use auth context
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

/**
 * Custom hook to check if user is authenticated
 */
export function useIsAuthenticated(): boolean {
  const { isAuthenticated } = useAuth()
  return isAuthenticated
}

/**
 * Custom hook to get current employee role
 */
export function useUserRole(): 'admin' | 'manager' | 'employee' | null {
  const { employee } = useAuth()
  return employee?.role || null
}

/**
 * Custom hook to check if user has admin role
 */
export function useIsAdmin(): boolean {
  const role = useUserRole()
  return role === 'admin'
}

/**
 * Custom hook to check if user is manager or admin
 */
export function useIsManagerOrAdmin(): boolean {
  const role = useUserRole()
  return role === 'manager' || role === 'admin'
}
