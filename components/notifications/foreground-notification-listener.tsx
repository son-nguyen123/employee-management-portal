'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BellRing, X } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import {
  showForegroundSystemNotification,
  subscribeToForegroundMessages,
  syncPushDeviceRegistration,
} from '@/lib/services/messagingService'
import { useNotificationFeed } from '@/components/notifications/notification-feed-provider'

interface ForegroundNotice {
  title: string
  body: string
}

export function ForegroundNotificationListener() {
  const { authUser, isPreviewMode } = useAuth()
  const { employeeNotifications, employeeNotificationsReady } = useNotificationFeed()
  const [notice, setNotice] = useState<ForegroundNotice | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastNotice = useRef<{ key: string; at: number } | null>(null)
  const knownNotificationIds = useRef<Set<string>>(new Set())
  const notificationFeedInitialized = useRef(false)

  const showNotice = useCallback((title: string, body: string) => {
    const key = `${title}\n${body}`
    const now = Date.now()
    if (lastNotice.current?.key === key && now - lastNotice.current.at < 30000) return false
    lastNotice.current = { key, at: now }
    setNotice({ title, body })
    if (dismissTimer.current) clearTimeout(dismissTimer.current)
    dismissTimer.current = setTimeout(() => setNotice(null), 7000)
    return true
  }, [])

  useEffect(() => {
    if (!authUser || isPreviewMode) return

    let cancelled = false
    let unsubscribe: () => void = () => undefined

    void syncPushDeviceRegistration(authUser.uid).catch((error) => {
      console.error('Không thể đồng bộ thiết bị nhận thông báo:', error)
    })

    void subscribeToForegroundMessages((payload) => {
      if (cancelled) return

      const title = payload.notification?.title || payload.data?.title || 'Trí Candy'
      const body = payload.notification?.body || payload.data?.body || payload.data?.message || 'Bạn có một thông báo mới.'

      if (showNotice(title, body)) {
        const source = payload.data?.source || 'push'
        const sourceId = payload.data?.sourceId || `${Date.now()}`
        const status = payload.data?.status || 'new'
        void showForegroundSystemNotification({
          title,
          body,
          link: payload.data?.link || '/notifications',
          tag: `${source}:${sourceId}:${status}`,
        })
      }
    }).then((stopListening) => {
      if (cancelled) {
        stopListening()
        return
      }
      unsubscribe = stopListening
    })

    return () => {
      cancelled = true
      unsubscribe()
      if (dismissTimer.current) clearTimeout(dismissTimer.current)
    }
  }, [authUser?.uid, isPreviewMode, showNotice])

  // Reuse the single Firestore notification listener owned by the provider as
  // the foreground fallback. This avoids a second identical onSnapshot query.
  useEffect(() => {
    if (!authUser || isPreviewMode || !employeeNotificationsReady) {
      knownNotificationIds.current.clear()
      notificationFeedInitialized.current = false
      return
    }

    if (!notificationFeedInitialized.current) {
      employeeNotifications.forEach((item) => item.id && knownNotificationIds.current.add(item.id))
      notificationFeedInitialized.current = true
      return
    }

    const newest = employeeNotifications
      .filter((item) => item.id && !knownNotificationIds.current.has(item.id))
      .sort((left, right) => {
        const leftDate = left.createdAt instanceof Date ? left.createdAt : left.createdAt.toDate()
        const rightDate = right.createdAt instanceof Date ? right.createdAt : right.createdAt.toDate()
        return rightDate.getTime() - leftDate.getTime()
      })
      .find((item) => !item.isRead)

    employeeNotifications.forEach((item) => item.id && knownNotificationIds.current.add(item.id))
    if (newest && showNotice(newest.title, newest.message)) {
      void showForegroundSystemNotification({
        title: newest.title,
        body: newest.message,
        link: '/notifications',
        tag: `notification:${newest.id}`,
      })
    }
  }, [authUser?.uid, employeeNotifications, employeeNotificationsReady, isPreviewMode, showNotice])

  if (!notice) return null

  return (
    <aside
      aria-live="polite"
      className="fixed inset-x-3 top-3 z-[80] mx-auto flex max-w-md items-start gap-3 rounded-2xl border border-indigo-200 bg-white p-4 shadow-2xl dark:border-indigo-900 dark:bg-slate-950"
    >
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white">
        <BellRing className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-extrabold">{notice.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{notice.body}</p>
      </div>
      <button
        type="button"
        aria-label="Đóng thông báo"
        onClick={() => setNotice(null)}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        <X className="h-4 w-4" />
      </button>
    </aside>
  )
}
