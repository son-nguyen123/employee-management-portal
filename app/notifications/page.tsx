'use client'

import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileText,
  Loader2,
  MessageSquareText,
  UserRound,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { useAuth, useUserRole } from '@/lib/hooks/useAuth'
import type { Notification, WorkSchedule } from '@/lib/models/types'
import { updateLateStatus } from '@/lib/services/lateService'
import { updateLeaveStatus } from '@/lib/services/leaveService'
import {
  markAllNotificationsAsRead,
  markNotificationAsRead,
  subscribeToEmployeeNotifications,
  subscribeToManagementPendingItems,
  type ManagementPendingItem,
  type ManagementShift,
} from '@/lib/services/notificationService'
import { getPreviewSchedules } from '@/lib/services/previewWorkflow'
import { updateSalaryAdvanceStatus } from '@/lib/services/salaryService'
import {
  getEmployeeSchedules,
  reviewWorkScheduleBatch,
} from '@/lib/services/scheduleService'
import { updateStaffRequestStatus } from '@/lib/services/staffRequestService'
import { getManagementContact } from '@/lib/services/managementSettingsService'
import { profileImageUrl } from '@/lib/utils/profileImage'

type CurrentSchedule = Pick<WorkSchedule, 'id' | 'shift' | 'status'> & { date: Date }

const managementMeta = {
  schedule: { icon: CalendarDays, color: 'bg-indigo-600' },
  leave: { icon: FileText, color: 'bg-emerald-600' },
  late: { icon: Clock3, color: 'bg-amber-500' },
  salary: { icon: CircleDollarSign, color: 'bg-sky-600' },
  staff: { icon: MessageSquareText, color: 'bg-violet-600' },
}

type ManagementContact = Awaited<ReturnType<typeof getManagementContact>>

const shiftNames = {
  Morning: 'Ca sáng',
  Afternoon: 'Ca chiều',
  Evening: 'Ca tối',
}

function asDate(value: WorkSchedule['date']): Date {
  return value instanceof Date ? value : value.toDate()
}

function startOfWeek(date: Date): Date {
  const result = new Date(date)
  const weekday = result.getDay() || 7
  result.setDate(result.getDate() - weekday + 1)
  result.setHours(0, 0, 0, 0)
  return result
}

function SubmissionStamp({ date, targetDates = [] }: { date: Date; targetDates?: Date[] }) {
  const validTargets = targetDates.filter((target) => target.getTime())
  const firstTarget = validTargets.sort((left, right) => left.getTime() - right.getTime())[0]
  const submittedInTargetWeek = firstTarget && date >= startOfWeek(firstTarget)
  const warning = date.getDay() === 0 || submittedInTargetWeek
  const weekday = date.toLocaleDateString('vi-VN', { weekday: 'long' })
  const dayAndTime = `${date.toLocaleDateString('vi-VN')} · ${date.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  })}`

  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs font-semibold">
      <span className="text-muted-foreground">Gửi lúc</span>
      <span className={`inline-flex items-center gap-1 ${warning ? 'text-rose-600' : 'text-sky-600'}`}>
        {warning && <AlertTriangle className="h-3.5 w-3.5" />}
        {weekday}
      </span>
      <span className="font-medium text-muted-foreground">({dayAndTime})</span>
    </p>
  )
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(-2).map((part) => part[0]).join('').toLocaleUpperCase('vi') || 'NV'
}

function IdentityAvatar({
  name,
  photoURL,
  icon: Icon,
  color,
}: {
  name: string
  photoURL?: string
  icon: typeof Bell
  color: string
}) {
  return (
    <div className="relative h-12 w-12 shrink-0">
      <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-2xl bg-slate-900 text-sm font-black text-white shadow-sm">
        {photoURL
          ? <img src={profileImageUrl(photoURL)} alt={`Ảnh đại diện của ${name}`} width={48} height={48} decoding="async" className="h-full w-full object-cover" />
          : name ? initials(name) : <UserRound className="h-5 w-5" />}
      </div>
      <span className={`absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-lg border-2 border-white text-white shadow-sm dark:border-slate-900 ${color}`}>
        <Icon className="h-3.5 w-3.5" />
      </span>
    </div>
  )
}

function shiftStamp(item: ManagementShift | CurrentSchedule): string {
  return `${item.date.toLocaleDateString('vi-VN', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  })} · ${shiftNames[item.shift]}`
}

function ShiftList({
  title,
  items,
  tone = 'indigo',
}: {
  title: string
  items?: ManagementShift[]
  tone?: 'indigo' | 'rose' | 'emerald'
}) {
  if (!items?.length) return null
  const toneClass = tone === 'rose'
    ? 'bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-100'
    : tone === 'emerald'
      ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-100'
      : 'bg-indigo-50 text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-100'
  return (
    <div>
      <p className="mb-2 text-xs font-black uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item, index) => (
          <div key={`${item.scheduleId || index}-${item.date.toISOString()}-${item.shift}`} className={`rounded-xl px-3 py-2 text-sm font-bold ${toneClass}`}>
            {shiftStamp(item)}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function NotificationsPage() {
  const router = useRouter()
  const { authUser, isPreviewMode } = useAuth()
  const role = useUserRole()
  const isManagement = role === 'admin' || role === 'manager'
  const [items, setItems] = useState<Notification[]>([])
  const [pendingItems, setPendingItems] = useState<ManagementPendingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [weekView, setWeekView] = useState<'current' | 'previous'>('current')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [scheduleOpenId, setScheduleOpenId] = useState<string | null>(null)
  const [scheduleLoadingId, setScheduleLoadingId] = useState<string | null>(null)
  const [employeeSchedules, setEmployeeSchedules] = useState<Record<string, CurrentSchedule[]>>({})
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [managementContact, setManagementContact] = useState<ManagementContact | null>(null)

  const weekWindow = (view: typeof weekView) => {
    const now = new Date()
    const monday = new Date(now)
    const weekday = monday.getDay() || 7
    monday.setDate(monday.getDate() - weekday + 1 + (view === 'previous' ? -7 : 0))
    monday.setHours(0, 0, 0, 0)
    const end = new Date(monday)
    end.setDate(monday.getDate() + 7)
    return { start: monday, end }
  }
  const visibleItems = items.filter((item) => {
    const createdAt = item.createdAt instanceof Date ? item.createdAt : item.createdAt.toDate()
    const window = weekWindow(weekView)
    return createdAt >= window.start && createdAt < window.end
  })
  const visiblePendingItems = pendingItems.filter((item) => {
    const window = weekWindow(weekView)
    return item.createdAt >= window.start && item.createdAt < window.end
  })
  const visibleManagementHistory = visibleItems.filter((item) => {
    const text = `${item.title} ${item.message}`.toLocaleLowerCase('vi')
    return !text.includes('chờ') &&
      !text.includes('đang sửa') &&
      text.includes('nhân viên:')
  })

  useEffect(() => {
    if (!authUser) return

    if (isPreviewMode) {
      if (isManagement) {
        setPendingItems([{
          id: 'preview-request',
          type: 'staff',
          staffRequestType: 'scheduleChange',
          employeeId: 'demo-user-001',
          employeeName: 'Nguyễn Minh An',
          employeeCode: 'NV-001',
          title: 'Yêu cầu đổi / thêm ca',
          detail: '1 ca muốn hủy · 1 ca muốn thêm',
          reason: 'Em cần đổi lịch vì có việc gia đình.',
          createdAt: new Date(),
          targetIds: ['preview-request'],
          removedShifts: [{ date: new Date(), shift: 'Morning', scheduleId: 'preview-schedule-1' }],
          shifts: [{ date: new Date(Date.now() + 86400000), shift: 'Afternoon' }],
        }])
      } else {
        setItems([{
          id: 'preview-notification',
          employeeId: authUser.uid,
          title: 'Lịch làm đã được xử lý',
          message: 'Ca làm của bạn đã được duyệt.',
          type: 'success',
          isRead: false,
          createdAt: new Date(),
        }])
      }
      setLoading(false)
      return
    }

    if (isManagement) {
      const unsubscribePending = subscribeToManagementPendingItems(
        (pending) => {
          setPendingItems(pending)
          setLoading(false)
          setMessage('')
        },
        () => {
          setMessage('Chưa thể tải các việc đang chờ xử lý. Vui lòng thử lại.')
          setLoading(false)
        }
      )
      const unsubscribeNotifications = subscribeToEmployeeNotifications(authUser.uid, (notifications) => {
        setItems(notifications)
        setLoading(false)
      })
      return () => {
        unsubscribePending()
        unsubscribeNotifications()
      }
    }

    return subscribeToEmployeeNotifications(authUser.uid, (notifications) => {
      setItems(notifications)
      setLoading(false)
    })
  }, [authUser, isManagement, isPreviewMode])

  useEffect(() => {
    if (!authUser || isManagement) return
    if (isPreviewMode) {
      setManagementContact({ uid: 'demo-admin-001', fullName: 'Quản lý Minh Sơn', photoURL: '', facebookUrl: '' })
      return
    }
    void getManagementContact()
      .then(setManagementContact)
      .catch(() => setManagementContact({ uid: '', fullName: 'Quản lý', photoURL: '', facebookUrl: '' }))
  }, [authUser, isManagement, isPreviewMode])

  useEffect(() => {
    setExpandedId(null)
    setScheduleOpenId(null)
  }, [weekView])

  const destinationFor = (item: Notification) => {
    const content = `${item.title} ${item.message}`.toLocaleLowerCase('vi')
    if (content.includes('nghỉ')) return '/leave-request'
    if (content.includes('trễ')) return '/late-arrival'
    if (content.includes('ứng lương')) return '/salary-advance'
    if (content.includes('phạt')) return '/penalties'
    return '/schedule'
  }

  const notificationMetaFor = (item: Notification) => {
    const content = `${item.title} ${item.message}`.toLocaleLowerCase('vi')
    if (content.includes('nghỉ')) return managementMeta.leave
    if (content.includes('trễ')) return managementMeta.late
    if (content.includes('ứng lương')) return managementMeta.salary
    if (content.includes('phạt')) return { icon: AlertTriangle, color: 'bg-rose-600' }
    if (content.includes('lịch')) return managementMeta.schedule
    return managementMeta.staff
  }

  const openNotification = async (item: Notification) => {
    if (item.id && !item.isRead) {
      if (isPreviewMode) {
        setItems((current) => current.map((row) =>
          row.id === item.id ? { ...row, isRead: true } : row
        ))
      } else {
        try {
          await markNotificationAsRead(item.id)
        } catch {
          setMessage('Chưa thể đánh dấu thông báo đã đọc.')
        }
      }
    }
    router.push(destinationFor(item))
  }

  const markAll = async () => {
    if (!authUser) return
    if (isPreviewMode) {
      setItems((current) => current.map((item) => ({ ...item, isRead: true })))
      return
    }
    try {
      await markAllNotificationsAsRead(authUser.uid)
    } catch {
      setMessage('Chưa thể đánh dấu tất cả thông báo.')
    }
  }

  const toggleCurrentSchedule = async (item: ManagementPendingItem) => {
    if (scheduleOpenId === item.id) {
      setScheduleOpenId(null)
      return
    }
    setScheduleOpenId(item.id)
    if (employeeSchedules[item.employeeId]) return
    setScheduleLoadingId(item.id)
    try {
      const schedules = isPreviewMode
        ? getPreviewSchedules()
          .filter((row) => row.employeeId === item.employeeId)
          .map((row) => ({
            id: row.id,
            date: new Date(row.date),
            shift: row.shift,
            status: row.status,
          }))
        : (await getEmployeeSchedules(item.employeeId)).map((row) => ({
            id: row.id,
            date: asDate(row.date),
            shift: row.shift,
            status: row.status,
          }))
      setEmployeeSchedules((current) => ({
        ...current,
        [item.employeeId]: schedules
          .filter((row) => row.status !== 'Cancelled')
          .sort((left, right) => left.date.getTime() - right.date.getTime())
          .slice(0, 24),
      }))
    } catch {
      setMessage(`Chưa thể tải lịch hiện tại của ${item.employeeName}.`)
      setScheduleOpenId(null)
    } finally {
      setScheduleLoadingId(null)
    }
  }

  const processPending = async (
    item: ManagementPendingItem,
    status: 'Approved' | 'Rejected'
  ) => {
    if (!authUser || processingId) return
    const note = reviewNotes[item.id]?.trim() || ''
    if (status === 'Rejected' && !note) {
      setMessage('Vui lòng nhập lý do trước khi từ chối.')
      return
    }
    setProcessingId(item.id)
    setMessage('')
    try {
      if (!isPreviewMode) {
        if (item.type === 'schedule') {
          await reviewWorkScheduleBatch(item.targetIds, status, note)
        } else if (item.type === 'leave') {
          await updateLeaveStatus(item.targetIds[0], status, authUser.uid, note)
        } else if (item.type === 'late') {
          await updateLateStatus(item.targetIds[0], status, authUser.uid, note)
        } else if (item.type === 'salary') {
          await updateSalaryAdvanceStatus(item.targetIds[0], status, authUser.uid, note)
        } else {
          await updateStaffRequestStatus(item.targetIds[0], status, note)
        }
      } else {
        setPendingItems((current) => current.filter((row) => row.id !== item.id))
      }
      setExpandedId(null)
      setScheduleOpenId(null)
    } catch {
      setMessage('Chưa thể xử lý yêu cầu này. Vui lòng thử lại.')
    } finally {
      setProcessingId(null)
    }
  }

  return (
    <main className="min-h-screen">
      <Header
        title="Thông báo"
        subtitle={isManagement ? 'Yêu cầu mới và kết quả xử lý theo tuần' : 'Cập nhật từ quản lý và hệ thống'}
      />
      <PageContainer>
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
          <button type="button" onClick={() => setWeekView('current')} className={`min-h-11 rounded-xl text-sm font-bold ${weekView === 'current' ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-950' : 'text-muted-foreground'}`}>Tuần này</button>
          <button type="button" onClick={() => setWeekView('previous')} className={`min-h-11 rounded-xl text-sm font-bold ${weekView === 'previous' ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-950' : 'text-muted-foreground'}`}>Tuần trước</button>
        </div>
        {!isManagement && !!visibleItems.some((item) => !item.isRead) && (
          <button
            onClick={markAll}
            className="mb-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-indigo-200 text-sm font-bold text-indigo-600"
          >
            <CheckCheck className="h-4 w-4" /> Đánh dấu tất cả đã đọc
          </button>
        )}
        {message && (
          <p aria-live="polite" className="mb-4 rounded-2xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">
            {message}
          </p>
        )}
        {loading ? (
          <div className="grid min-h-48 place-items-center">
            <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
          </div>
        ) : isManagement ? (
          <div className="space-y-3">
            {visiblePendingItems.map((item) => {
              const meta = managementMeta[item.type]
              const expanded = expandedId === item.id
              const currentSchedules = employeeSchedules[item.employeeId] || []
              const targetDates = item.type === 'schedule' || item.staffRequestType === 'scheduleChange' || item.staffRequestType === 'overtime'
                ? [...(item.shifts || []), ...(item.removedShifts || [])].map((shift) => shift.date)
                : []
              return (
                <article key={item.id} className={`mobile-card overflow-hidden transition ${expanded ? 'ring-2 ring-indigo-100 dark:ring-indigo-500/20' : ''}`}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => {
                      setExpandedId(expanded ? null : item.id)
                      setScheduleOpenId(null)
                      setMessage('')
                    }}
                    className="flex w-full items-start gap-3 p-4 text-left"
                  >
                    <IdentityAvatar name={item.employeeName} photoURL={item.employeePhotoURL} icon={meta.icon} color={meta.color} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="font-extrabold">{item.title}</h2>
                        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-amber-700">
                          Cần xử lý
                        </span>
                      </div>
                      <p className="mt-1 font-bold text-slate-800 dark:text-slate-100">
                        {item.employeeName}
                        {item.employeeCode ? ` · ${item.employeeCode}` : ''}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
                      <SubmissionStamp date={item.createdAt} targetDates={targetDates} />
                    </div>
                    <ChevronDown className={`mt-3 h-5 w-5 shrink-0 text-slate-400 transition ${expanded ? 'rotate-180' : ''}`} />
                  </button>

                  {expanded && (
                    <div className="border-t border-slate-100 px-4 pb-4 pt-3 dark:border-slate-800">
                      <div className="space-y-4">
                        {item.reason && (
                          <p className="rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                            <span className="font-bold">Nội dung:</span> {item.reason}
                          </p>
                        )}
                        <ShiftList
                          title={item.staffRequestType === 'overtime' ? 'Ca muốn làm thêm' : item.type === 'schedule' ? 'Lịch vừa gửi' : 'Ca muốn thêm / đổi'}
                          items={item.shifts}
                          tone={item.staffRequestType === 'overtime' ? 'emerald' : 'indigo'}
                        />
                        <ShiftList title="Ca muốn hủy" items={item.removedShifts} tone="rose" />

                        <button
                          type="button"
                          onClick={() => void toggleCurrentSchedule(item)}
                          className="flex min-h-11 w-full items-center justify-between rounded-xl border border-slate-200 px-3 text-sm font-extrabold dark:border-slate-700"
                        >
                          <span>{scheduleOpenId === item.id ? 'Ẩn lịch hiện tại' : 'Xem lịch hiện tại'}</span>
                          {scheduleLoadingId === item.id
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <ChevronDown className={`h-4 w-4 transition ${scheduleOpenId === item.id ? 'rotate-180' : ''}`} />}
                        </button>

                        {scheduleOpenId === item.id && scheduleLoadingId !== item.id && (
                          <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/70">
                            <p className="mb-2 text-xs font-black uppercase tracking-wide text-muted-foreground">
                              Lịch hiện tại của {item.employeeName}
                            </p>
                            {currentSchedules.length ? (
                              <div className="grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
                                {currentSchedules.map((schedule, index) => (
                                  <div key={schedule.id || index} className="rounded-xl bg-white px-3 py-2 text-sm dark:bg-slate-900">
                                    <p className="font-bold">{shiftStamp(schedule)}</p>
                                    <p className="mt-0.5 text-xs text-muted-foreground">{schedule.status}</p>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">Nhân viên chưa có lịch hiện tại.</p>
                            )}
                          </div>
                        )}

                        <textarea
                          value={reviewNotes[item.id] || ''}
                          onChange={(event) => setReviewNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                          placeholder="Ghi chú phản hồi (bắt buộc nếu từ chối)"
                          rows={2}
                          className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            disabled={processingId === item.id}
                            onClick={() => void processPending(item, 'Rejected')}
                            className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-200 font-extrabold text-rose-600 disabled:opacity-60"
                          >
                            <X className="h-4 w-4" /> Từ chối
                          </button>
                          <button
                            type="button"
                            disabled={processingId === item.id}
                            onClick={() => void processPending(item, 'Approved')}
                            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 font-extrabold text-white disabled:opacity-60"
                          >
                            {processingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            Duyệt
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </article>
              )
            })}
            {visibleManagementHistory.map((item) => {
              const createdAt = item.createdAt instanceof Date ? item.createdAt : item.createdAt.toDate()
              const expanded = expandedId === `history-${item.id}`
              return (
                <article key={item.id} className="mobile-card overflow-hidden">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : `history-${item.id}`)}
                    className="flex w-full gap-3 p-4 text-left"
                  >
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10"><CheckCheck className="h-5 w-5" /></div>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-extrabold">{item.title}</h2>
                      <p className={`mt-1 text-sm text-muted-foreground ${expanded ? '' : 'line-clamp-2'}`}>{item.message}</p>
                      <SubmissionStamp date={createdAt} />
                    </div>
                    <ChevronDown className={`mt-3 h-5 w-5 shrink-0 text-slate-400 transition ${expanded ? 'rotate-180' : ''}`} />
                  </button>
                </article>
              )
            })}
            {!visiblePendingItems.length && !visibleManagementHistory.length && (
              <div className="mobile-card p-8 text-center">
                <CheckCheck className="mx-auto h-8 w-8 text-emerald-600" />
                <h2 className="mt-3 font-extrabold">{weekView === 'current' ? 'Tuần này chưa có thông báo' : 'Tuần trước không có thông báo'}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Yêu cầu mới và kết quả xử lý sẽ xuất hiện tại đây.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {visibleItems.map((item) => {
              const createdAt = item.createdAt instanceof Date ? item.createdAt : item.createdAt.toDate()
              const meta = notificationMetaFor(item)
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void openNotification(item)}
                  className={`mobile-card flex w-full gap-3 p-4 text-left ${
                    !item.isRead ? 'border-indigo-200 bg-indigo-50/50 dark:bg-indigo-500/5' : ''
                  }`}
                >
                  <IdentityAvatar
                    name={managementContact?.fullName || 'Quản lý'}
                    photoURL={managementContact?.photoURL}
                    icon={meta.icon}
                    color={meta.color}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-extrabold">{item.title}</h2>
                      {!item.isRead && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-indigo-600" />}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{item.message}</p>
                    <SubmissionStamp date={createdAt} />
                  </div>
                  <ChevronRight className="mt-3 h-5 w-5 shrink-0 text-slate-400" />
                </button>
              )
            })}
            {!visibleItems.length && (
              <div className="mobile-card p-8 text-center font-bold">{weekView === 'current' ? 'Tuần này chưa có thông báo.' : 'Tuần trước không có thông báo.'}</div>
            )}
          </div>
        )}
      </PageContainer>
    </main>
  )
}
