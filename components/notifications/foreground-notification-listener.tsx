'use client'

import { useEffect, useRef, useState } from 'react'
import { BellRing, X } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import {
  subscribeToForegroundMessages,
  syncPushDeviceRegistration,
} from '@/lib/services/messagingService'
import { subscribeToEmployeeNotifications } from '@/lib/services/notificationService'

interface ForegroundNotice {
  title: string
  body: string
}

export function ForegroundNotificationListener() {
  const { authUser, isPreviewMode } = useAuth()
  const [notice, setNotice] = useState<ForegroundNotice | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastNotice = useRef<{ key: string; at: number } | null>(null)

  useEffect(() => {
    if (!authUser || isPreviewMode) return

    let unsubscribe: () => void = () => undefined
    let unsubscribeFirestore: () => void = () => undefined
    let cancelled = false
    let initialized = false
    const knownNotificationIds = new Set<string>()

    const showNotice = (title: string, body: string) => {
      const key = `${title}\n${body}`
      const now = Date.now()
      // FCM and the Firestore fallback can report the same event a few seconds
      // apart on slow devices. Keep one visible toast without suppressing later events.
      if (lastNotice.current?.key === key && now - lastNotice.current.at < 30000) return
      lastNotice.current = { key, at: now }
      setNotice({ title, body })
      if (dismissTimer.current) clearTimeout(dismissTimer.current)
      dismissTimer.current = setTimeout(() => setNotice(null), 7000)
    }

    void syncPushDeviceRegistration(authUser.uid).catch((error) => {
      console.error('Không thể đồng bộ thiết bị nhận thông báo:', error)
    })

    void subscribeToForegroundMessages((payload) => {
      if (cancelled) return

      showNotice(
          payload.notification?.title ||
          payload.data?.title ||
          'Trí Candy',
          payload.notification?.body ||
          payload.data?.body ||
          payload.data?.message ||
          'Bạn có một thông báo mới.'
      )
    }).then((stopListening) => {
      if (cancelled) {
        stopListening()
        return
      }
      unsubscribe = stopListening
    })

    // Firestore is the reliable foreground fallback when the browser suppresses
    // an FCM notification while the PWA is already visible.
    unsubscribeFirestore = subscribeToEmployeeNotifications(authUser.uid, (items) => {
      if (!initialized) {
        items.forEach((item) => item.id && knownNotificationIds.add(item.id))
        initialized = true
        return
      }
      const newest = items.find((item) => item.id && !knownNotificationIds.has(item.id))
      items.forEach((item) => item.id && knownNotificationIds.add(item.id))
      if (newest && !newest.isRead) showNotice(newest.title, newest.message)
    })

    return () => {
      cancelled = true
      unsubscribe()
      unsubscribeFirestore()
      if (dismissTimer.current) clearTimeout(dismissTimer.current)
    }
  }, [authUser, isPreviewMode])

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
