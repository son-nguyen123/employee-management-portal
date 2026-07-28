'use client'

import { useEffect, useRef, useState } from 'react'
import { BellRing, X } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import { subscribeToForegroundMessages } from '@/lib/services/messagingService'

interface ForegroundNotice {
  title: string
  body: string
}

export function ForegroundNotificationListener() {
  const { authUser, isPreviewMode } = useAuth()
  const [notice, setNotice] = useState<ForegroundNotice | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!authUser || isPreviewMode) return

    let unsubscribe: () => void = () => undefined
    let cancelled = false

    void subscribeToForegroundMessages((payload) => {
      if (cancelled) return

      setNotice({
        title:
          payload.notification?.title ||
          payload.data?.title ||
          'Trí Candy',
        body:
          payload.notification?.body ||
          payload.data?.body ||
          payload.data?.message ||
          'Bạn có một thông báo mới.',
      })
      if (dismissTimer.current) clearTimeout(dismissTimer.current)
      dismissTimer.current = setTimeout(() => setNotice(null), 7000)
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
