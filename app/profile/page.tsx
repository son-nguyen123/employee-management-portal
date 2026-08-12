'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ArrowRightLeft,
  BellOff,
  BellRing,
  Check,
  Clock3,
  LoaderCircle,
  Mail,
  Phone,
  Send,
  ShieldCheck,
  UserRound,
  ExternalLink,
  Landmark,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useAuth } from '@/lib/hooks/useAuth'
import type { EmployeeScheduleMode, StaffRequest } from '@/lib/models/types'
import { requestEmployeeScheduleModeChange, setInitialEmployeeScheduleMode } from '@/lib/services/employeeService'
import { subscribeToEmployeeScheduleModeRequests } from '@/lib/services/staffRequestService'
import { profileImageUrl } from '@/lib/utils/profileImage'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import {
  enablePushNotifications,
  getPushPermissionState,
  isPushDeviceRegistered,
  syncPushDeviceRegistration,
  type PushPermissionState,
} from '@/lib/services/messagingService'

function permissionLabel(permission: PushPermissionState, isRegistered: boolean) {
  if (permission === 'granted' && isRegistered) return 'Đang bật'
  if (permission === 'granted') return 'Chưa hoàn tất'
  if (permission === 'denied') return 'Đã bị chặn'
  if (permission === 'unsupported' || permission === 'unavailable') return 'Không được hỗ trợ'
  return 'Chưa bật'
}

function asProfileDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate()
    return date instanceof Date ? date : null
  }
  return null
}

function scheduleModeLabel(mode: EmployeeScheduleMode): string {
  return mode === 'fixed' ? 'Làm cố định' : 'Xoay ca'
}

function nextMondayLabel(): string {
  const date = new Date()
  const day = date.getDay() || 7
  date.setDate(date.getDate() - day + 8)
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
}

export default function ProfilePage() {
  const { authUser, employee, isLoading, refreshEmployee } = useAuth()
  const [permission, setPermission] = useState<PushPermissionState>('default')
  const [isRegistered, setIsRegistered] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [modeRequest, setModeRequest] = useState<StaffRequest | null>(null)
  const [modeModalOpen, setModeModalOpen] = useState(false)
  const [modeDraft, setModeDraft] = useState<EmployeeScheduleMode>('rotating')
  const [modeReason, setModeReason] = useState('')
  const [modeSaving, setModeSaving] = useState(false)
  const [modeMessage, setModeMessage] = useState('')
  const [clock, setClock] = useState(() => Date.now())

  const loadPushState = useCallback(async () => {
    if (!authUser) return
    try {
      const nextPermission = await getPushPermissionState()
      setPermission(nextPermission)
      if (nextPermission !== 'granted') {
        setIsRegistered(false)
        return
      }
      setIsRegistered(await isPushDeviceRegistered(authUser.uid))
    } catch {
      setIsRegistered(false)
    }
  }, [authUser])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPushState(), 0)
    return () => window.clearTimeout(timer)
  }, [loadPushState])

  useEffect(() => {
    if (!authUser || employee?.role !== 'employee') return
    return subscribeToEmployeeScheduleModeRequests(authUser.uid, (items) => {
      setModeRequest(items.find((item) => item.status === 'Pending') || null)
    })
  }, [authUser, employee?.role])

  useEffect(() => {
    const deadline = asProfileDate(employee?.scheduleModeInitialSelectionDeadlineAt)
    if (!deadline || deadline.getTime() <= Date.now()) return
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [employee?.scheduleModeInitialSelectionDeadlineAt])

  useEffect(() => {
    if (employee?.scheduleMode) setModeDraft(employee.scheduleMode)
  }, [employee?.scheduleMode])

  const handleEnableNotifications = async () => {
    if (!authUser) return
    setIsSaving(true)
    setMessage('')
    try {
      await enablePushNotifications(authUser.uid)
      setPermission('granted')
      setIsRegistered(Boolean(await syncPushDeviceRegistration(authUser.uid)))
      setMessage('Thiết bị này đã sẵn sàng nhận thông báo.')
    } catch (error) {
      setPermission(await getPushPermissionState())
      setMessage(error instanceof Error ? error.message : 'Không thể bật thông báo trên thiết bị này.')
    } finally {
      setIsSaving(false)
    }
  }

  const cannotEnable = permission === 'unsupported' || permission === 'unavailable'

  const currentMode = employee?.scheduleMode || 'rotating'
  const initialDeadline = asProfileDate(employee?.scheduleModeInitialSelectionDeadlineAt)
  const initialSelectionOpen = Boolean(initialDeadline && clock < initialDeadline.getTime())
  const cooldownUntil = asProfileDate(employee?.scheduleModeChangeCooldownUntil)
  const cooldownActive = Boolean(cooldownUntil && cooldownUntil.getTime() > clock)
  const initialTimeLeft = initialDeadline ? Math.max(0, initialDeadline.getTime() - clock) : 0
  const initialHours = Math.floor(initialTimeLeft / 3_600_000)
  const initialMinutes = Math.floor((initialTimeLeft % 3_600_000) / 60_000)

  const saveInitialMode = async () => {
    setModeSaving(true)
    setModeMessage('')
    try {
      await setInitialEmployeeScheduleMode(modeDraft)
      await refreshEmployee()
      setModeMessage('Đã lưu chế độ làm việc ban đầu.')
    } catch (error) {
      setModeMessage(error instanceof Error ? error.message : 'Chưa thể lưu chế độ làm việc.')
    } finally {
      setModeSaving(false)
    }
  }

  const submitModeChange = async () => {
    if (modeDraft === currentMode) {
      setModeMessage('Bạn đang dùng chế độ này rồi.')
      return
    }
    if (!modeReason.trim()) {
      setModeMessage('Vui lòng ghi lý do ngắn để quản lý xem xét.')
      return
    }
    setModeSaving(true)
    setModeMessage('')
    try {
      await requestEmployeeScheduleModeChange(modeDraft, modeReason.trim())
      setModeModalOpen(false)
      setModeReason('')
      setModeMessage('Đã gửi yêu cầu. Chế độ mới chỉ có hiệu lực từ tuần kế tiếp sau khi quản lý duyệt.')
    } catch (error) {
      setModeMessage(error instanceof Error ? error.message : 'Chưa thể gửi yêu cầu đổi chế độ.')
    } finally {
      setModeSaving(false)
    }
  }

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
                : employee?.role === 'director'
                  ? 'Sếp / Giám đốc'
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

        {employee?.role === 'employee' && (
          <section className="mobile-card mt-4 overflow-hidden border border-violet-100 bg-gradient-to-br from-violet-50 via-white to-indigo-50 p-4 shadow-lg shadow-indigo-950/5 dark:border-violet-500/20 dark:from-violet-500/10 dark:via-slate-900 dark:to-indigo-500/10">
            <div className="flex items-start gap-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-violet-600 text-white shadow-md shadow-violet-600/20"><ArrowRightLeft className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-extrabold">Cách xếp lịch làm</h2>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${currentMode === 'fixed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200' : 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200'}`}>{scheduleModeLabel(currentMode)}</span>
                </div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">Chế độ cố định tự lặp theo tuần; xoay ca cần đăng ký từng tuần.</p>
              </div>
            </div>

            {initialSelectionOpen ? (
              <div className="mt-4 rounded-2xl border border-violet-200 bg-white/80 p-3 dark:border-violet-500/20 dark:bg-slate-900/60">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-violet-700 dark:text-violet-200"><Clock3 className="h-4 w-4" /> Chọn lần đầu · còn {initialHours} giờ {initialMinutes} phút</div>
                <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl bg-violet-50 p-1 dark:bg-violet-500/10">
                  {(['rotating', 'fixed'] as EmployeeScheduleMode[]).map((mode) => (
                    <button key={mode} type="button" onClick={() => setModeDraft(mode)} className={`rounded-xl px-3 py-2.5 text-sm font-black transition ${modeDraft === mode ? 'bg-violet-600 text-white shadow-md' : 'text-violet-700 hover:bg-white dark:text-violet-200 dark:hover:bg-slate-900'}`}>{scheduleModeLabel(mode)}</button>
                  ))}
                </div>
                <button type="button" disabled={modeSaving} onClick={() => void saveInitialMode()} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-4 text-sm font-extrabold text-white shadow-lg shadow-violet-600/15 disabled:opacity-60">{modeSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Lưu lựa chọn</button>
              </div>
            ) : modeRequest ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/20 dark:bg-amber-500/10">
                <p className="text-xs font-black uppercase tracking-wide text-amber-700 dark:text-amber-200">Đang chờ quản lý duyệt</p>
                <p className="mt-1 text-sm font-bold">{scheduleModeLabel(modeRequest.previousScheduleMode || currentMode)} → {scheduleModeLabel(modeRequest.requestedScheduleMode || currentMode)}</p>
                <p className="mt-1 text-xs leading-5 text-amber-800/80 dark:text-amber-100/80">Dự kiến áp dụng từ tuần {asProfileDate(modeRequest.weekStart)?.toLocaleDateString('vi-VN') || nextMondayLabel()}. Chế độ hiện tại vẫn giữ nguyên.</p>
              </div>
            ) : cooldownActive ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">Bạn có thể gửi yêu cầu đổi lại sau {cooldownUntil?.toLocaleDateString('vi-VN')}.</div>
            ) : (
              <button type="button" onClick={() => { setModeDraft(currentMode === 'fixed' ? 'rotating' : 'fixed'); setModeReason(''); setModeMessage(''); setModeModalOpen(true) }} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-violet-200 bg-white px-4 text-sm font-extrabold text-violet-700 transition hover:bg-violet-50 dark:border-violet-500/20 dark:bg-slate-900/60 dark:text-violet-200"><ArrowRightLeft className="h-4 w-4" /> Đổi chế độ · áp dụng tuần sau</button>
            )}
            {modeMessage && <p aria-live="polite" className="mt-3 rounded-2xl bg-white/80 p-3 text-sm font-semibold leading-5 text-slate-700 dark:bg-slate-900/70 dark:text-slate-200">{modeMessage}</p>}
          </section>
        )}

        <section className="mobile-card mt-4 overflow-hidden p-4">
          <div className="flex items-start gap-3">
            <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${isRegistered ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'}`}>
              {isRegistered ? <BellRing className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-extrabold">Thông báo trên thiết bị</h2>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold dark:bg-slate-800">{permissionLabel(permission, isRegistered)}</span>
              </div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Nhận thông báo khi lịch làm hoặc yêu cầu của bạn được xử lý.</p>
              {(permission === 'unsupported' || permission === 'unavailable') && <p className="mt-2 text-xs font-semibold leading-5 text-amber-700 dark:text-amber-300">Trên iPhone, hãy thêm web vào Màn hình chính rồi mở từ biểu tượng để bật thông báo.</p>}
            </div>
          </div>
          {message && <p aria-live="polite" className="mt-3 rounded-xl bg-slate-100 p-3 text-sm font-semibold dark:bg-slate-800">{message}</p>}
          {isRegistered ? (
            <div className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-50 px-4 text-sm font-extrabold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><BellRing className="h-4 w-4" /> Thông báo công việc luôn bật</div>
          ) : (
            <button type="button" disabled={isSaving || cannotEnable} onClick={handleEnableNotifications} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 text-sm font-extrabold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
              {isSaving && <LoaderCircle className="h-4 w-4 animate-spin" />}
              {permission === 'granted' ? 'Hoàn tất đăng ký thiết bị' : permission === 'denied' ? 'Mở quyền trong cài đặt trình duyệt' : 'Bật thông báo'}
            </button>
          )}
        </section>
      </PageContainer>

      {modeModalOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onClick={() => !modeSaving && setModeModalOpen(false)}>
          <section role="dialog" aria-modal="true" aria-labelledby="schedule-mode-dialog-title" className="w-full max-w-md overflow-hidden rounded-[2rem] border border-white/70 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-start gap-3 border-b border-slate-100 p-5 dark:border-white/10">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200"><ArrowRightLeft className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1"><p className="text-xs font-black uppercase tracking-wider text-violet-600">Yêu cầu quản lý</p><h2 id="schedule-mode-dialog-title" className="mt-1 text-xl font-black">Đổi chế độ làm việc?</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">Thay đổi chỉ áp dụng từ tuần kế tiếp, không thay đổi ngược lịch hoặc khoản trừ hiện tại.</p></div>
              <button type="button" aria-label="Đóng" disabled={modeSaving} onClick={() => setModeModalOpen(false)} className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-700 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200"><X className="h-5 w-5" /></button>
            </header>
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-2xl bg-slate-50 p-3 text-center dark:bg-slate-800">
                <div><p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Hiện tại</p><p className="mt-1 text-sm font-extrabold">{scheduleModeLabel(currentMode)}</p></div>
                <ArrowRightLeft className="h-4 w-4 text-violet-600" />
                <div><p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Muốn chuyển</p><p className="mt-1 text-sm font-extrabold text-violet-700 dark:text-violet-200">{scheduleModeLabel(modeDraft)}</p></div>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100"><strong>Áp dụng từ Thứ Hai, {nextMondayLabel()}.</strong><br />Quản lý sẽ duyệt trong mục Yêu cầu khác. Trong lúc chờ, lịch vẫn theo chế độ hiện tại.</div>
              <label className="block text-sm font-bold">Lý do chuyển (bắt buộc)<textarea value={modeReason} onChange={(event) => setModeReason(event.target.value)} rows={3} maxLength={300} placeholder="Ví dụ: Từ tháng này tôi làm theo lịch cố định…" className="mt-2 w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base leading-6 outline-none transition focus:border-violet-500 dark:border-slate-700 dark:bg-slate-900" /></label>
              {modeMessage && <p aria-live="polite" className="rounded-2xl bg-rose-50 p-3 text-sm font-semibold leading-5 text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">{modeMessage}</p>}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={modeSaving} onClick={() => setModeModalOpen(false)} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 font-extrabold dark:border-slate-700">Hủy</button>
                <button type="button" disabled={modeSaving} onClick={() => void submitModeChange()} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-violet-600 font-extrabold text-white shadow-lg shadow-violet-600/20 disabled:opacity-60">{modeSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Gửi yêu cầu</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
