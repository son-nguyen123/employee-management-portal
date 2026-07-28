'use client'

import React, { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, useUserRole } from '@/lib/hooks/useAuth'
import { SkeletonLoader } from '../ui/skeleton-loader'

interface ProtectedRouteProps {
  children: React.ReactNode
  requiredRole?: 'admin' | 'employee' | 'manager'
}

export function ProtectedRoute({
  children,
  requiredRole,
}: ProtectedRouteProps) {
  const router = useRouter()
  const { authUser, isLoading } = useAuth()
  const userRole = useUserRole()

  useEffect(() => {
    if (!isLoading && !authUser) {
      router.push('/auth/login')
    }
    if (!isLoading && authUser && requiredRole && userRole !== requiredRole) {
      router.push('/')
    }
  }, [authUser, isLoading, userRole, requiredRole, router])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <SkeletonLoader variant="card" />
      </div>
    )
  }

  if (!authUser) {
    return null
  }

  if (requiredRole && userRole !== requiredRole) {
    return null
  }

  return <>{children}</>
}
