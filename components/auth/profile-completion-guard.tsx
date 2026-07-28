'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'

export function ProfileCompletionGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { authUser, employee, isLoading, isPreviewMode } = useAuth()
  const exempt = pathname.startsWith('/auth/') || pathname === '/profile/setup'
  const incomplete = !!authUser && !isPreviewMode && (
    !employee ||
    !employee.fullName?.trim() ||
    !employee.employeeCode?.trim() ||
    !employee.phone?.trim() ||
    !employee.photoURL?.trim() ||
    !employee.facebookUrl?.trim()
  )

  useEffect(() => {
    if (!isLoading && incomplete && !exempt) router.replace('/profile/setup')
  }, [exempt, incomplete, isLoading, router])

  if (!isLoading && incomplete && !exempt) return null
  return <>{children}</>
}
