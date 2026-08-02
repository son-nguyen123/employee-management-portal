'use client'

import { useEffect, useMemo, useState } from 'react'
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
  Search,
  ShieldCheck,
  UserRound,
  X,
  RotateCcw,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { useAuth, useUserRole } from '@/lib/hooks/useAuth'
import type { Notification } from '@/lib/models/types'
import type { EmployeeReviewContext, EmployeeReviewLevel } from '@/lib/models/employeeReview'
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
import { updateSalaryAdvanceStatus } from '@/lib/services/salaryService'
import {
  reviewWorkScheduleBatch,
} from '@/lib/services/scheduleService'
import { updateStaffRequestStatus } from '@/lib/services/staffRequestService'
import { getManagementContact } from '@/lib/services/managementSettingsService'
import { profileImageUrl } from '@/lib/utils/profileImage'
import { subscribeToWeeklyDecisionHistory, type DecisionHistoryItem } from '@/lib/services/decisionHistoryService'
import { setEmployeeAccountStatus, subscribeToAllEmployees } from '@/lib/services/employeeService'
import type { Employee } from '@/lib/models/types'
import { getEmployeeReviewContext } from '@/lib/services/employeeReviewService'

type WeekView = 'current' | 'previous'

function weekWindow(view: WeekView) {
  const now = new Date()
  const monday = new Date(now)
  const weekday = monday.getDay() || 7
  monday.setDate(monday.getDate() - weekday + 1 + (view === 'previous' ? -7 : 0))
  monday.setHours(0, 0, 0, 0)
  const end = new Date(monday)
  end.setDate(monday.getDate() + 7)
  return { start: monday, end }
}

const managementMeta = {
  account: { icon: UserRound, color: 'bg-fuchsia-600', gradient: 'from-fuchsia-500 via-pink-500 to-rose-500', soft: 'bg-fuchsia-50 text-fuchsia-800 dark:bg-fuchsia-500/10 dark:text-fuchsia-100' },
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

function SimpleShiftList({ title, items }: { title: string; items?: ManagementShift[] }) {
  if (!items?.length) return null
  const grouped = new Map<string, { date: Date; shifts: ManagementShift['shift'][] }>()
  items.forEach((item) => {
    const key = item.date.toISOString().slice(0, 10)
    const current = grouped.get(key) || { date: item.date, shifts: [] }
    if (!current.shifts.includes(item.shift)) current.shifts.push(item.shift)
    grouped.set(key, current)
  })
  return (
    <section>
      <p className="mb-1 text-xs font-black uppercase tracking-[0.12em] text-muted-foreground">{title}</p>
      <div className="divide-y divide-slate-100 dark:divide-white/10">
        {[...grouped.values()].sort((a, b) => a.date.getTime() - b.date.getTime()).map((row) => (
          <div key={row.date.toISOString()} className="grid grid-cols-[minmax(7rem,.85fr)_1.15fr] gap-3 py-4">
            <p className="font-black capitalize">{row.date.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })}</p>
            <p className="text-slate-500 dark:text-slate-300">{row.shifts.map((shift) => shiftNames[shift].replace('Ca ', '')).join(' – ')}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

const reviewTone: Record<EmployeeReviewLevel, { label: string; rating: string; box: string; badge: string }> = {
  stable: {
    label: 'Tốt',
    rating: 'Tốt',
    box: 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100',
    badge: 'bg-emerald-600 text-white',
  },
  attention: {
    label: 'Lưu ý',
    rating: 'Khá',
    box: 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100',
    badge: 'bg-amber-500 text-white',
  },
  warning: {
    label: 'Cảnh báo',
    rating: 'Tệ',
    box: 'border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100',
    badge: 'bg-rose-600 text-white',
  },
  neutral: {
    label: 'Chưa đủ dữ liệu',
    rating: 'Cần xem xét',
    box: 'border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100',
    badge: 'bg-slate-600 text-white',
  },
}

function quickReview(item: ManagementPendingItem): { level: EmployeeReviewLevel; text: string } {
  if (item.warning) return { level: 'attention', text: item.warning }
  if (item.type === 'schedule') return { level: 'stable', text: 'Lịch vừa gửi đạt số ca tối thiểu theo luật hiện tại.' }
  if (item.type === 'leave') return { level: 'attention', text: 'Cần đối chiếu số ca và các yêu cầu trong 4 tuần gần nhất.' }
  if (item.type === 'late') return { level: 'attention', text: 'Cần kiểm tra thời điểm báo và lịch sử đi trễ gần đây.' }
  if (item.type === 'staff') return { level: 'attention', text: 'Cần xem ảnh hưởng của thay đổi này tới lịch làm.' }
  return { level: 'neutral', text: 'Yêu cầu này không tự động dùng để đánh giá chuyên cần.' }
}

function ReviewAssessment({
  context,
  requestWarning,
  loading,
  error,
  onRetry,
}: {
  context?: EmployeeReviewContext
  requestWarning?: string
  loading: boolean
  error: string
  onRetry: () => void
}) {
  if (loading) {
    return <div className="flex min-h-28 items-center justify-center gap-2 rounded-3xl border border-indigo-100 bg-indigo-50 text-sm font-bold text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-100"><Loader2 className="h-4 w-4 animate-spin" /> Đang đối chiếu 4 tuần và kho lưu trữ…</div>
  }
  if (!context) {
    return <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-rose-950 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100"><p className="font-black">Chưa tải được bản đánh giá</p><p className="mt-1 text-sm leading-6 opacity-80">{error || 'Hệ thống chưa nhận được kết quả tổng hợp. Đây là lỗi tải dữ liệu, không phải kết luận rằng nhân viên không có dữ liệu.'}</p><button type="button" onClick={onRetry} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-extrabold text-white"><RotateCcw className="h-4 w-4" /> Thử tải lại</button></div>
  }
  const level = requestWarning && context.level === 'stable' ? 'attention' : context.level
  const tone = reviewTone[level]
  return (
    <section className={`rounded-3xl border p-4 ${tone.box}`}>
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white/80 shadow-sm dark:bg-slate-950/40"><ShieldCheck className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><p className="font-black">Đánh giá hỗ trợ quản lý</p><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${tone.badge}`}>{tone.label}</span></div>
          <p className="mt-3 text-sm font-bold opacity-75">Quá trình làm việc</p>
          <h3 className="mt-0.5 text-2xl font-black">{tone.rating}</h3>
        </div>
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
  const [weekView, setWeekView] = useState<WeekView>('current')
  const [selectedPending, setSelectedPending] = useState<ManagementPendingItem | null>(null)
  const [rejectIntentId, setRejectIntentId] = useState<string | null>(null)
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null)
  const [reviewContexts, setReviewContexts] = useState<Record<string, EmployeeReviewContext>>({})
  const [reviewLoadingId, setReviewLoadingId] = useState<string | null>(null)
  const [reviewError, setReviewError] = useState('')
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [allowSundayResubmissionWithoutPenalty, setAllowSundayResubmissionWithoutPenalty] = useState(false)
  const [managementContact, setManagementContact] = useState<ManagementContact | null>(null)
  const [decisions, setDecisions] = useState<DecisionHistoryItem[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [selectedDecision, setSelectedDecision] = useState<DecisionHistoryItem | null>(null)
  const [undoReason, setUndoReason] = useState('')

  const visibleItems = items.filter((item) => {
    const createdAt = item.createdAt instanceof Date ? item.createdAt : item.createdAt.toDate()
    const window = weekWindow(weekView)
    return createdAt >= window.start && createdAt < window.end
  })
  const visiblePendingItems = pendingItems.filter((item) => {
    const window = weekWindow(weekView)
    return item.createdAt >= window.start && item.createdAt < window.end && (item.type !== 'account' || role === 'admin')
  })
  const visibleManagementHistory = [...decisions].sort((left, right) => Number(left.status === 'Approved') - Number(right.status === 'Approved'))
  const unreadItems = visibleItems.filter((item) => !item.isRead)
  const readItems = visibleItems.filter((item) => item.isRead)
  const employeeMap = useMemo(() => new Map(employees.map((employee) => [employee.uid, employee])), [employees])

  useEffect(() => {
    if (!authUser) return

    if (isPreviewMode) {
      if (isManagement) {
        const previewNow = new Date()
        setEmployees([{
          uid: 'demo-user-001',
          employeeCode: 'NV-001',
          fullName: 'Nguyễn Minh An',
          phone: '0901 234 567',
          email: 'minhan@example.test',
          role: 'employee',
          status: 'active',
          joinDate: previewNow,
          createdAt: previewNow,
          updatedAt: previewNow,
        }])
        setDecisions([{
          key: 'schedule:preview-approved',
          id: 'preview-approved',
          ids: ['preview-approved'],
          resource: 'schedule',
          employeeId: 'demo-user-001',
          title: 'Lịch làm đã duyệt',
          detail: '6 ca · tuần hiện tại',
          status: 'Approved',
          reviewNote: '',
          reviewedAt: previewNow,
          shifts: [
            { date: previewNow, shift: 'Morning' },
            { date: new Date(previewNow.getTime() + 86400000), shift: 'Afternoon' },
          ],
        }])
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
          referenceDate: new Date(),
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
          setPendingItems(pending.filter((item) => item.type !== 'account' || role === 'admin'))
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
      const window = weekWindow(weekView)
      const unsubscribeHistory = subscribeToWeeklyDecisionHistory(window.start, new Date(window.end.getTime() - 1), setDecisions, () => setMessage('Chưa thể tải các quyết định đã xử lý.'))
      const unsubscribeEmployees = subscribeToAllEmployees(setEmployees, () => undefined)
      return () => {
        unsubscribePending()
        unsubscribeNotifications()
        unsubscribeHistory()
        unsubscribeEmployees()
      }
    }

    return subscribeToEmployeeNotifications(authUser.uid, (notifications) => {
      setItems(notifications)
      setLoading(false)
    })
  }, [authUser, isManagement, isPreviewMode, weekView])

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
    setSelectedDecision(null)
  }, [weekView])

  useEffect(() => {
    if (!selectedPending && !selectedNotification && !selectedDecision) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [selectedDecision, selectedNotification, selectedPending])

  const changeDecision = async (item: DecisionHistoryItem) => {
    if (!authUser || processingId) return
    const nextStatus = item.status === 'Approved' ? 'Rejected' : 'Approved'
    if (nextStatus === 'Rejected' && !undoReason.trim()) {
      setMessage('Vui lòng nhập lý do trước khi chuyển thành từ chối.')
      return
    }
    setProcessingId(item.key)
    try {
      const note = nextStatus === 'Rejected' ? undoReason.trim() : ''
      if (!isPreviewMode) {
        if (item.resource === 'schedule') await reviewWorkScheduleBatch(item.ids, nextStatus, note)
        if (item.resource === 'leave') await updateLeaveStatus(item.id, nextStatus, authUser.uid, note)
        if (item.resource === 'late') await updateLateStatus(item.id, nextStatus, authUser.uid, note)
        if (item.resource === 'salary') await updateSalaryAdvanceStatus(item.id, nextStatus, authUser.uid, note)
        if (item.resource === 'staff') await updateStaffRequestStatus(item.id, nextStatus, note)
      }
      setDecisions((current) => current.map((row) => row.key === item.key ? { ...row, status: nextStatus, reviewNote: note, reviewedAt: new Date() } : row))
      setSelectedDecision((current) => current ? { ...current, status: nextStatus, reviewNote: note, reviewedAt: new Date() } : null)
      setUndoReason('')
      setMessage(`Đã hoàn tác và chuyển quyết định thành ${nextStatus === 'Approved' ? 'Duyệt' : 'Từ chối'}.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể hoàn tác quyết định.')
    } finally {
      setProcessingId(null)
    }
  }

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

  const openPending = async (item: ManagementPendingItem, intent: 'inspect' | 'reject' = 'inspect') => {
    setAllowSundayResubmissionWithoutPenalty(false)
    setSelectedPending(item)
    setRejectIntentId(intent === 'reject' ? item.id : null)
    setMessage('')
    setReviewError('')
    if (item.type === 'account' || reviewContexts[item.id]) return
    if (isPreviewMode) {
      setReviewContexts((current) => ({
        ...current,
        [item.id]: {
          employeeId: item.employeeId,
          referenceWeekStart: item.referenceDate.toISOString().slice(0, 10),
          minimumWeeklyShifts: 6,
          level: 'attention',
          headline: 'Có yếu tố cần xem xét',
          explanation: 'Lịch có thay đổi. Nên kiểm tra hoàn cảnh trước khi quyết định.',
          facts: ['2/4 tuần có lịch · 1 tuần dưới 6 ca.', '1 yêu cầu đổi lịch.'],
          weeks: [],
          archiveUsed: false,
          archiveAvailable: false,
          disclaimer: 'Chỉ là cảnh báo từ dữ liệu trên app, không kết luận nhân viên.',
        },
      }))
      return
    }
    setReviewLoadingId(item.id)
    try {
      const context = await getEmployeeReviewContext(item.employeeId, item.referenceDate)
      setReviewContexts((current) => ({ ...current, [item.id]: context }))
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Chưa thể tải đánh giá nhân viên.')
    } finally {
      setReviewLoadingId(null)
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
        if (item.type === 'account') {
          if (role !== 'admin') throw new Error('Chá»‰ admin Ä‘Æ°á»£c duyá»‡t tÃ i khoáº£n.')
          await setEmployeeAccountStatus(item.employeeId, status === 'Approved' ? 'active' : 'inactive')
        } else if (item.type === 'schedule') {
          await reviewWorkScheduleBatch(item.targetIds, status, note, allowSundayResubmissionWithoutPenalty)
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
      setRejectIntentId(null)
    } catch {
      setMessage('Chưa thể xử lý yêu cầu này. Vui lòng thử lại.')
    } finally {
      setProcessingId(null)
    }
  }

  const selectedPendingMeta = selectedPending ? managementMeta[selectedPending.type] : null
  const selectedReview = selectedPending ? reviewContexts[selectedPending.id] : undefined
  const selectedNotificationMeta = selectedNotification ? notificationMetaFor(selectedNotification) : null

  return (
    <main className="min-h-screen">
      <Header
        title="Thông báo"
        subtitle={isManagement ? 'Yêu cầu mới và kết quả xử lý theo tuần' : 'Cập nhật từ quản lý và hệ thống'}
      />
      <PageContainer>
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
          <button type="button" onClick={() => setWeekView('previous')} className={`min-h-11 rounded-xl text-sm font-bold ${weekView === 'previous' ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-950' : 'text-muted-foreground'}`}>Tuần trước</button>
          <button type="button" onClick={() => setWeekView('current')} className={`min-h-11 rounded-xl text-sm font-bold ${weekView === 'current' ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-950' : 'text-muted-foreground'}`}>Tuần này</button>
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
              const quick = quickReview(item)
              const quickTone = reviewTone[quick.level]
              const targetDates = item.type === 'schedule' || item.staffRequestType === 'scheduleChange' || item.staffRequestType === 'overtime'
                ? [...(item.shifts || []), ...(item.removedShifts || [])].map((shift) => shift.date)
                : []
              return (
                <article key={item.id} className={`mobile-card overflow-hidden ${item.type === 'account' ? 'border-dashed bg-transparent' : ''}`}>
                  <div className="flex w-full items-start gap-3 p-4 text-left">
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
                  </div>
                  <div className={`mx-4 rounded-2xl border p-3 ${quickTone.box}`}>
                    <div className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wide ${quickTone.badge}`}>{quickTone.label}</span><p className="text-xs font-black uppercase tracking-wide">Đánh giá nhanh</p></div>
                    <p className="mt-2 text-sm font-semibold leading-5">{quick.text}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 p-4">
                    <button type="button" onClick={() => void openPending(item, 'reject')} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-rose-200 font-extrabold text-rose-600 transition active:scale-[0.98]"><X className="h-4 w-4" /> Từ chối</button>
                    <button type="button" onClick={() => void openPending(item, 'inspect')} className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r ${meta.gradient} font-extrabold text-white shadow-lg transition active:scale-[0.98]`}><Search className="h-4 w-4" /> Kiểm tra</button>
                  </div>
                </article>
              )
            })}
            {visiblePendingItems.length > 0 && visibleManagementHistory.length > 0 && <div className="flex items-center gap-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400"><span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" /><span>Đã xử lý</span><span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" /></div>}
            {visibleManagementHistory.map((item) => {
              const employee = employeeMap.get(item.employeeId)
              const meta = managementMeta[item.resource]
              return (
                <article key={item.key} className="mobile-card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => { setSelectedDecision(item); setUndoReason(''); setMessage('') }}
                    className="flex w-full gap-3 p-4 text-left"
                  >
                    <IdentityAvatar name={employee?.fullName || 'Nhân viên'} photoURL={employee?.photoURL} icon={meta.icon} color={meta.color} />
                    <div className="min-w-0 flex-1">
                      <h2 className="font-extrabold">{item.title}</h2>
                      <p className="mt-1 font-bold">{employee?.fullName || item.employeeId}{employee?.employeeCode ? ` · ${employee.employeeCode}` : ''}</p>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.detail}</p>
                      <p className={`mt-2 text-xs font-bold ${item.status === 'Approved' ? 'text-emerald-600' : 'text-rose-600'}`}>{item.status === 'Approved' ? 'Đã duyệt' : 'Đã từ chối'} · có thể mở lại và hoàn tác</p>
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
            {unreadItems.map((item) => {
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
            {unreadItems.length > 0 && readItems.length > 0 && <div className="flex items-center gap-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400"><span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" /><span>Đã xem</span><span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" /></div>}
            {readItems.map((item) => {
              const createdAt = item.createdAt instanceof Date ? item.createdAt : item.createdAt.toDate()
              const meta = notificationMetaFor(item)
              return (
                <button key={item.id} type="button" onClick={() => void openNotification(item)} className="mobile-card flex w-full gap-3 p-4 text-left">
                  <IdentityAvatar name={managementContact?.fullName || 'Quản lý'} photoURL={managementContact?.photoURL} icon={meta.icon} color={meta.color} />
                  <div className="min-w-0 flex-1"><h2 className="font-extrabold">{item.title}</h2><p className="mt-1 text-sm text-muted-foreground">{item.message}</p><SubmissionStamp date={createdAt} /></div>
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
        <div className="fixed inset-0 z-[75] grid place-items-center overflow-hidden bg-slate-950/45 p-3 backdrop-blur-sm sm:p-6">
          <div role="dialog" aria-modal="true" aria-labelledby="employee-review-title" className="flex max-h-[min(88dvh,760px)] w-full max-w-lg flex-col overflow-hidden rounded-[2rem] border border-white/70 bg-white shadow-2xl shadow-slate-950/30 dark:border-white/10 dark:bg-slate-900">
          <header className="z-10 shrink-0 border-b border-slate-200/70 bg-white/95 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/95">
            <div className="flex min-h-18 items-center gap-3 px-4">
              <button type="button" onClick={() => { setSelectedPending(null); setRejectIntentId(null) }} className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-100 transition hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700" aria-label="Đóng kiểm tra">
                <X className="h-5 w-5" />
              </button>
              <div><h1 id="employee-review-title" className="text-lg font-black">{rejectIntentId === selectedPending.id ? 'Từ chối yêu cầu' : 'Kiểm tra nhân viên'}</h1><p className="text-sm text-muted-foreground">{rejectIntentId === selectedPending.id ? 'Nhập lý do trước khi xác nhận' : 'Đánh giá nhanh rồi mới quyết định'}</p></div>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <article className="overflow-hidden bg-white dark:bg-slate-900">
              <section className={`bg-gradient-to-br ${selectedPendingMeta.gradient} p-4 text-white`}>
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
              </section>

              <section className="space-y-5 p-4">
                {selectedPending.type !== 'account' && <ReviewAssessment context={selectedReview} requestWarning={selectedPending.warning} loading={reviewLoadingId === selectedPending.id} error={reviewError} onRetry={() => void openPending(selectedPending)} />}
                {selectedPending.managerMessageStatus && (
                  <p className="rounded-2xl bg-sky-50 p-3 text-sm font-semibold text-sky-900 dark:bg-sky-500/10 dark:text-sky-100">
                    Xác nhận liên hệ: {selectedPending.managerMessageStatus === 'messagedTri' ? 'đã nhắn anh Trí' : selectedPending.managerMessageStatus === 'notMessaged' ? 'chưa nhắn riêng' : 'đã nhắn quản lý khác'}.
                  </p>
                )}
                {selectedPending.reason && (
                  <p className="rounded-2xl bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:bg-slate-800 dark:text-slate-200"><span className="font-black">Ghi chú:</span> {selectedPending.reason}</p>
                )}
                <details className="rounded-2xl border border-slate-200 dark:border-slate-700">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-black"><span>Kiểm tra thêm yêu cầu và liên hệ</span><ChevronDown className="h-4 w-4" /></summary>
                  <div className="space-y-4 border-t border-slate-100 p-4 dark:border-slate-700">
                    <div className="grid grid-cols-2 gap-2">
                      {selectedPending.employeePhone ? <a href={`tel:${selectedPending.employeePhone.replace(/\s/g, '')}`} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-slate-100 text-sm font-extrabold dark:bg-slate-800"><Phone className="h-4 w-4" /> Gọi điện</a> : <span className="flex min-h-11 items-center justify-center rounded-2xl bg-slate-100 text-xs font-bold text-slate-400 dark:bg-slate-800">Chưa có SĐT</span>}
                      {selectedPending.employeeFacebookURL ? <a href={selectedPending.employeeFacebookURL} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-blue-600 text-sm font-extrabold text-white"><ExternalLink className="h-4 w-4" /> Facebook</a> : <span className="flex min-h-11 items-center justify-center rounded-2xl bg-slate-100 text-xs font-bold text-slate-400 dark:bg-slate-800">Chưa có Facebook</span>}
                    </div>
                    <SimpleShiftList title={selectedPending.staffRequestType === 'overtime' ? 'Ca muốn làm thêm' : selectedPending.type === 'schedule' ? 'Lịch vừa gửi' : 'Ca muốn thêm / đổi'} items={selectedPending.shifts} />
                    <SimpleShiftList title="Ca muốn hủy" items={selectedPending.removedShifts} />
                  </div>
                </details>

                <textarea value={reviewNotes[selectedPending.id] || ''} onChange={(event) => setReviewNotes((current) => ({ ...current, [selectedPending.id]: event.target.value }))} placeholder={rejectIntentId === selectedPending.id ? 'Nhập lý do từ chối…' : 'Ghi chú phản hồi (bắt buộc nếu từ chối)'} rows={3} autoFocus={rejectIntentId === selectedPending.id} className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base leading-6 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900" />
                {selectedPending.type === 'schedule' && new Date().getDay() === 0 && (
                  <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-3 text-sm leading-5 text-indigo-950 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-100">
                    <input type="checkbox" checked={allowSundayResubmissionWithoutPenalty} onChange={(event) => setAllowSundayResubmissionWithoutPenalty(event.target.checked)} className="mt-1 h-4 w-4 accent-indigo-600" />
                    <span><strong>Cho phép nhân viên ghi lại lịch vào Chủ nhật mà không trừ tiền.</strong><br />Nếu không cho phép, lịch gửi lại sẽ áp dụng khoản trừ theo luật hiện tại.</span>
                  </label>
                )}
                {rejectIntentId === selectedPending.id ? (
                  <button type="button" disabled={processingId === selectedPending.id || !(reviewNotes[selectedPending.id] || '').trim()} onClick={() => void processPending(selectedPending, 'Rejected')} className="flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-rose-600 font-extrabold text-white disabled:opacity-50">{processingId === selectedPending.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Xác nhận từ chối</button>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <button type="button" disabled={processingId === selectedPending.id} onClick={() => void processPending(selectedPending, 'Rejected')} className="flex min-h-13 items-center justify-center gap-2 rounded-2xl border border-rose-200 font-extrabold text-rose-600 disabled:opacity-60"><X className="h-4 w-4" /> Từ chối</button>
                    <button type="button" disabled={processingId === selectedPending.id} onClick={() => void processPending(selectedPending, 'Approved')} className={`flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r ${selectedPendingMeta.gradient} font-extrabold text-white shadow-lg disabled:opacity-60`}>{processingId === selectedPending.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Duyệt</button>
                  </div>
                )}
              </section>
            </article>
          </main>
          </div>
        </div>
      )}

      {selectedDecision && (() => {
        const meta = managementMeta[selectedDecision.resource]
        const employee = employeeMap.get(selectedDecision.employeeId)
        const nextStatus = selectedDecision.status === 'Approved' ? 'Rejected' : 'Approved'
        return (
          <div className="fixed inset-0 z-[75] overflow-y-auto bg-slate-100 dark:bg-slate-950">
            <header className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/95 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95">
              <div className="mx-auto flex min-h-20 max-w-lg items-center gap-3 px-4 pt-[env(safe-area-inset-top)]">
                <button type="button" onClick={() => setSelectedDecision(null)} className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 dark:bg-slate-800" aria-label="Quay lại"><ArrowLeft className="h-5 w-5" /></button>
                <div><h1 className="text-lg font-black">Biểu mẫu đã xử lý</h1><p className="text-sm text-muted-foreground">Chỉ xem hoặc hoàn tác quyết định</p></div>
              </div>
            </header>
            <main className="mx-auto max-w-lg p-3 pb-[calc(2rem+env(safe-area-inset-bottom))]">
              <article className="overflow-hidden rounded-[2rem] border border-indigo-100 bg-white shadow-xl shadow-slate-950/10 dark:border-indigo-500/20 dark:bg-slate-900">
                <section className={`bg-gradient-to-r ${meta.gradient} p-5 text-white`}>
                  <div className="flex items-start gap-3">
                    <IdentityAvatar name={employee?.fullName || 'Nhân viên'} photoURL={employee?.photoURL} icon={meta.icon} color={meta.color} />
                    <div className="min-w-0 flex-1">
                      <h2 className="text-xl font-black">{selectedDecision.title}</h2>
                      <p className="mt-2 font-extrabold">{employee?.fullName || selectedDecision.employeeId}{employee?.employeeCode ? ` · ${employee.employeeCode}` : ''}</p>
                      <p className="mt-1 text-sm text-white/85">{selectedDecision.detail}</p>
                      <span className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-black ${selectedDecision.status === 'Approved' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>{selectedDecision.status === 'Approved' ? 'Đã duyệt' : 'Đã từ chối'}</span>
                    </div>
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <a href={`tel:${employee?.phone || ''}`} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white/15 text-sm font-extrabold"><Phone className="h-4 w-4" /> Gọi điện</a>
                    <a href={employee?.facebookUrl || 'https://facebook.com/'} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-blue-600 text-sm font-extrabold"><ExternalLink className="h-4 w-4" /> Facebook</a>
                  </div>
                </section>
                <section className="space-y-5 p-4">
                  <SimpleShiftList title={selectedDecision.resource === 'schedule' ? 'Lịch đã gửi' : 'Ca mới / ca thêm'} items={selectedDecision.shifts} />
                  <SimpleShiftList title="Ca muốn hủy" items={selectedDecision.removedShifts} />
                  {selectedDecision.reason && <p className="rounded-2xl border border-slate-100 p-3 text-sm leading-6"><strong>Ghi chú:</strong> {selectedDecision.reason}</p>}
                  {selectedDecision.reviewNote && <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-100"><strong>Phản hồi cũ:</strong> {selectedDecision.reviewNote}</p>}
                  <div className="border-t border-slate-100 pt-4 dark:border-white/10">
                    <div className="flex items-center gap-2"><RotateCcw className="h-4 w-4 text-indigo-600" /><h3 className="font-black">Hoàn tác quyết định</h3></div>
                    <p className="mt-1 text-xs text-muted-foreground">Không mở trang sửa lịch. Thao tác này chỉ đổi quyết định quản lý.</p>
                    {nextStatus === 'Rejected' && <textarea value={undoReason} onChange={(event) => setUndoReason(event.target.value)} rows={3} placeholder="Nhập lý do chuyển thành từ chối..." className="mt-3 w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-base leading-6 dark:border-slate-700 dark:bg-slate-900" />}
                    <button type="button" disabled={processingId === selectedDecision.key || (nextStatus === 'Rejected' && !undoReason.trim())} onClick={() => void changeDecision(selectedDecision)} className={`mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl font-extrabold text-white disabled:opacity-50 ${nextStatus === 'Rejected' ? 'bg-rose-600' : 'bg-emerald-600'}`}>
                      {processingId === selectedDecision.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Hoàn tác và chuyển thành {nextStatus === 'Rejected' ? 'Từ chối' : 'Duyệt'}
                    </button>
                  </div>
                </section>
              </article>
            </main>
          </div>
        )
      })()}

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
              <section className="p-4"><p className="rounded-2xl bg-slate-50 p-4 text-sm font-medium leading-7 text-slate-700 dark:bg-slate-800 dark:text-slate-200">{selectedNotification.message}</p>{!isManagement && <button type="button" onClick={() => router.push(destinationFor(selectedNotification))} className={`mt-5 flex min-h-13 w-full items-center justify-between rounded-2xl bg-gradient-to-r ${selectedNotificationMeta.gradient} px-5 font-extrabold text-white shadow-lg`}><span>Mở biểu mẫu liên quan</span><ChevronRight className="h-5 w-5" /></button>}</section>
            </article>
          </main>
        </div>
      )}
    </main>
  )
}
