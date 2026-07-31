'use client'

import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { BellRing, CheckCircle2, LoaderCircle, RotateCw, Settings, Smartphone } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import {
  enablePushNotifications,
  getPushPermissionState,
  isPushDeviceRegistered,
  syncPushDeviceRegistration,
  type PushPermissionState,
} from '@/lib/services/messagingService'

type GateState = PushPermissionState | 'checking'

function blockedInstructions(): string {
  if (typeof navigator === 'undefined') return ''
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    return 'Mở Cài đặt → Ứng dụng → Trí Candy → Thông báo, sau đó bật “Cho phép thông báo”.'
  }
  if (/Android/i.test(navigator.userAgent)) {
    return 'Nhấn giữ biểu tượng Trí Candy → Thông tin ứng dụng → Thông báo, sau đó bật quyền thông báo.'
  }
  return 'Mở cài đặt quyền của trang web trong trình duyệt và chuyển Thông báo sang Cho phép.'
}

export function NotificationPermissionGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { authUser, employee, isLoading, isPreviewMode } = useAuth()
  const [permission, setPermission] = useState<GateState>('checking')
  const [registered, setRegistered] = useState(false)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')
  const exempt = pathname.startsWith('/auth/') || pathname === '/profile/setup'
  const mustEnable = !isLoading && !!authUser && !!employee && !isPreviewMode && !exempt

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
      if (!deviceRegistered) setMessage('Quyền đã bật nhưng thiết bị chưa đăng ký xong. Hãy nhấn nút bên dưới để thử lại.')
    } catch (error) {
      setRegistered(false)
      setMessage(error instanceof Error ? error.message : 'Chưa thể kiểm tra trạng thái thông báo.')
    }
  }, [authUser, isPreviewMode])

  useEffect(() => {
    if (!mustEnable) return
    setPermission('checking')
    setMessage('')
    void refreshState()
  }, [mustEnable, refreshState])

  useEffect(() => {
    if (!mustEnable) return
    const recheck = () => {
      if (document.visibilityState === 'visible') void refreshState()
    }
    window.addEventListener('focus', recheck)
    document.addEventListener('visibilitychange', recheck)
    return () => {
      window.removeEventListener('focus', recheck)
      document.removeEventListener('visibilitychange', recheck)
    }
  }, [mustEnable, refreshState])

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
        setRegistered(await isPushDeviceRegistered(authUser.uid))
      }
    } catch (error) {
      setPermission(await getPushPermissionState())
      setRegistered(false)
      setMessage(error instanceof Error ? error.message : 'Không thể bật thông báo trên thiết bị này.')
    } finally {
      setWorking(false)
    }
  }

  if (!mustEnable || (permission === 'granted' && registered)) return <>{children}</>

  const unavailable = permission === 'unsupported' || permission === 'unavailable'
  const denied = permission === 'denied'

  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-slate-100 px-4 py-[max(1.25rem,env(safe-area-inset-top))] dark:bg-slate-950">
      <main className="mx-auto flex min-h-[calc(100svh-2.5rem)] max-w-md items-center justify-center">
        <section className="w-full overflow-hidden rounded-[2rem] border border-indigo-100 bg-white shadow-2xl shadow-indigo-950/10 dark:border-indigo-500/20 dark:bg-slate-900">
          <div className="bg-slate-950 px-6 py-8 text-center text-white">
            <Image src="/pwa-maskable-512.png" alt="Trí Candy" width={80} height={80} className="mx-auto h-20 w-20 rounded-[1.6rem] object-cover shadow-xl shadow-black/25" priority />
            <div className="mx-auto mt-5 flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-indigo-100">
              <BellRing className="h-4 w-4" /> Thông báo công việc
            </div>
            <h1 className="mt-4 text-2xl font-black">Cho phép thông báo</h1>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-slate-300">
              Trí Candy cần gửi yêu cầu mới, kết quả lịch làm và phản hồi công việc đến thiết bị đúng lúc.
            </p>
          </div>

          <div className="p-5">
            {permission === 'checking' ? (
              <div className="flex min-h-44 flex-col items-center justify-center text-center">
                <LoaderCircle className="h-7 w-7 animate-spin text-indigo-600" />
                <p className="mt-4 font-extrabold">Đang kiểm tra thiết bị…</p>
                <p className="mt-1 text-sm text-muted-foreground">Quá trình này chỉ mất vài giây.</p>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <div className="flex items-start gap-3 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/70">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
                    <div><p className="text-sm font-extrabold">Không bỏ lỡ công việc</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">Nhân viên nhận kết quả; quản lý nhận ngay yêu cầu mới cần xử lý.</p></div>
                  </div>
                  <div className="flex items-start gap-3 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/70">
                    <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
                    <div><p className="text-sm font-extrabold">Chỉ dùng cho công việc</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">Ứng dụng không gửi quảng cáo hoặc nội dung không liên quan.</p></div>
                  </div>
                </div>

                {(denied || unavailable) && (
                  <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
                    <div className="flex items-center gap-2 font-extrabold"><Settings className="h-5 w-5" /> {denied ? 'Quyền đang bị chặn' : 'Chưa thể bật trên màn hình này'}</div>
                    <p className="mt-2 text-sm leading-6">
                      {denied
                        ? blockedInstructions()
                        : 'Nếu dùng iPhone, hãy thêm Trí Candy vào Màn hình chính rồi mở lại từ biểu tượng ứng dụng. Nếu dùng Android, hãy mở bằng Chrome và cài ứng dụng trước.'}
                    </p>
                  </div>
                )}

                {message && <p aria-live="polite" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">{message}</p>}

                <button type="button" onClick={() => void enable()} disabled={working} className="mt-5 flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 font-extrabold text-white shadow-lg shadow-indigo-600/20 transition active:scale-[0.98] disabled:opacity-60">
                  {working ? <LoaderCircle className="h-5 w-5 animate-spin" /> : unavailable || denied ? <RotateCw className="h-5 w-5" /> : <BellRing className="h-5 w-5" />}
                  {working ? 'Đang kiểm tra…' : unavailable || denied ? 'Tôi đã bật quyền – kiểm tra lại' : permission === 'granted' ? 'Hoàn tất đăng ký thiết bị' : 'Cho phép thông báo'}
                </button>

                <p className="mt-4 text-center text-[11px] leading-5 text-slate-400">Bạn cần hoàn tất bước này để tiếp tục sử dụng ứng dụng.</p>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
