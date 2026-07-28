'use client'

import { useEffect, useState } from 'react'
import { Bell, CalendarDays, LayoutDashboard, UserRound } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useAuth, useUserRole } from '@/lib/hooks/useAuth'
import { BottomNav } from '@/components/layout/bottom-nav'
import {
  subscribeToEmployeeNotifications,
  subscribeToManagementPendingCount,
} from '@/lib/services/notificationService'

const hiddenPrefixes = ['/auth', '/profile/setup']

export function PersistentBottomNav() {
  const pathname = usePathname()
  const { authUser, isLoading, isPreviewMode } = useAuth()
  const role = useUserRole()
  const isManagement = role === 'admin' || role === 'manager'
  const [pendingNotificationCount, setPendingNotificationCount] = useState(0)
  const hidden = hiddenPrefixes.some((prefix) => pathname.startsWith(prefix))

  useEffect(() => {
    if (!authUser) {
      setPendingNotificationCount(0)
      return
    }

    if (isPreviewMode) {
      setPendingNotificationCount(isManagement ? 5 : 1)
      return
    }

    if (isManagement) {
      return subscribeToManagementPendingCount(setPendingNotificationCount)
    }

    return subscribeToEmployeeNotifications(authUser.uid, (notifications) => {
      setPendingNotificationCount(notifications.filter((item) => !item.isRead).length)
    })
  }, [authUser, isManagement, isPreviewMode])

  if (isLoading || !authUser || hidden) return null

  return (
    <>
      <div className="h-[calc(4.5rem+env(safe-area-inset-bottom))] md:hidden" aria-hidden />
      <BottomNav items={[
        { href: '/', icon: <LayoutDashboard className="h-5 w-5" />, label: 'Trang chủ' },
        { href: '/schedule', icon: <CalendarDays className="h-5 w-5" />, label: 'Lịch làm' },
        {
          href: '/notifications',
          icon: <Bell className="h-5 w-5" />,
          label: 'Thông báo',
          badge: pendingNotificationCount > 99 ? '99+' : pendingNotificationCount,
        },
        { href: '/profile', icon: <UserRound className="h-5 w-5" />, label: 'Cá nhân' },
      ]} />
    </>
  )
}
