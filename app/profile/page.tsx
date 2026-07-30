'use client'

import { useEffect, useState } from 'react'
import {
  BellOff,
  BellRing,
  LoaderCircle,
  Mail,
  Phone,
  ShieldCheck,
  UserRound,
  ExternalLink,
  Landmark,
} from 'lucide-react'
import Link from 'next/link'
import { useAuth } from '@/lib/hooks/useAuth'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushPermissionState,
  isPushDeviceRegistered,
  type PushPermissionState,
} from '@/lib/services/messagingService'

function permissionLabel(permission: PushPermissionState, isRegistered: boolean) {
  if (permission === 'granted' && isRegistered) return 'Đang bật'
  if (permission === 'granted') return 'Chưa hoàn tất'
  if (permission === 'denied') return 'Đã bị chặn'
  if (permission === 'unsupported' || permission === 'unavailable') {
    return 'Không được hỗ trợ'
  }
  return 'Chưa bật'
}

export default function ProfilePage() {
  const { authUser, employee, isPreviewMode } = useAuth()
  const [permission, setPermission] =
    useState<PushPermissionState>('default')
  const [isRegistered, setIsRegistered] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const loadPushState = async () => {
      const nextPermission = await getPushPermissionState()
      setPermission(nextPermission)
      if (nextPermission === 'granted' && authUser && !isPreviewMode) {
        try {
          setIsRegistered(await isPushDeviceRegistered(authUser.uid))
        } catch {
          setIsRegistered(false)
        }
      }
    }
    void loadPushState()
  }, [authUser, isPreviewMode])

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

  const handleDisableNotifications = async () => {
    if (!authUser || isPreviewMode) return

    setIsSaving(true)
    setMessage('')
    try {
      await disablePushNotifications(authUser.uid)
      setPermission(await getPushPermissionState())
      setIsRegistered(false)
      setMessage('Đã ngừng nhận thông báo trên thiết bị này.')
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Không thể tắt thông báo trên thiết bị này.'
      )
    } finally {
      setIsSaving(false)
    }
  }

  const cannotEnable =
    permission === 'unsupported' ||
    permission === 'unavailable'

  return (
    <main className="min-h-screen">
      <Header
        title="Hồ sơ cá nhân"
        subtitle="Thông tin tài khoản nhân viên"
      />
      <PageContainer>
        <section className="mobile-card overflow-hidden">
          <div className="bg-slate-950 p-6 text-center text-white">
            <div className="mx-auto grid h-20 w-20 place-items-center overflow-hidden rounded-[1.75rem] bg-indigo-600">
              {employee?.photoURL || authUser?.photoURL
                ? <img src={employee?.photoURL || authUser?.photoURL || ''} alt="" className="h-full w-full object-cover" />
                : <UserRound className="h-9 w-9" />}
            </div>
            <h2 className="mt-4 text-xl font-extrabold">
              {employee?.fullName || authUser?.displayName || 'Nhân viên'}
            </h2>
            <p className="mt-1 text-sm text-slate-300">
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
                Nhận thông báo khi lịch làm hoặc yêu cầu của bạn được xử lý.
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

          {isRegistered && employee?.role === 'employee' && !isPreviewMode ? (
            <div className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-50 px-4 text-sm font-extrabold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              <BellRing className="h-4 w-4" /> Thông báo bắt buộc đang bật
            </div>
          ) : (
            <button
              type="button"
              disabled={
                isSaving ||
                isPreviewMode ||
                cannotEnable
              }
              onClick={
                isRegistered
                  ? handleDisableNotifications
                  : handleEnableNotifications
              }
              className={`mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-sm font-extrabold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
                isRegistered
                  ? 'bg-slate-700 hover:bg-slate-800'
                  : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              {isSaving && <LoaderCircle className="h-4 w-4 animate-spin" />}
              {isRegistered
                ? 'Tắt thông báo trên thiết bị này'
                : permission === 'granted'
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
