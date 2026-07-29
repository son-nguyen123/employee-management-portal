'use client'

import { useEffect, useState } from 'react'
import { Download, Smartphone, X } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
}

const DISMISSED_AT_KEY = 'tricandy-install-prompt-dismissed-at'
const SHOW_AGAIN_AFTER_MS = 7 * 24 * 60 * 60 * 1000

function isInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
}

export function InstallAppPrompt() {
  const { authUser } = useAuth()
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!/Android/i.test(navigator.userAgent) || isInstalled()) return

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      const dismissedAt = Number(window.localStorage.getItem(DISMISSED_AT_KEY) || 0)
      setInstallEvent(event as BeforeInstallPromptEvent)
      setVisible(Date.now() - dismissedAt >= SHOW_AGAIN_AFTER_MS)
    }
    const handleInstalled = () => {
      setInstallEvent(null)
      setVisible(false)
      window.localStorage.removeItem(DISMISSED_AT_KEY)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  const dismiss = () => {
    window.localStorage.setItem(DISMISSED_AT_KEY, String(Date.now()))
    setVisible(false)
  }

  const install = async () => {
    if (!installEvent) return

    await installEvent.prompt()
    const choice = await installEvent.userChoice
    setInstallEvent(null)
    setVisible(false)
    if (choice.outcome === 'dismissed') {
      window.localStorage.setItem(DISMISSED_AT_KEY, String(Date.now()))
    }
  }

  if (!authUser || !visible || !installEvent) return null

  return (
    <aside
      aria-label="Cài ứng dụng Trí Candy"
      className="fixed inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-[70] mx-auto max-w-md overflow-hidden rounded-3xl border border-indigo-200 bg-white shadow-2xl shadow-indigo-950/20 dark:border-indigo-500/30 dark:bg-slate-950 md:bottom-5"
    >
      <div className="flex items-start gap-3 p-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-600/20">
          <Smartphone className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-extrabold">Cài Trí Candy</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Thêm biểu tượng vào màn hình chính để mở nhanh. Không cần CH Play.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Để sau"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-[.8fr_1.2fr] gap-2 border-t border-slate-100 p-3 dark:border-slate-800">
        <button
          type="button"
          onClick={dismiss}
          className="min-h-11 rounded-2xl font-bold text-slate-600 transition active:scale-[0.98] dark:text-slate-300"
        >
          Để sau
        </button>
        <button
          type="button"
          onClick={() => void install()}
          className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 font-extrabold text-white shadow-lg shadow-indigo-600/20 transition active:scale-[0.98]"
        >
          <Download className="h-4 w-4" />
          Cài ứng dụng
        </button>
      </div>
    </aside>
  )
}
