'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { CheckCircle2, Download, MoreVertical, RotateCw, Smartphone } from 'lucide-react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
}

const INSTALLED_KEY = 'tricandy-pwa-installed'

function isInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
}

export function InstallAppPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [mode, setMode] = useState<'hidden' | 'checking' | 'ready' | 'manual'>('hidden')
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    const isAndroid = /Android/i.test(navigator.userAgent)
    const installationRemembered = window.localStorage.getItem(INSTALLED_KEY) === 'true'
    if (!isAndroid || isInstalled() || installationRemembered) return

    setMode('checking')
    const manualFallbackTimer = window.setTimeout(() => {
      setMode((current) => current === 'checking' ? 'manual' : current)
    }, 1800)

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event as BeforeInstallPromptEvent)
      setMode('ready')
    }
    const handleInstalled = () => {
      window.localStorage.setItem(INSTALLED_KEY, 'true')
      setInstallEvent(null)
      setMode('hidden')
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    return () => {
      window.clearTimeout(manualFallbackTimer)
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  const install = async () => {
    if (!installEvent) return

    setInstalling(true)
    try {
      await installEvent.prompt()
      const choice = await installEvent.userChoice
      setInstallEvent(null)
      if (choice.outcome === 'accepted') {
        window.localStorage.setItem(INSTALLED_KEY, 'true')
        setMode('hidden')
      } else {
        setMode('manual')
      }
    } finally {
      setInstalling(false)
    }
  }

  if (mode === 'hidden') return null

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-100 px-4 py-[max(1.25rem,env(safe-area-inset-top))] dark:bg-slate-950">
      <main className="mx-auto flex min-h-[calc(100svh-2.5rem)] max-w-md items-center justify-center">
        <section className="w-full overflow-hidden rounded-[2rem] border border-indigo-100 bg-white shadow-2xl shadow-indigo-950/10 dark:border-indigo-500/20 dark:bg-slate-900">
          <div className="bg-gradient-to-br from-indigo-600 to-violet-600 px-6 py-8 text-center text-white">
            <Image
              src="/pwa-maskable-512.png"
              alt="Trí Candy"
              width={88}
              height={88}
              className="mx-auto h-22 w-22 rounded-[1.75rem] object-cover shadow-xl shadow-indigo-950/25"
              priority
            />
            <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-indigo-100">Ứng dụng nhân sự</p>
            <h1 className="mt-2 text-2xl font-black">Cài Trí Candy trước khi sử dụng</h1>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-indigo-100">
              Chỉ cài biểu tượng từ Chrome, không tải APK và không cần CH Play.
            </p>
          </div>

          <div className="p-5">
            {mode === 'checking' && (
              <div className="flex min-h-40 flex-col items-center justify-center text-center">
                <RotateCw className="h-7 w-7 animate-spin text-indigo-600" />
                <p className="mt-4 font-extrabold">Đang kiểm tra khả năng cài đặt…</p>
              </div>
            )}

            {mode === 'ready' && (
              <>
                <div className="space-y-3 text-sm">
                  <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 p-3 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
                    <CheckCircle2 className="h-5 w-5 shrink-0" />
                    <p className="font-bold">Điện thoại đã sẵn sàng cài đặt.</p>
                  </div>
                  <p className="text-center leading-6 text-muted-foreground">
                    Sau khi cài, biểu tượng Trí Candy sẽ xuất hiện ngoài màn hình điện thoại.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void install()}
                  disabled={installing}
                  className="mt-5 flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 font-extrabold text-white shadow-lg shadow-indigo-600/20 transition active:scale-[0.98] disabled:opacity-60"
                >
                  {installing ? <RotateCw className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
                  {installing ? 'Đang mở cài đặt…' : 'Cài ứng dụng'}
                </button>
              </>
            )}

            {mode === 'manual' && (
              <>
                <div className="flex items-start gap-3 rounded-2xl bg-amber-50 p-4 text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
                  <MoreVertical className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-extrabold">Cài thủ công bằng Chrome</p>
                    <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm leading-6">
                      <li>Mở đường link này bằng Google Chrome.</li>
                      <li>Nhấn menu ⋮ ở góc trên.</li>
                      <li>Chọn “Cài đặt ứng dụng”.</li>
                      <li>Mở Trí Candy từ biểu tượng ngoài màn hình.</li>
                    </ol>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 font-extrabold text-indigo-700 transition active:scale-[0.98] dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200"
                >
                  <RotateCw className="h-4 w-4" />
                  Kiểm tra lại
                </button>
              </>
            )}

            <div className="mt-5 flex items-center justify-center gap-2 text-xs font-semibold text-slate-400">
              <Smartphone className="h-4 w-4" />
              Màn hình này chỉ hiển thị trên Android chưa cài app
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
