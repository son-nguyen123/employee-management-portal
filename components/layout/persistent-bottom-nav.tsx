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
import { syncAppIconBadge } from '@/lib/services/messagingService'

const hiddenPrefixes = ['/auth', '/profile/setup']

export function PersistentBottomNav() {
  const pathname = usePathname()
  const { authUser, employee, isLoading, isPreviewMode } = useAuth()
  const role = useUserRole()
  const isManagement = role === 'admin' || role === 'manager'
  const [pendingNotificationCount, setPendingNotificationCount] = useState(0)
  const hidden = hiddenPrefixes.some((prefix) => pathname.startsWith(prefix))
  const showNavigation = !isLoading && !!authUser && !hidden && !(employee?.role === 'employee' && employee.status !== 'active')

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
      let pendingCount = 0
      let unreadCount = 0
      const recentStart = new Date()
      recentStart.setDate(recentStart.getDate() - 5)
      recentStart.setHours(0, 0, 0, 0)
      const publish = () => setPendingNotificationCount(pendingCount + unreadCount)
      const unsubscribePending = subscribeToManagementPendingCount((count) => {
        pendingCount = count
        publish()
      }, role === 'admin')
      const unsubscribeNotifications = subscribeToEmployeeNotifications(authUser.uid, (notifications) => {
        unreadCount = notifications.filter((item) => {
          const createdAt = item.createdAt instanceof Date ? item.createdAt : item.createdAt.toDate()
          return !item.isRead && createdAt >= recentStart
        }).length
        publish()
      })
      return () => {
        unsubscribePending()
        unsubscribeNotifications()
      }
    }

    return subscribeToEmployeeNotifications(authUser.uid, (notifications) => {
      const recentStart = new Date()
      recentStart.setDate(recentStart.getDate() - 5)
      recentStart.setHours(0, 0, 0, 0)
      setPendingNotificationCount(notifications.filter((item) => {
        const createdAt = item.createdAt instanceof Date ? item.createdAt : item.createdAt.toDate()
        return !item.isRead && createdAt >= recentStart
      }).length)
    })
  }, [authUser, isManagement, isPreviewMode, role])

  useEffect(() => {
    if (isPreviewMode) return
    void syncAppIconBadge(authUser ? pendingNotificationCount : 0)
  }, [authUser, isPreviewMode, pendingNotificationCount])

  useEffect(() => {
    document.body.classList.toggle('has-app-navigation', showNavigation)
    return () => document.body.classList.remove('has-app-navigation')
  }, [showNavigation])

  if (!showNavigation) return null

  return (
    <>
      <div className="h-[calc(4.5rem+env(safe-area-inset-bottom))] md:h-28 xl:hidden" aria-hidden />
      <BottomNav items={[
        { href: '/', icon: <LayoutDashboard className="h-5 w-5" />, label: 'Trang chủ' },
        isManagement
          ? { href: '/admin/dashboard', icon: <LayoutDashboard className="h-5 w-5" />, label: 'Điều hành' }
          : { href: '/schedule', icon: <CalendarDays className="h-5 w-5" />, label: 'Lịch làm' },
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
