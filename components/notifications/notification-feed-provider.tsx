'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth, useUserRole } from '@/lib/hooks/useAuth'
import {
  subscribeToEmployeeNotifications,
  subscribeToManagementPendingItems,
  type ManagementPendingItem,
} from '@/lib/services/notificationService'
import type { Notification } from '@/lib/models/types'
import { currentVietnamMonth } from '@/lib/archive/retention'
import { employeeFactoryId } from '@/lib/models/factory'
import { isRequestOverdue } from '@/lib/requests/request-timing'

type NotificationFeedValue = {
  employeeNotifications: Notification[]
  employeeNotificationsReady: boolean
  managementPendingItems: ManagementPendingItem[]
  managementPendingReady: boolean
  pendingNotificationCount: number
}

const NotificationFeedContext = createContext<NotificationFeedValue | null>(null)

export function NotificationFeedProvider({ children }: { children: React.ReactNode }) {
  const { authUser, employee: currentEmployee, isPreviewMode } = useAuth()
  const role = useUserRole()
  const isManagement = role === 'admin' || role === 'manager' || role === 'director'
  const [employeeNotifications, setEmployeeNotifications] = useState<Notification[]>([])
  const [employeeNotificationsReady, setEmployeeNotificationsReady] = useState(false)
  const [managementPendingItems, setManagementPendingItems] = useState<ManagementPendingItem[]>([])
  const [managementPendingReady, setManagementPendingReady] = useState(false)
  const [pendingNotificationCount, setPendingNotificationCount] = useState(0)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    if (!isManagement || isPreviewMode) return
    const interval = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(interval)
  }, [isManagement, isPreviewMode])

  useEffect(() => {
    setEmployeeNotifications([])
    setEmployeeNotificationsReady(false)
    setManagementPendingItems([])
    setManagementPendingReady(false)
    setPendingNotificationCount(isPreviewMode ? (role === 'director' ? 0 : isManagement ? 5 : 1) : 0)

    if (!authUser || isPreviewMode) return

    const notificationWindow = currentVietnamMonth(new Date())
    const unsubscribeEmployee = subscribeToEmployeeNotifications(
      authUser.uid,
      (notifications) => {
        setEmployeeNotifications(notifications)
        setEmployeeNotificationsReady(true)
      },
      () => setEmployeeNotificationsReady(true),
      { startDate: notificationWindow.start, endDate: notificationWindow.end },
    )

    const unsubscribeManagement = isManagement && role !== 'director'
      ? subscribeToManagementPendingItems(
        (items) => {
          setManagementPendingItems(items)
          setManagementPendingReady(true)
          const start = new Date()
          start.setDate(start.getDate() - 5)
          start.setHours(0, 0, 0, 0)
          setPendingNotificationCount(items.filter((item) => item.createdAt >= start && (role === 'admin' || item.type !== 'account')).length)
        },
        () => setManagementPendingReady(true),
        employeeFactoryId(currentEmployee),
      )
      : () => undefined

    return () => {
      unsubscribeEmployee()
      unsubscribeManagement()
    }
  }, [authUser?.uid, currentEmployee, isManagement, isPreviewMode, role])

  useEffect(() => {
    if (!isManagement || isPreviewMode || role === 'director') return
    const start = new Date(now)
    start.setDate(start.getDate() - 5)
    start.setHours(0, 0, 0, 0)
    setPendingNotificationCount(managementPendingItems.filter((item) => {
      const recent = item.createdAt >= start
      return (recent || isRequestOverdue(item, now)) && (role === 'admin' || item.type !== 'account')
    }).length)
  }, [isManagement, isPreviewMode, managementPendingItems, now, role])

  const value = useMemo<NotificationFeedValue>(() => ({
    employeeNotifications,
    employeeNotificationsReady,
    managementPendingItems,
    managementPendingReady,
    pendingNotificationCount: isManagement ? pendingNotificationCount : employeeNotifications.filter((item) => {
      const createdAt = item.createdAt instanceof Date ? item.createdAt : item.createdAt.toDate()
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      return !item.isRead && createdAt >= monthStart && createdAt < monthEnd
    }).length,
  }), [employeeNotifications, employeeNotificationsReady, isManagement, managementPendingItems, managementPendingReady, pendingNotificationCount])

  return <NotificationFeedContext.Provider value={value}>{children}</NotificationFeedContext.Provider>
}

export function useNotificationFeed(): NotificationFeedValue {
  const value = useContext(NotificationFeedContext)
  if (!value) throw new Error('useNotificationFeed must be used inside NotificationFeedProvider')
  return value
}
