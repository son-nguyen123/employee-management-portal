'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  BellOff,
  BellRing,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Mail,
  Phone,
  ShieldCheck,
  UserRound,
  ExternalLink,
  Landmark,
  RefreshCw,
  Send,
  TriangleAlert,
} from 'lucide-react'
import Link from 'next/link'
import { useAuth } from '@/lib/hooks/useAuth'
import { profileImageUrl } from '@/lib/utils/profileImage'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import {
  enablePushNotifications,
  getCurrentPushDeviceId,
  getPushPermissionState,
  isPushDeviceRegistered,
  repairPushDeviceRegistration,
  syncPushDeviceRegistration,
  type PushPermissionState,
} from '@/lib/services/messagingService'
import { callWorkflowApi, newWorkflowRequestId } from '@/lib/services/workflowApi'

interface PushDiagnostics {
  currentDeviceRegistered: boolean
  registeredDeviceCount: number
  currentDevice: null | {
    permission: string
    platform: string
    createdAt: string | null
    updatedAt: string | null
    lastSeenAt: string | null
  }
  recentDispatches: Array<{
    id: string
    state: string
    successCount: number
    failureCount: number
    error: string
    updatedAt: string | null
    isTest: boolean
  }>
}

interface PushTestResult {
  state: string
  successCount: number
  failureCount: number
  reused?: boolean
}

function permissionLabel(permission: PushPermissionState, isRegistered: boolean) {
  if (permission === 'granted' && isRegistered) return 'Đang bật'
  if (permission === 'granted') return 'Chưa hoàn tất'
  if (permission === 'denied') return 'Đã bị chặn'
  if (permission === 'unsupported' || permission === 'unavailable') {
    return 'Không được hỗ trợ'
  }
  return 'Chưa bật'
}

function formatSyncTime(value?: string | null): string {
  if (!value) return 'Chưa ghi nhận'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Chưa ghi nhận'
  return date.toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function dispatchLabel(state?: string): string {
  if (state === 'sent') return 'FCM đã chấp nhận'
  if (state === 'partial') return 'Gửi được một phần'
  if (state === 'failed') return 'FCM từ chối hoặc gặp lỗi'
  if (state === 'no-devices') return 'Không tìm thấy thiết bị'
  if (state === 'sending' || state === 'queued') return 'Đang gửi'
  return 'Chưa kiểm tra'
}

export default function ProfilePage() {
  const { authUser, employee, isLoading, isPreviewMode } = useAuth()
  const [permission, setPermission] =
    useState<PushPermissionState>('default')
  const [isRegistered, setIsRegistered] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [isRepairing, setIsRepairing] = useState(false)
  const [diagnostics, setDiagnostics] = useState<PushDiagnostics | null>(null)
  const [message, setMessage] = useState('')

  const loadPushState = useCallback(async (syncDevice = true) => {
    if (!authUser || isPreviewMode) return
    try {
      const nextPermission = await getPushPermissionState()
      setPermission(nextPermission)
      if (nextPermission !== 'granted') {
        setIsRegistered(false)
        setDiagnostics(null)
        return
      }

      let registered = await isPushDeviceRegistered(authUser.uid)
      if (!registered && syncDevice) {
        registered = Boolean(await syncPushDeviceRegistration(authUser.uid))
      }
      setIsRegistered(registered)
      if (!registered) {
        setDiagnostics(null)
        return
      }

      const fid = await getCurrentPushDeviceId()
      const result = await callWorkflowApi<PushDiagnostics>('getPushDiagnostics', { fid })
      setDiagnostics(result)
      setIsRegistered(result.currentDeviceRegistered)
    } catch (error) {
      setIsRegistered(false)
      setDiagnostics(null)
      console.error('Không thể tải chẩn đoán Push:', error)
    }
  }, [authUser, isPreviewMode])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPushState(), 0)
    return () => window.clearTimeout(timer)
  }, [loadPushState])

  const rows = [
    {
      label: 'Mã nhân viên',
      value: employee?.employeeCode || 'Chưa cập nhật',
      icon: ShieldCheck,
    },
    {
      label: 'Email',
      value: authUser?.email || 'Chưa cập nhật',
      icon: Mail,
    },
    {
      label: 'Số điện thoại',
      value: employee?.phone || 'Chưa cập nhật',
      icon: Phone,
    },
    {
      label: 'Tài khoản ngân hàng',
      value: employee?.bankName && employee?.bankAccountNumber
        ? `${employee.bankName} · ${employee.bankAccountNumber}`
        : 'Chưa cập nhật',
      icon: Landmark,
    },
  ]

  const handleEnableNotifications = async () => {
    if (!authUser || isPreviewMode) {
      setMessage('Hãy đăng nhập bằng tài khoản Firebase thật để bật thông báo.')
      return
    }

    setIsSaving(true)
    setMessage('')
    try {
      await enablePushNotifications(authUser.uid)
      setPermission('granted')
      setIsRegistered(true)
      setMessage('Thiết bị này đã sẵn sàng nhận thông báo.')
      await loadPushState(false)
    } catch (error) {
      setPermission(await getPushPermissionState())
      setMessage(
        error instanceof Error
          ? error.message
          : 'Không thể bật thông báo trên thiết bị này.'
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleRepairRegistration = async () => {
    if (!authUser || isPreviewMode) return
    setIsRepairing(true)
    setMessage('Đang xóa kết nối cũ và đăng ký lại iPhone này…')
    try {
      await repairPushDeviceRegistration(authUser.uid)
      setPermission('granted')
      setIsRegistered(true)
      await loadPushState(false)
      setMessage('Đã tạo lại kết nối Push cho thiết bị này. Bạn có thể gửi thử ngay.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể sửa đăng ký Push.')
      await loadPushState(false)
    } finally {
      setIsRepairing(false)
    }
  }

  const handleSendTestPush = async () => {
    if (!authUser || isPreviewMode || !isRegistered) return
    setIsTesting(true)
    setMessage('Đã bắt đầu kiểm tra. Hãy khóa màn hình iPhone ngay; Push sẽ được gửi sau 2 giây.')
    try {
      const fid = await getCurrentPushDeviceId()
      const result = await callWorkflowApi<PushTestResult>('sendTestPush', {
        fid,
        requestId: newWorkflowRequestId(),
      })
      await loadPushState(false)
      if (result.state === 'sent' && result.successCount > 0) {
        setMessage('FCM đã chấp nhận Push tới iPhone này. Nếu màn hình khóa vẫn không hiện, kết nối tới Apple đã nhận nhưng iOS đang giữ hoặc làm mất cảnh báo.')
      } else if (result.state === 'no-devices') {
        setMessage('Server không tìm thấy đăng ký của iPhone này. Hãy bấm “Sửa đăng ký” rồi thử lại.')
      } else {
        setMessage(`Gửi thử thất bại (${result.failureCount} thiết bị lỗi). Hãy bấm “Sửa đăng ký” rồi thử lại.`)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể gửi Push thử.')
      await loadPushState(false)
    } finally {
      setIsTesting(false)
    }
  }

  const cannotEnable =
    permission === 'unsupported' ||
    permission === 'unavailable'
  const latestTest = diagnostics?.recentDispatches.find((item) => item.isTest)
  const busy = isSaving || isTesting || isRepairing

  if (isLoading) {
    return <main className="grid min-h-screen place-items-center bg-slate-50 dark:bg-slate-950"><div className="text-center"><LoaderCircle className="mx-auto h-7 w-7 animate-spin text-indigo-600" /><p className="mt-3 text-sm font-bold text-slate-600 dark:text-slate-300">Đang tải hồ sơ và trạng thái thiết bị…</p></div></main>
  }

  return (
    <main className="min-h-screen">
      <Header
        title="Hồ sơ cá nhân"
        subtitle="Thông tin tài khoản nhân viên"
      />
      <PageContainer>
        <section className="mobile-card overflow-hidden">
          <div
            className="relative overflow-hidden bg-pink-50 p-6 text-center text-slate-950"
            style={{
              backgroundImage: "linear-gradient(115deg, rgba(255,255,255,.96), rgba(253,230,245,.82)), url('/tricandy-logo-hd.png')",
              backgroundPosition: 'center, right -55px center',
              backgroundRepeat: 'no-repeat',
              backgroundSize: 'cover, 280px auto',
            }}
          >
            <div className="mx-auto grid h-20 w-20 place-items-center overflow-hidden rounded-[1.75rem] border-2 border-white bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white shadow-lg shadow-fuchsia-900/15">
              {employee?.photoURL || authUser?.photoURL
                ? <img src={profileImageUrl(employee?.photoURL || authUser?.photoURL)} alt="" className="h-full w-full object-cover" />
                : <UserRound className="h-9 w-9" />}
            </div>
            <h2 className="mt-4 text-xl font-extrabold">
              {employee?.fullName || authUser?.displayName || 'Nhân viên'}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {employee?.role === 'admin'
                ? 'Quản lý'
                : employee?.role === 'manager'
                  ? 'Quản lý ca'
                  : 'Nhân viên'}
            </p>
          </div>
          <div className="space-y-1 p-3">
            {rows.map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className="flex items-center gap-3 rounded-2xl p-3"
              >
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground">
                    {label}
                  </p>
                  <p className="truncate font-bold">{value}</p>
                </div>
              </div>
            ))}
            {employee?.facebookUrl && (
              <a href={employee.facebookUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl p-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-500/10"><ExternalLink className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-muted-foreground">Facebook</p><p className="truncate font-bold">{employee.facebookUrl}</p></div>
              </a>
            )}
            <Link href="/profile/setup" className="mt-2 flex min-h-11 items-center justify-center rounded-2xl bg-indigo-50 text-sm font-bold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-200">Chỉnh sửa hồ sơ</Link>
          </div>
        </section>

        <section className="mobile-card mt-4 overflow-hidden p-4">
          <div className="flex items-start gap-3">
            <div
              className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${
                isRegistered
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
              }`}
            >
              {isRegistered ? (
                <BellRing className="h-5 w-5" />
              ) : (
                <BellOff className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-extrabold">Thông báo trên thiết bị</h2>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold dark:bg-slate-800">
                  {permissionLabel(permission, isRegistered)}
                </span>
              </div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Kiểm tra trực tiếp kết nối giữa máy này, Firebase và hệ thống thông báo của iPhone.
              </p>
              {(permission === 'unsupported' || permission === 'unavailable') && (
                <p className="mt-2 text-xs font-semibold leading-5 text-amber-700 dark:text-amber-300">
                  Không liên quan đến gói Firebase. Trên iPhone, hãy thêm web vào Màn hình chính rồi mở từ biểu tượng để bật thông báo.
                </p>
              )}
            </div>
          </div>

          {message && (
            <p
              aria-live="polite"
              className="mt-3 rounded-xl bg-slate-100 p-3 text-sm font-semibold dark:bg-slate-800"
            >
              {message}
            </p>
          )}

          {isPreviewMode && (
            <p className="mt-3 text-xs font-semibold text-amber-700 dark:text-amber-300">
              Chế độ xem trước không đăng ký thiết bị thật. Hãy đăng nhập bằng
              Firebase để sử dụng.
            </p>
          )}

          {isRegistered && !isPreviewMode ? (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-emerald-50 p-3 dark:bg-emerald-500/10">
                  <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="text-xs font-extrabold">Máy hiện tại</span>
                  </div>
                  <p className="mt-1 text-sm font-black text-emerald-950 dark:text-emerald-100">Đã đăng ký</p>
                </div>
                <div className="rounded-2xl bg-slate-100 p-3 dark:bg-slate-800">
                  <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                    <Activity className="h-4 w-4" />
                    <span className="text-xs font-extrabold">Tổng thiết bị</span>
                  </div>
                  <p className="mt-1 text-sm font-black">{diagnostics?.registeredDeviceCount ?? 1} thiết bị</p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-start gap-3">
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-muted-foreground">Đồng bộ thiết bị gần nhất</p>
                    <p className="mt-0.5 text-sm font-extrabold">{formatSyncTime(diagnostics?.currentDevice?.lastSeenAt)}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-start gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                  {latestTest?.state === 'sent'
                    ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    : latestTest
                      ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      : <Activity className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-muted-foreground">Lần gửi thử gần nhất</p>
                    <p className="mt-0.5 text-sm font-extrabold">{dispatchLabel(latestTest?.state)}</p>
                    {latestTest?.updatedAt && <p className="mt-0.5 text-xs text-muted-foreground">{formatSyncTime(latestTest.updatedAt)}</p>}
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={handleSendTestPush}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 text-sm font-extrabold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isTesting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {isTesting ? 'Đang chờ 2 giây và gửi…' : 'Gửi thử rồi khóa màn hình'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleRepairRegistration}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {isRepairing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {isRepairing ? 'Đang tạo lại kết nối…' : 'Sửa đăng ký thiết bị'}
              </button>
              <p className="px-2 text-center text-[11px] leading-5 text-muted-foreground">
                Nút gửi thử chờ 2 giây để bạn khóa màn hình. “FCM đã chấp nhận” xác nhận đường gửi tới thiết bị, nhưng iOS vẫn quyết định cách hiển thị cuối cùng.
              </p>
            </div>
          ) : (
            <button
              type="button"
              disabled={
                busy ||
                isPreviewMode ||
                cannotEnable
              }
              onClick={handleEnableNotifications}
              className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 text-sm font-extrabold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving && <LoaderCircle className="h-4 w-4 animate-spin" />}
              {permission === 'granted'
                  ? 'Hoàn tất đăng ký thiết bị'
                : permission === 'denied'
                  ? 'Mở quyền trong cài đặt trình duyệt'
                  : 'Bật thông báo'}
            </button>
          )}
        </section>
      </PageContainer>
    </main>
  )
}
