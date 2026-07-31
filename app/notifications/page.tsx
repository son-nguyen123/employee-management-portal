'use client'

import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileText,
  ExternalLink,
  Loader2,
  MessageSquareText,
  Phone,
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
  schedule: { icon: CalendarDays, color: 'bg-indigo-600', gradient: 'from-indigo-500 via-violet-500 to-fuchsia-600', soft: 'bg-indigo-50 text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-100' },
  leave: { icon: FileText, color: 'bg-emerald-600', gradient: 'from-emerald-500 via-emerald-600 to-teal-700', soft: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-100' },
  late: { icon: Clock3, color: 'bg-amber-500', gradient: 'from-amber-400 via-orange-500 to-orange-600', soft: 'bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-100' },
  salary: { icon: CircleDollarSign, color: 'bg-sky-600', gradient: 'from-sky-500 via-blue-600 to-indigo-600', soft: 'bg-sky-50 text-sky-800 dark:bg-sky-500/10 dark:text-sky-100' },
  staff: { icon: MessageSquareText, color: 'bg-fuchsia-600', gradient: 'from-fuchsia-500 via-violet-600 to-indigo-600', soft: 'bg-fuchsia-50 text-fuchsia-800 dark:bg-fuchsia-500/10 dark:text-fuchsia-100' },
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

function CompactShiftList({
  title,
  items,
  className,
}: {
  title: string
  items?: ManagementShift[]
  className: string
}) {
  if (!items?.length) return null
  const grouped = new Map<string, { date: Date; shifts: ManagementShift['shift'][] }>()
  items.forEach((item) => {
    const key = item.date.toISOString().slice(0, 10)
    const current = grouped.get(key) || { date: item.date, shifts: [] }
    if (!current.shifts.includes(item.shift)) current.shifts.push(item.shift)
    grouped.set(key, current)
  })
  const rows = [...grouped.values()].sort((left, right) => left.date.getTime() - right.date.getTime())

  return (
    <section>
      <p className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-muted-foreground">{title}</p>
      <div className="overflow-hidden rounded-2xl border border-slate-100 dark:border-white/10">
        {rows.map((row) => (
          <div key={row.date.toISOString()} className="grid grid-cols-[minmax(7.5rem,.9fr)_1.1fr] items-center gap-3 border-b border-slate-100 px-3 py-3 last:border-b-0 dark:border-white/10">
            <p className="font-extrabold">
              {row.date.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })}
            </p>
            <p className={`rounded-xl px-3 py-2 text-sm font-bold ${className}`}>
              {row.shifts.map((shift) => shiftNames[shift].replace('Ca ', '')).join(' – ')}
            </p>
          </div>
        ))}
      </div>
    </section>
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
  const [selectedPending, setSelectedPending] = useState<ManagementPendingItem | null>(null)
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null)
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
          employeePhone: '0901 234 567',
          employeeFacebookURL: 'https://www.facebook.com/',
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
    setSelectedPending(null)
    setSelectedNotification(null)
    setScheduleOpenId(null)
  }, [weekView])

  useEffect(() => {
    if (!selectedPending && !selectedNotification) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [selectedNotification, selectedPending])

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
    if (content.includes('phạt')) return { icon: AlertTriangle, color: 'bg-rose-600', gradient: 'from-rose-500 via-rose-600 to-red-700', soft: 'bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-100' }
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
    setSelectedNotification(item)
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
    let penaltyAmount: number | undefined
    if (item.type === 'leave' || item.type === 'late') {
      const suggested = status === 'Approved' ? item.penaltyIfApproved || 0 : item.penaltyIfRejected || 0
      const entered = window.prompt(
        `Mức trừ đề xuất là ${suggested.toLocaleString('vi-VN')}đ. Nhập mức trừ muốn áp dụng (nhập 0 nếu không trừ):`,
        String(suggested)
      )
      if (entered === null) return
      penaltyAmount = Number(entered.replace(/[^0-9]/g, ''))
      if (!Number.isFinite(penaltyAmount) || penaltyAmount < 0) {
        setMessage('Mức trừ không hợp lệ.')
        return
      }
      if (penaltyAmount > 0 && !window.confirm(`Xác nhận áp dụng mức trừ ${penaltyAmount.toLocaleString('vi-VN')}đ?`)) return
    }
    setProcessingId(item.id)
    setMessage('')
    try {
      if (!isPreviewMode) {
        if (item.type === 'schedule') {
          await reviewWorkScheduleBatch(item.targetIds, status, note)
        } else if (item.type === 'leave') {
          await updateLeaveStatus(item.targetIds[0], status, authUser.uid, note, penaltyAmount)
        } else if (item.type === 'late') {
          await updateLateStatus(item.targetIds[0], status, authUser.uid, note, penaltyAmount)
        } else if (item.type === 'salary') {
          await updateSalaryAdvanceStatus(item.targetIds[0], status, authUser.uid, note)
        } else {
          await updateStaffRequestStatus(item.targetIds[0], status, note)
        }
      } else {
        setPendingItems((current) => current.filter((row) => row.id !== item.id))
      }
      setSelectedPending(null)
      setScheduleOpenId(null)
    } catch {
      setMessage('Chưa thể xử lý yêu cầu này. Vui lòng thử lại.')
    } finally {
      setProcessingId(null)
    }
  }

  const selectedPendingMeta = selectedPending ? managementMeta[selectedPending.type] : null
  const selectedCurrentSchedules = selectedPending ? employeeSchedules[selectedPending.employeeId] || [] : []
  const selectedNotificationMeta = selectedNotification ? notificationMetaFor(selectedNotification) : null

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
              const targetDates = item.type === 'schedule' || item.staffRequestType === 'scheduleChange' || item.staffRequestType === 'overtime'
                ? [...(item.shifts || []), ...(item.removedShifts || [])].map((shift) => shift.date)
                : []
              return (
                <article key={item.id} className="mobile-card overflow-hidden transition active:scale-[0.99]">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPending(item)
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
                    <ChevronRight className="mt-3 h-5 w-5 shrink-0 text-slate-400" />
                  </button>
                </article>
              )
            })}
            {visibleManagementHistory.map((item) => {
              const createdAt = item.createdAt instanceof Date ? item.createdAt : item.createdAt.toDate()
              return (
                <article key={item.id} className="mobile-card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setSelectedNotification(item)}
                    className="flex w-full gap-3 p-4 text-left"
                  >
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10"><CheckCheck className="h-5 w-5" /></div>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-extrabold">{item.title}</h2>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.message}</p>
                      <SubmissionStamp date={createdAt} />
                    </div>
                    <ChevronRight className="mt-3 h-5 w-5 shrink-0 text-slate-400" />
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

      {selectedPending && selectedPendingMeta && (
        <div className="fixed inset-0 z-[75] overflow-y-auto bg-slate-100 dark:bg-slate-950">
          <header className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/95 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95">
            <div className="mx-auto flex min-h-20 max-w-lg items-center gap-3 px-4 pt-[env(safe-area-inset-top)]">
              <button type="button" onClick={() => setSelectedPending(null)} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-100 dark:bg-slate-800" aria-label="Quay lại danh sách thông báo">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div><h1 className="text-lg font-black">Chi tiết yêu cầu</h1><p className="text-sm text-muted-foreground">Xem thông tin và xử lý công việc</p></div>
            </div>
          </header>

          <main className="mx-auto max-w-lg p-3 pb-[calc(2rem+env(safe-area-inset-bottom))]">
            <article className="overflow-hidden rounded-[2rem] border border-white bg-white shadow-xl shadow-slate-950/10 dark:border-white/10 dark:bg-slate-900">
              <section className={`bg-gradient-to-br ${selectedPendingMeta.gradient} p-5 text-white`}>
                <div className="flex items-start gap-3">
                  <IdentityAvatar name={selectedPending.employeeName} photoURL={selectedPending.employeePhotoURL} icon={selectedPendingMeta.icon} color={selectedPendingMeta.color} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-xl font-black leading-tight">{selectedPending.title}</h2>
                      <span className="shrink-0 rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide backdrop-blur">Cần xử lý</span>
                    </div>
                    <p className="mt-2 font-extrabold">{selectedPending.employeeName}{selectedPending.employeeCode ? ` · ${selectedPending.employeeCode}` : ''}</p>
                    <p className="mt-1 text-sm font-medium text-white/85">{selectedPending.detail}</p>
                    <p className="mt-2 text-xs font-semibold text-white/80">Gửi lúc {selectedPending.createdAt.toLocaleDateString('vi-VN')} · {selectedPending.createdAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2">
                  {selectedPending.employeePhone ? (
                    <a href={`tel:${selectedPending.employeePhone.replace(/\s/g, '')}`} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white/15 px-3 text-sm font-extrabold backdrop-blur transition active:scale-[0.98]"><Phone className="h-4 w-4" /> Gọi điện</a>
                  ) : <span className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white/10 px-3 text-sm font-bold text-white/60"><Phone className="h-4 w-4" /> Chưa có SĐT</span>}
                  {selectedPending.employeeFacebookURL ? (
                    <a href={selectedPending.employeeFacebookURL} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-3 text-sm font-extrabold shadow-lg shadow-blue-950/15 transition active:scale-[0.98]"><ExternalLink className="h-4 w-4" /> Facebook</a>
                  ) : <span className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white/10 px-3 text-sm font-bold text-white/60"><ExternalLink className="h-4 w-4" /> Chưa có link</span>}
                </div>
              </section>

              <section className="space-y-5 p-4">
                {selectedPending.warning && (
                  <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold leading-6 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">⚠ {selectedPending.warning}</p>
                )}
                {selectedPending.managerMessageStatus && (
                  <p className="rounded-2xl bg-sky-50 p-3 text-sm font-semibold text-sky-900 dark:bg-sky-500/10 dark:text-sky-100">
                    Xác nhận liên hệ: {selectedPending.managerMessageStatus === 'messagedTri' ? 'đã nhắn anh Trí' : selectedPending.managerMessageStatus === 'notMessaged' ? 'chưa nhắn riêng' : 'đã nhắn quản lý khác'}.
                  </p>
                )}
                {selectedPending.reason && (
                  <p className="rounded-2xl bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:bg-slate-800 dark:text-slate-200"><span className="font-black">Ghi chú:</span> {selectedPending.reason}</p>
                )}
                <CompactShiftList
                  title={selectedPending.staffRequestType === 'overtime' ? 'Ca muốn làm thêm' : selectedPending.type === 'schedule' ? 'Lịch vừa gửi' : 'Ca muốn thêm / đổi'}
                  items={selectedPending.shifts}
                  className={selectedPendingMeta.soft}
                />
                <CompactShiftList title="Ca muốn hủy" items={selectedPending.removedShifts} className="bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-100" />

                <button type="button" onClick={() => void toggleCurrentSchedule(selectedPending)} className="flex min-h-12 w-full items-center justify-between rounded-2xl border border-slate-200 px-4 text-sm font-extrabold dark:border-slate-700">
                  <span>{scheduleOpenId === selectedPending.id ? 'Ẩn lịch hiện tại' : 'Xem lịch hiện tại'}</span>
                  {scheduleLoadingId === selectedPending.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className={`h-4 w-4 transition ${scheduleOpenId === selectedPending.id ? 'rotate-180' : ''}`} />}
                </button>
                {scheduleOpenId === selectedPending.id && scheduleLoadingId !== selectedPending.id && (
                  selectedCurrentSchedules.length
                    ? <CompactShiftList title="Lịch hiện tại" items={selectedCurrentSchedules} className="bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100" />
                    : <p className="rounded-2xl bg-slate-50 p-4 text-sm text-muted-foreground dark:bg-slate-800">Nhân viên chưa có lịch hiện tại.</p>
                )}

                <textarea value={reviewNotes[selectedPending.id] || ''} onChange={(event) => setReviewNotes((current) => ({ ...current, [selectedPending.id]: event.target.value }))} placeholder="Ghi chú phản hồi (bắt buộc nếu từ chối)" rows={3} className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900" />
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" disabled={processingId === selectedPending.id} onClick={() => void processPending(selectedPending, 'Rejected')} className="flex min-h-13 items-center justify-center gap-2 rounded-2xl border border-rose-200 font-extrabold text-rose-600 disabled:opacity-60"><X className="h-4 w-4" /> Từ chối</button>
                  <button type="button" disabled={processingId === selectedPending.id} onClick={() => void processPending(selectedPending, 'Approved')} className={`flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r ${selectedPendingMeta.gradient} font-extrabold text-white shadow-lg disabled:opacity-60`}>{processingId === selectedPending.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Xác nhận</button>
                </div>
              </section>
            </article>
          </main>
        </div>
      )}

      {selectedNotification && selectedNotificationMeta && (
        <div className="fixed inset-0 z-[75] overflow-y-auto bg-slate-100 dark:bg-slate-950">
          <header className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/95 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95">
            <div className="mx-auto flex min-h-20 max-w-lg items-center gap-3 px-4 pt-[env(safe-area-inset-top)]">
              <button type="button" onClick={() => setSelectedNotification(null)} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-100 dark:bg-slate-800" aria-label="Quay lại danh sách thông báo"><ArrowLeft className="h-5 w-5" /></button>
              <div><h1 className="text-lg font-black">Chi tiết thông báo</h1><p className="text-sm text-muted-foreground">Thông tin từ quản lý và hệ thống</p></div>
            </div>
          </header>
          <main className="mx-auto max-w-lg p-3 pb-[calc(2rem+env(safe-area-inset-bottom))]">
            <article className="overflow-hidden rounded-[2rem] bg-white shadow-xl shadow-slate-950/10 dark:bg-slate-900">
              <section className={`bg-gradient-to-br ${selectedNotificationMeta.gradient} p-5 text-white`}>
                <div className="flex items-start gap-3">
                  <IdentityAvatar name={managementContact?.fullName || 'Quản lý'} photoURL={managementContact?.photoURL} icon={selectedNotificationMeta.icon} color={selectedNotificationMeta.color} />
                  <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-[0.14em] text-white/75">{managementContact?.fullName || 'Trí Candy'}</p><h2 className="mt-1 text-xl font-black leading-tight">{selectedNotification.title}</h2><p className="mt-2 text-xs font-semibold text-white/80">{(selectedNotification.createdAt instanceof Date ? selectedNotification.createdAt : selectedNotification.createdAt.toDate()).toLocaleDateString('vi-VN')} · {(selectedNotification.createdAt instanceof Date ? selectedNotification.createdAt : selectedNotification.createdAt.toDate()).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</p></div>
                </div>
              </section>
              <section className="p-4"><p className="rounded-2xl bg-slate-50 p-4 text-sm font-medium leading-7 text-slate-700 dark:bg-slate-800 dark:text-slate-200">{selectedNotification.message}</p><button type="button" onClick={() => router.push(destinationFor(selectedNotification))} className={`mt-5 flex min-h-13 w-full items-center justify-between rounded-2xl bg-gradient-to-r ${selectedNotificationMeta.gradient} px-5 font-extrabold text-white shadow-lg`}><span>Mở tính năng liên quan</span><ChevronRight className="h-5 w-5" /></button></section>
            </article>
          </main>
        </div>
      )}
    </main>
  )
}
