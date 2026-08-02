'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  BellRing,
  CheckCircle2,
  LoaderCircle,
  RotateCw,
  Settings,
  Smartphone,
  X,
} from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import {
  enablePushNotifications,
  getPushPermissionState,
  isPushDeviceRegistered,
  syncPushDeviceRegistration,
  type PushPermissionState,
} from '@/lib/services/messagingService'

type GateState = PushPermissionState | 'checking'

function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
}

function isStandaloneApp(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && navigator.standalone === true)
}

function blockedInstructions(): string {
  if (typeof navigator === 'undefined') return ''
  if (isAppleMobile()) {
    return 'Mở Cài đặt → Ứng dụng → Trí Candy → Thông báo, sau đó bật “Cho phép thông báo”.'
  }
  if (/Android/i.test(navigator.userAgent)) {
    return 'Nhấn giữ biểu tượng Trí Candy → Thông tin ứng dụng → Thông báo, sau đó bật quyền thông báo.'
  }
  return 'Mở cài đặt quyền của trang web trong trình duyệt và chuyển Thông báo sang Cho phép.'
}

function unavailableInstructions(): string {
  if (isAppleMobile() && !isStandaloneApp()) {
    return 'Trên iPhone, hãy chọn Chia sẻ → Thêm vào Màn hình chính, rồi mở Trí Candy từ biểu tượng vừa tạo.'
  }
  if (isAppleMobile()) {
    return 'Thiết bị hoặc phiên bản iOS này chưa hỗ trợ thông báo web. Bạn vẫn nhận đầy đủ thông báo khi mở Trí Candy.'
  }
  if (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)) {
    return 'Hãy cập nhật Chrome nếu có thể. Nếu máy vẫn không hỗ trợ, bạn vẫn nhận đầy đủ thông báo khi mở Trí Candy.'
  }
  return 'Trình duyệt này chưa hỗ trợ thông báo đẩy. Bạn vẫn nhận đầy đủ thông báo khi đang mở Trí Candy.'
}

export function NotificationPermissionGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { authUser, employee, isLoading, isPreviewMode } = useAuth()
  const [permission, setPermission] = useState<GateState>('checking')
  const [registered, setRegistered] = useState(false)
  const [working, setWorking] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [message, setMessage] = useState('')
  const exempt = pathname.startsWith('/auth/') || pathname === '/profile/setup'
  const shouldCheck = !isLoading && !!authUser && !!employee && !isPreviewMode && !exempt

  const refreshState = useCallback(async (syncDevice = true) => {
    if (!authUser || isPreviewMode) return
    try {
      const nextPermission = await getPushPermissionState()
      setPermission(nextPermission)
      if (nextPermission !== 'granted') {
        setRegistered(false)
        return
      }

      let deviceRegistered = await isPushDeviceRegistered(authUser.uid)
      if (!deviceRegistered && syncDevice) {
        deviceRegistered = !!(await syncPushDeviceRegistration(authUser.uid))
      }
      setRegistered(deviceRegistered)
      if (!deviceRegistered) {
        setMessage('Quyền đã bật nhưng thiết bị chưa đăng ký xong. Hãy nhấn thử lại; ứng dụng vẫn dùng được bình thường.')
      } else {
        setMessage('')
      }
    } catch (error) {
      setRegistered(false)
      setMessage(error instanceof Error ? error.message : 'Chưa thể kiểm tra trạng thái thông báo.')
    }
  }, [authUser, isPreviewMode])

  useEffect(() => {
    if (!shouldCheck) return
    const timer = window.setTimeout(() => {
      setDismissed(sessionStorage.getItem(`push-prompt-dismissed:${authUser.uid}`) === '1')
      setPermission('checking')
      setMessage('')
      void refreshState()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [authUser, refreshState, shouldCheck])

  useEffect(() => {
    if (!shouldCheck) return
    const recheck = () => {
      if (document.visibilityState === 'visible') void refreshState()
    }
    window.addEventListener('focus', recheck)
    document.addEventListener('visibilitychange', recheck)
    return () => {
      window.removeEventListener('focus', recheck)
      document.removeEventListener('visibilitychange', recheck)
    }
  }, [refreshState, shouldCheck])

  const dismiss = () => {
    setDismissed(true)
    if (authUser) sessionStorage.setItem(`push-prompt-dismissed:${authUser.uid}`, '1')
  }

  const enable = async () => {
    if (!authUser) return
    setWorking(true)
    setMessage('')
    try {
      if (permission === 'default' || permission === 'granted') {
        await enablePushNotifications(authUser.uid)
      } else {
        await refreshState()
      }
      const nextPermission = await getPushPermissionState()
      setPermission(nextPermission)
      if (nextPermission === 'granted') {
        const deviceRegistered = await isPushDeviceRegistered(authUser.uid)
        setRegistered(deviceRegistered)
        if (deviceRegistered) setDismissed(true)
      }
    } catch (error) {
      setPermission(await getPushPermissionState())
      setRegistered(false)
      setMessage(error instanceof Error ? error.message : 'Không thể bật thông báo trên thiết bị này.')
    } finally {
      setWorking(false)
    }
  }

  const unavailable = permission === 'unsupported' || permission === 'unavailable'
  const denied = permission === 'denied'
  const showPrompt = shouldCheck && !dismissed && permission !== 'checking' && !(permission === 'granted' && registered)

  return (
    <>
      {children}
      {showPrompt && (
        <aside
          aria-labelledby="push-prompt-title"
          className="fixed inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-[70] mx-auto max-w-md overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700 dark:bg-slate-900 md:bottom-5"
        >
          <div className="flex items-start gap-3 p-4 sm:p-5">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/20">
              {unavailable ? <Smartphone className="h-5 w-5" /> : denied ? <Settings className="h-5 w-5" /> : <BellRing className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <p id="push-prompt-title" className="font-black text-slate-950 dark:text-white">
                {unavailable ? 'Máy này dùng thông báo trong ứng dụng' : denied ? 'Thông báo đang bị chặn' : 'Bật thông báo công việc'}
              </p>
              <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">
                {unavailable
                  ? unavailableInstructions()
                  : denied
                    ? blockedInstructions()
                    : 'Nhận ngay kết quả lịch làm và yêu cầu mới, kể cả khi Trí Candy đang chạy nền.'}
              </p>
            </div>
            <button type="button" onClick={dismiss} aria-label="Để sau" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              <X className="h-4 w-4" />
            </button>
          </div>

          {message && (
            <p aria-live="polite" className="mx-4 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold leading-5 text-rose-700 dark:bg-rose-500/10 dark:text-rose-200 sm:mx-5">
              {message}
            </p>
          )}

          <div className="flex items-center gap-2 px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
            <button
              type="button"
              onClick={() => void enable()}
              disabled={working}
              className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-extrabold text-white transition active:scale-[0.98] disabled:opacity-60"
            >
              {working ? <LoaderCircle className="h-4 w-4 animate-spin" /> : unavailable || denied ? <RotateCw className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
              {working ? 'Đang kiểm tra…' : unavailable || denied ? 'Kiểm tra lại' : permission === 'granted' ? 'Đăng ký lại thiết bị' : 'Cho phép thông báo'}
            </button>
            <button type="button" onClick={dismiss} className="min-h-11 rounded-xl px-4 text-sm font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
              Tiếp tục
            </button>
          </div>

          {unavailable && (
            <div className="flex items-center gap-2 border-t border-slate-100 bg-emerald-50/70 px-4 py-2.5 text-xs font-semibold text-emerald-800 dark:border-slate-800 dark:bg-emerald-500/10 dark:text-emerald-200 sm:px-5">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> Không bị khóa ứng dụng và không mất thông báo đã lưu.
            </div>
          )}
        </aside>
      )}
    </>
  )
}
