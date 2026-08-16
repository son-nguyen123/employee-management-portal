'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { AlertTriangle, ArrowLeft, CalendarCheck, Check, ChevronRight, ExternalLink, Loader2, MessageSquareText, Phone, RotateCcw, UsersRound, X } from 'lucide-react'
import { useAuth, useUserRole } from '@/lib/hooks/useAuth'
import { employeeFactoryId, FACTORY_LABELS } from '@/lib/models/factory'
import { setEmployeeAccountStatus, subscribeToAllEmployees } from '@/lib/services/employeeService'
import { ensureFixedSchedule, reviewWorkScheduleBatch, subscribeToAllSchedules } from '@/lib/services/scheduleService'
import { getPreviewSchedules, updatePreviewSchedule } from '@/lib/services/previewWorkflow'
import type { Employee, WorkSchedule } from '@/lib/models/types'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { Badge } from '@/components/ui/badge'
import { OtherRequestWorkspace } from '@/components/admin/other-request-workspace'
import { RequestIdentityAvatar } from '@/components/admin/request-identity-avatar'
import { profileImageUrl } from '@/lib/utils/profileImage'
import { isManagementScheduleRole, registrationTargetsNextWeek } from '@/lib/schedule/registration-policy'
import { getOperationalHealth, type OperationalHealthSnapshot } from '@/lib/services/operationalHealthService'

type ScheduleRow = WorkSchedule & {
  id: string
  employeeName?: string
  employeeCode?: string
}

const shortShiftLabel = { Morning: 'sáng', Afternoon: 'chiều', Evening: 'tối' }

type ScheduleBatch = {
  key: string
  employeeId: string
  employeeName?: string
  employeeCode?: string
  schedules: ScheduleRow[]
  isEditing?: boolean
  requiresReapproval?: boolean
}

type ProcessedScheduleBatch = ScheduleBatch & { status: 'Approved' | 'Rejected' }

function OperationalAlertBanner({ health }: { health: OperationalHealthSnapshot | null }) {
  const activeAlerts = health?.alerts
    .filter((item) => item.status === 'active')
    .sort((left, right) => Number(right.severity === 'critical') - Number(left.severity === 'critical')) || []
  const alert = activeAlerts[0]
  const fallbackService = health?.services.find((item) => item.severity === 'critical')
    || health?.services.find((item) => item.severity === 'warning')
  const severity = alert?.severity || fallbackService?.severity
  if (severity !== 'critical' && severity !== 'warning') return null
  const title = alert?.title || fallbackService?.title || 'Hệ thống cần chú ý'
  const message = alert?.message || fallbackService?.message || 'Mở tình trạng hệ thống để xem chi tiết.'
  const remainingCount = Math.max(0, activeAlerts.length - 1)
  const critical = severity === 'critical'

  return (
    <Link
      href="/admin/settings#system-health"
      className={`mb-4 flex items-start gap-3 rounded-3xl border p-4 shadow-sm transition active:scale-[.99] ${critical
        ? 'border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100'
        : 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100'}`}
    >
      <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white ${critical ? 'bg-rose-600' : 'bg-amber-500'}`}>
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-black">{critical ? 'Cảnh báo hệ thống khẩn cấp' : 'Hệ thống cần chú ý'}</p>
          {remainingCount > 0 && <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-black">+{remainingCount} cảnh báo</span>}
        </div>
        <p className="mt-1 text-sm font-bold">{title}</p>
        <p className="mt-1 line-clamp-2 text-xs leading-5 opacity-80">{message}</p>
        <p className="mt-2 text-xs font-black underline underline-offset-2">Xem tình trạng hệ thống</p>
      </div>
      <ChevronRight className="mt-3 h-5 w-5 shrink-0 opacity-60" />
    </Link>
  )
}

function toDate(value: WorkSchedule['date']) {
  return value instanceof Date ? value : value.toDate()
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function mondayKey(date: Date) {
  const result = new Date(date)
  const day = result.getDay() || 7
  result.setDate(result.getDate() - day + 1)
  result.setHours(0, 0, 0, 0)
  return localDateKey(result)
}

function nextMondayKey() {
  const now = new Date()
  const result = new Date(now)
  const daysUntilNextMonday = ((8 - now.getDay()) % 7) || 7
  result.setDate(now.getDate() + daysUntilNextMonday)
  result.setHours(0, 0, 0, 0)
  return localDateKey(result)
}

function activeRegistrationWeekKey(value = new Date()) {
  const isoWeekday = value.getDay() || 7
  return registrationTargetsNextWeek(isoWeekday) ? nextMondayKey() : mondayKey(value)
}

function scheduleActivityAt(schedule: ScheduleRow) {
  const value = schedule.reviewedAt || schedule.updatedAt || schedule.createdAt
  return value instanceof Date ? value : value.toDate()
}

function actualShiftCount(batch: ScheduleBatch) {
  const declaredCount = Math.max(0, ...batch.schedules.map((item) => Number(item.weeklyShiftCount || 0)))
  return declaredCount || batch.schedules.filter((item) => !item.note?.includes('[DUTY_ONLY]') && !item.note?.includes('[NO_SHIFTS]')).length
}

function batchNeedsAttention(batch: ScheduleBatch) {
  return batch.schedules.some((item) => item.underMinimumWarning || Number(item.penaltyAmount || 0) > 0 || Boolean(item.penaltyId)) || actualShiftCount(batch) < 6
}

function batchPenaltyAmount(batch: ScheduleBatch) {
  return Math.max(0, ...batch.schedules.map((item) => Number(item.penaltyAmount || 0)))
}

function batchHasPenalty(batch: ScheduleBatch) {
  return batch.schedules.some((item) => Boolean(item.penaltyId) || Number(item.penaltyAmount || 0) > 0)
}

export default function AdminDashboardPage() {
  const { authUser, employee: currentEmployee, isPreviewMode } = useAuth()
  const role = useUserRole()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [schedules, setSchedules] = useState<ScheduleRow[]>([])
  const [tab, setTab] = useState<'schedules' | 'other' | 'employees'>('schedules')
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState('')
  const [processingAction, setProcessingAction] = useState<'approve' | 'reject' | ''>('')
  const [rejectingBatch, setRejectingBatch] = useState<ScheduleBatch | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [allowSundayResubmissionWithoutPenalty, setAllowSundayResubmissionWithoutPenalty] = useState(false)
  const [message, setMessage] = useState('')
  const [selectedProcessedBatch, setSelectedProcessedBatch] = useState<ProcessedScheduleBatch | null>(null)
  const [selectedPendingBatch, setSelectedPendingBatch] = useState<ScheduleBatch | null>(null)
  const [newEmployeeApprovalBatch, setNewEmployeeApprovalBatch] = useState<ScheduleBatch | null>(null)
  const [processedReason, setProcessedReason] = useState('')
  const [operationalHealth, setOperationalHealth] = useState<OperationalHealthSnapshot | null>(null)
  const [referenceNow] = useState(() => Date.now())
  const legacyAutoApprovalRef = useRef(new Set<string>())
  const fixedSyncRef = useRef(new Set<string>())

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (new URLSearchParams(window.location.search).get('view') === 'employees') setTab('employees')
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [])

  useEffect(() => {
    if (!authUser) return
    const load = async () => {
      try {
        if (isPreviewMode) {
          const preview = getPreviewSchedules()
          const uniqueEmployees = Array.from(new Map(preview.map((item) => [item.employeeId, {
            uid: item.employeeId,
            employeeCode: item.employeeCode,
            fullName: item.employeeName,
            phone: item.phone,
            email: `${item.employeeCode.toLowerCase()}@example.com`,
            role: 'employee' as const,
            status: 'active' as const,
            joinDate: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          }])).values())
          setEmployees(uniqueEmployees)
          setSchedules(preview.map((item) => ({
            id: item.id,
            employeeId: item.employeeId,
            employeeName: item.employeeName,
            employeeCode: item.employeeCode,
            date: new Date(item.date),
            shift: item.shift,
            status: item.status,
            note: item.note,
            reviewNote: item.reviewNote,
            weeklyShiftCount: item.weeklyShiftCount,
            underMinimumWarning: item.underMinimumWarning,
            autoApproved: item.autoApproved,
            penaltyId: item.penaltyId,
            penaltyAmount: item.penaltyAmount,
            reviewedAt: item.reviewedAt ? new Date(item.reviewedAt) : new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          })))
          return
        }
        let employeeData: Employee[] = []
        let scheduleData: WorkSchedule[] = []
        let employeesReady = false
        let schedulesReady = false
        const publish = () => {
          const employeeById = new Map(employeeData.map((item) => [item.uid, item]))
          setEmployees(employeeData)
          setSchedules(scheduleData.map((schedule) => {
            const employee = employeeById.get(schedule.employeeId)
            return { ...schedule, id: schedule.id!, employeeName: employee?.fullName, employeeCode: employee?.employeeCode }
          }))
          if (employeesReady && schedulesReady) setLoading(false)
        }
        const factoryScope = role === 'director' ? undefined : employeeFactoryId(currentEmployee)
        const startDate = new Date()
        const weekday = startDate.getDay() || 7
        startDate.setDate(startDate.getDate() - weekday + 1)
        startDate.setHours(0, 0, 0, 0)
        const endDate = new Date(startDate)
        endDate.setDate(startDate.getDate() + 13)
        endDate.setHours(23, 59, 59, 999)
        const unsubscribeEmployees = subscribeToAllEmployees((nextEmployees) => {
          employeeData = nextEmployees
          employeesReady = true
          publish()
        }, undefined, factoryScope)
        const unsubscribeSchedules = subscribeToAllSchedules((nextSchedules) => {
          scheduleData = nextSchedules
          schedulesReady = true
          publish()
        }, undefined, factoryScope, { startDate, endDate })
        return () => {
          unsubscribeEmployees()
          unsubscribeSchedules()
        }
      } catch {
        setMessage('Chưa tải được dữ liệu quản lý. Hãy kiểm tra quyền admin trong Firestore.')
      } finally {
        setLoading(false)
      }
    }
    let cleanup: void | (() => void)
    load().then((unsubscribe) => {
      cleanup = unsubscribe
    })
    return () => cleanup?.()
  }, [authUser, currentEmployee, isPreviewMode, role])

  useEffect(() => {
    if (!authUser || isPreviewMode || !['admin', 'manager', 'director'].includes(role || '')) return
    let active = true
    const refresh = () => {
      void getOperationalHealth()
        .then((snapshot) => { if (active) setOperationalHealth(snapshot) })
        .catch(() => undefined)
    }
    refresh()
    const interval = window.setInterval(refresh, 5 * 60 * 1000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [authUser, isPreviewMode, role])

  const activeEmployees = useMemo(() => employees.filter((item) => item.status === 'active'), [employees])
  const activeEmployeeIds = useMemo(() => new Set(activeEmployees.map((item) => item.uid)), [activeEmployees])
  const fixedForNextWeek = useMemo(() => activeEmployees.filter((employee) => {
    const targetWeek = nextMondayKey()
    const managementSchedule = isManagementScheduleRole(employee.role)
    if (!managementSchedule && employee.scheduleMode !== 'fixed') return false
    const effective = employee.scheduleModeEffectiveWeekStart || ''
    const needsSetup = employee.fixedScheduleNeedsSetupWeekStart || ''
    return managementSchedule || ((!effective || effective <= targetWeek) && (!needsSetup || targetWeek < needsSetup))
  }), [activeEmployees])
  useEffect(() => {
    if (isPreviewMode || !authUser || !['admin', 'manager', 'director'].includes(role || '') || !fixedForNextWeek.length) return
    const targetWeek = nextMondayKey()
    fixedForNextWeek.forEach((employee) => {
      const syncKey = `${employee.uid}-${targetWeek}`
      if (fixedSyncRef.current.has(syncKey)) return
      fixedSyncRef.current.add(syncKey)
      void ensureFixedSchedule(targetWeek, employee.uid).catch(() => {
        fixedSyncRef.current.delete(syncKey)
      })
    })
  }, [authUser, fixedForNextWeek, isPreviewMode, role])
  const pendingEmployees = useMemo(() => employees.filter((item) => item.status === 'pending'), [employees])
  const inactiveEmployees = useMemo(() => employees.filter((item) => item.status === 'inactive'), [employees])

  const changeAccountStatus = async (employee: Employee, status: 'active' | 'inactive') => {
    setProcessingId(employee.uid)
    setMessage('')
    try {
      if (!isPreviewMode) await setEmployeeAccountStatus(employee.uid, status)
      setEmployees((current) => current.map((item) => item.uid === employee.uid ? { ...item, status } : item))
      setMessage(status === 'active'
        ? `Đã chấp nhận tài khoản ${employee.fullName}.`
        : `Đã vô hiệu hóa ${employee.fullName}. Lịch và ứng lương được tạm ẩn; bật lại trước 00:00 Thứ Hai để khôi phục lịch.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể đổi trạng thái tài khoản.')
    } finally {
      setProcessingId('')
    }
  }
  const pendingBatches = useMemo(() => {
    const grouped = new Map<string, ScheduleBatch>()
    const referenceDate = new Date(referenceNow)
    const reviewableWeeks = new Set([activeRegistrationWeekKey(referenceDate), nextMondayKey(), ...(referenceDate.getDay() === 0 ? [mondayKey(referenceDate)] : [])])
    schedules.filter((item) => activeEmployeeIds.has(item.employeeId) &&
      ['Registered', 'Pending'].includes(item.status) &&
      reviewableWeeks.has(mondayKey(toDate(item.date)))
    ).forEach((schedule) => {
      const key = `${schedule.employeeId}-${mondayKey(toDate(schedule.date))}`
      const current = grouped.get(key)
      if (current) current.schedules.push(schedule)
      else grouped.set(key, {
        key,
        employeeId: schedule.employeeId,
        employeeName: schedule.employeeName,
        employeeCode: schedule.employeeCode,
        schedules: [schedule],
      })
    })
    return Array.from(grouped.values()).map((batch) => {
      const uniqueRows = Array.from(new Map(batch.schedules
        .sort((a, b) => {
          const aUpdated = a.updatedAt instanceof Date ? a.updatedAt : a.updatedAt.toDate()
          const bUpdated = b.updatedAt instanceof Date ? b.updatedAt : b.updatedAt.toDate()
          return aUpdated.getTime() - bUpdated.getTime()
        })
        .map((schedule) => {
          const key = `${toDate(schedule.date).toISOString().slice(0, 10)}-${schedule.shift}-${schedule.note || ''}`
          return [key, schedule]
        })).values())
      return {
        ...batch,
        schedules: uniqueRows.sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime()),
        isEditing: uniqueRows.some((item) => item.status === 'Editing'),
        requiresReapproval: uniqueRows.some((item) => item.requiresReapproval),
      }
    })
  }, [activeEmployeeIds, schedules, referenceNow])
  useEffect(() => {
    if (isPreviewMode || !authUser || !['admin', 'manager'].includes(role || '')) return
    pendingBatches.forEach((batch) => {
      if (legacyAutoApprovalRef.current.has(batch.key)) return
      legacyAutoApprovalRef.current.add(batch.key)
      void reviewWorkScheduleBatch(
        batch.schedules.map((item) => item.id),
        'Approved',
        'Tự động chuyển đổi theo chính sách lịch mới.'
      ).catch(() => {
        legacyAutoApprovalRef.current.delete(batch.key)
        setMessage('Có lịch cũ chưa thể tự động đồng bộ. Hệ thống sẽ thử lại khi dữ liệu thay đổi.')
      })
    })
  }, [authUser, isPreviewMode, pendingBatches, role])
  const processedBatches = useMemo(() => {
    const grouped = new Map<string, ProcessedScheduleBatch>()
    schedules.filter((item) => activeEmployeeIds.has(item.employeeId) &&
      ['Approved', 'Rejected'].includes(item.status) &&
      mondayKey(toDate(item.date)) === activeRegistrationWeekKey(new Date(referenceNow))
    ).forEach((schedule) => {
      const key = `${schedule.employeeId}-${mondayKey(toDate(schedule.date))}`
      const current = grouped.get(key)
      if (current) current.schedules.push(schedule)
      else grouped.set(key, {
        key,
        employeeId: schedule.employeeId,
        employeeName: schedule.employeeName,
        employeeCode: schedule.employeeCode,
        schedules: [schedule],
        status: schedule.status as 'Approved' | 'Rejected',
      })
    })
    return [...grouped.values()].map((batch) => ({
      ...batch,
      schedules: [...batch.schedules].sort((left, right) => toDate(left.date).getTime() - toDate(right.date).getTime()),
      status: batch.schedules.some((item) => item.status === 'Rejected') ? 'Rejected' as const : 'Approved' as const,
    })).sort((left, right) => {
      const leftTime = Math.max(...left.schedules.map((item) => scheduleActivityAt(item).getTime()))
      const rightTime = Math.max(...right.schedules.map((item) => scheduleActivityAt(item).getTime()))
      return rightTime - leftTime
    })
  }, [activeEmployeeIds, referenceNow, schedules])
  const missingEmployees = useMemo(() => {
    const submitted = new Set(schedules.filter((item) =>
      activeEmployeeIds.has(item.employeeId) && item.status !== 'Cancelled' && mondayKey(toDate(item.date)) === activeRegistrationWeekKey(new Date(referenceNow))
    ).map((item) => item.employeeId))
    return activeEmployees.filter((employee) => !submitted.has(employee.uid) && !fixedForNextWeek.some((fixed) => fixed.uid === employee.uid))
  }, [activeEmployeeIds, activeEmployees, fixedForNextWeek, referenceNow, schedules])
  const submittedEmployees = useMemo(
    () => new Set([
      ...schedules.filter((item) =>
      activeEmployeeIds.has(item.employeeId) && item.status !== 'Cancelled' && mondayKey(toDate(item.date)) === activeRegistrationWeekKey(new Date(referenceNow))
      ).map((item) => item.employeeId),
      ...fixedForNextWeek.map((employee) => employee.uid),
    ]).size,
    [activeEmployeeIds, fixedForNextWeek, referenceNow, schedules]
  )
  const weeklyTarget = activeEmployees.length
  const attentionBatches = processedBatches.filter((batch) => batch.status === 'Rejected' || batchNeedsAttention(batch))
  const regularApprovedBatches = processedBatches.filter((batch) => batch.status === 'Approved' && !batchNeedsAttention(batch))

  const review = async (batch: ScheduleBatch, status: 'Approved' | 'Rejected', reviewNote = '', allowSundayResubmission = false, waiveNewEmployeePenalty = false) => {
    setProcessingId(batch.key)
    setProcessingAction(status === 'Approved' ? 'approve' : 'reject')
    setMessage('')
    try {
      const ids = batch.schedules.map((item) => item.id)
      if (isPreviewMode) ids.forEach((id) => updatePreviewSchedule(id, { status, reviewNote }))
      else await reviewWorkScheduleBatch(ids, status, reviewNote, allowSundayResubmission, waiveNewEmployeePenalty)
      setSchedules((prev) => prev.map((item) => ids.includes(item.id) ? { ...item, status, reviewNote } : item))
      setMessage(
        status === 'Approved'
          ? `Đã xác nhận toàn bộ bảng gồm ${ids.length} ca.`
          : 'Đã từ chối bảng lịch và gửi thông báo cho nhân viên.'
      )
      setRejectingBatch(null)
      setRejectReason('')
      setAllowSundayResubmissionWithoutPenalty(false)
      return true
    } catch {
      setMessage('Không thể cập nhật. Kiểm tra tài khoản hiện tại có role admin trong employees/{uid}.')
      return false
    } finally {
      setProcessingId('')
      setProcessingAction('')
    }
  }

  const isNewEmployeeApproval = (batch: ScheduleBatch) => {
    const referenceDate = new Date(referenceNow)
    if (referenceDate.getDay() !== 0) return false
    const employee = employees.find((item) => item.uid === batch.employeeId)
    if (!employee || !batch.schedules.some((item) => localDateKey(toDate(item.date)) === localDateKey(referenceDate))) return false
    const joined = employee.joinDate instanceof Date ? employee.joinDate : employee.joinDate.toDate()
    const hasPreviousSchedule = schedules.some((item) => item.employeeId === batch.employeeId && !batch.schedules.some((row) => row.id === item.id) && item.status !== 'Cancelled')
    return referenceNow - joined.getTime() <= 45 * 24 * 60 * 60 * 1000 && !hasPreviousSchedule
  }

  if ((!role || !['admin', 'manager', 'director'].includes(role)) && !isPreviewMode) {
    return (
      <main className="min-h-screen">
        <Header title="Điều hành" />
        <PageContainer><div className="mobile-card p-8 text-center font-bold">Tài khoản này không có quyền quản lý.</div></PageContainer>
      </main>
    )
  }

  if (tab === 'employees') {
    return (
      <main className="min-h-screen pb-8">
        <Header
          title="Danh sách nhân viên"
          subtitle={`${activeEmployees.length} nhân viên đang hoạt động`}
          backHref="/"
        />
        <PageContainer maxWidth="2xl">
          <OperationalAlertBanner health={operationalHealth} />
          {message && <p className="mb-3 rounded-2xl bg-indigo-50 p-3 text-sm font-semibold text-indigo-900 dark:bg-indigo-500/10 dark:text-indigo-100">{message}</p>}
          {fixedForNextWeek.length > 0 && <section className="mb-5 rounded-3xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-500/30 dark:bg-violet-500/10"><div className="flex items-center justify-between gap-3"><h2 className="font-black text-violet-900 dark:text-violet-100">Lịch cố định tuần sau</h2><span className="rounded-full bg-violet-600 px-2.5 py-1 text-xs font-black text-white">{fixedForNextWeek.length} người</span></div><p className="mt-2 text-sm leading-6 text-violet-800 dark:text-violet-200">{fixedForNextWeek.map((employee) => employee.fullName).join(' · ')}</p></section>}
          {['admin', 'director'].includes(role || '') && pendingEmployees.length > 0 && (
            <section className="mb-5 rounded-3xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
              <h2 className="font-black text-amber-900 dark:text-amber-100">Tài khoản mới chờ duyệt ({pendingEmployees.length})</h2>
              <div className="mt-3 space-y-2">{pendingEmployees.map((employee) => (
                <article key={employee.uid} className="rounded-2xl bg-white p-3 shadow-sm dark:bg-slate-900">
                  <p className="font-extrabold">{employee.fullName} · {employee.employeeCode}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{FACTORY_LABELS[employeeFactoryId(employee)]} · {employee.phone} · {employee.email}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" disabled={processingId === employee.uid} onClick={() => void changeAccountStatus(employee, 'inactive')} className="min-h-11 rounded-xl border border-rose-200 text-sm font-bold text-rose-600 disabled:opacity-50">Từ chối / khóa</button>
                    <button type="button" disabled={processingId === employee.uid} onClick={() => void changeAccountStatus(employee, 'active')} className="min-h-11 rounded-xl bg-emerald-600 text-sm font-bold text-white disabled:opacity-50">{processingId === employee.uid ? 'Đang xử lý...' : 'Chấp nhận'}</button>
                  </div>
                </article>
              ))}</div>
            </section>
          )}
          {loading ? (
            <div className="grid min-h-56 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>
          ) : (
            <section id="employees" className="grid gap-2 sm:grid-cols-2">
              {activeEmployees.map((employee) => (
                <Link key={employee.uid} href={`/admin/employees/${employee.uid}`} className="flex min-h-18 items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm transition active:scale-[.99] dark:border-white/10 dark:bg-slate-900">
                  <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl bg-indigo-50 text-sm font-black text-indigo-600 dark:bg-indigo-500/10">
                    {employee.photoURL ? <Image src={profileImageUrl(employee.photoURL)} alt={`Ảnh đại diện của ${employee.fullName}`} width={44} height={44} className="h-full w-full object-cover" /> : employee.fullName.split(' ').slice(-2).map((word) => word[0]).join('')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-extrabold">{employee.fullName}</h2>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{employee.employeeCode} · {employee.phone || 'Chưa có SĐT'}</p>
                  </div>
                  {!isManagementScheduleRole(employee.role) && employee.scheduleMode === 'fixed' && <span className="shrink-0 rounded-full bg-violet-50 px-2 py-1 text-[10px] font-black text-violet-700 dark:bg-violet-500/10 dark:text-violet-200">Cố định</span>}
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                </Link>
              ))}
              {!activeEmployees.length && <div className="mobile-card p-8 text-center text-sm font-semibold text-muted-foreground sm:col-span-2">Chưa có nhân viên đang hoạt động.</div>}
            </section>
          )}
          {role === 'admin' && inactiveEmployees.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-3 text-lg font-black">Tài khoản đã khóa</h2>
              <div className="space-y-2">{inactiveEmployees.map((employee) => (
                <article key={employee.uid} className="mobile-card flex items-center gap-3 p-3">
                  <Link href={`/admin/employees/${employee.uid}`} className="flex min-w-0 flex-1 items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-2xl bg-indigo-50 text-xs font-black text-indigo-600 dark:bg-indigo-500/10">{employee.photoURL ? <Image src={profileImageUrl(employee.photoURL)} alt={`Ảnh đại diện của ${employee.fullName}`} width={40} height={40} className="h-full w-full object-cover" /> : employee.fullName.split(' ').slice(-2).map((word) => word[0]).join('')}</div><div className="min-w-0"><p className="truncate font-bold">{employee.fullName}</p><p className="text-xs text-muted-foreground">{employee.employeeCode} · Xem hồ sơ</p></div></Link>
                  <button type="button" disabled={processingId === employee.uid} onClick={() => void changeAccountStatus(employee, 'active')} className="min-h-10 rounded-xl bg-emerald-50 px-3 text-xs font-bold text-emerald-700 disabled:opacity-50">Bật lại</button>
                </article>
              ))}</div>
            </section>
          )}
        </PageContainer>
      </main>
    )
  }

  return (
    <main className="min-h-screen pb-8">
      <Header title="Điều hành" subtitle="Theo dõi lịch tự động duyệt và nhân viên" backHref="/" />
      <PageContainer maxWidth="2xl">
        <OperationalAlertBanner health={operationalHealth} />
        <section className="grid grid-cols-3 gap-2">
          {[
            { label: 'Đang hoạt động', value: activeEmployees.length, icon: UsersRound, color: 'bg-indigo-600' },
            { label: 'Lịch cần lưu ý', value: attentionBatches.length + pendingBatches.length, icon: CalendarCheck, color: 'bg-amber-500' },
            { label: 'Đã tạo lịch', value: `${submittedEmployees}/${weeklyTarget}`, icon: Check, color: 'bg-emerald-600' },
          ].map(({ label, value, icon: Icon, color }) => (
            <article key={label} className="mobile-card p-3">
              <div className={`grid h-9 w-9 place-items-center rounded-xl text-white ${color}`}><Icon className="h-4 w-4" /></div>
              <p className="mt-3 text-xl font-black">{value}</p>
              <p className="truncate text-[11px] font-semibold text-muted-foreground">{label}</p>
            </article>
          ))}
        </section>
        <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
          <button type="button" onClick={() => setTab('schedules')} className={`min-h-11 rounded-xl text-sm font-bold ${tab === 'schedules' ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-950' : 'text-muted-foreground'}`}>Đánh giá lịch</button>
          <button type="button" onClick={() => setTab('other')} className={`min-h-11 rounded-xl text-sm font-bold ${tab === 'other' ? 'bg-white text-violet-600 shadow-sm dark:bg-slate-950' : 'text-muted-foreground'}`}>Yêu cầu khác</button>
        </div>

        {message && <p className="mt-4 rounded-2xl bg-indigo-50 p-3 text-sm font-semibold text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200">{message}</p>}

        {loading ? (
          <div className="grid min-h-56 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>
        ) : tab === 'schedules' ? (
          <section id="schedules" className="mt-5 space-y-3">
            {missingEmployees.map((employee) => <Link key={employee.uid} href={`/admin/employees/${employee.uid}`} className="mobile-card flex min-h-20 items-center gap-3 border-l-4 border-l-orange-400 p-3"><RequestIdentityAvatar name={employee.fullName} photoURL={employee.photoURL} icon={CalendarCheck} iconColor="bg-indigo-600" /><div className="min-w-0 flex-1"><h3 className="truncate font-extrabold">{employee.fullName}</h3><p className="text-sm font-semibold text-muted-foreground">{employee.employeeCode}</p></div><span className="text-xs font-black text-orange-600">Chưa gửi</span><ChevronRight className="h-4 w-4 text-slate-400" /></Link>)}
            {pendingBatches.map((batch) => { const employee = employees.find((item) => item.uid === batch.employeeId); return <article key={batch.key} className="mobile-card flex min-h-20 w-full items-center gap-3 border-l-4 border-l-amber-400 p-3"><RequestIdentityAvatar name={batch.employeeName || batch.employeeId} photoURL={employee?.photoURL} icon={CalendarCheck} iconColor="bg-indigo-600" /><div className="min-w-0 flex-1"><h3 className="truncate font-extrabold">{batch.employeeName || batch.employeeId}</h3><p className="text-sm font-semibold text-muted-foreground">{batch.employeeCode || 'Nhân viên'} · {actualShiftCount(batch)} ca</p></div><span className="text-right text-xs font-black text-amber-600">Đang<br />đồng bộ</span></article> })}
            {processedBatches.length > 0 && <div className="flex items-center gap-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400"><span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" /><span>Mới cập nhật</span><span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" /></div>}
            {[...attentionBatches, ...regularApprovedBatches].map((batch) => { const employee = employees.find((item) => item.uid === batch.employeeId); const attention = batchNeedsAttention(batch); const penalty = batchHasPenalty(batch); const penaltyAmount = batchPenaltyAmount(batch); const count = actualShiftCount(batch); return <button key={batch.key} type="button" onClick={() => { setSelectedProcessedBatch(batch); setProcessedReason('') }} className={`mobile-card flex min-h-20 w-full items-center gap-3 border-l-4 p-3 text-left ${batch.status === 'Rejected' || penalty ? 'border-l-rose-500' : attention ? 'border-l-amber-400' : 'border-l-emerald-500'}`}><RequestIdentityAvatar name={batch.employeeName || batch.employeeId} photoURL={employee?.photoURL} icon={CalendarCheck} iconColor="bg-indigo-600" /><div className="min-w-0 flex-1"><h3 className="truncate font-extrabold">{batch.employeeName || batch.employeeId}</h3><p className="text-sm font-semibold text-muted-foreground">{batch.employeeCode || 'Nhân viên'} · {count} ca</p></div><span className={`text-right text-xs font-black ${batch.status === 'Rejected' || penalty ? 'text-rose-600' : attention ? 'text-amber-600' : 'text-emerald-600'}`}>{batch.status === 'Rejected' ? 'Từ chối' : penalty ? <>{'Đã duyệt'}<br />{penaltyAmount ? `-${penaltyAmount.toLocaleString('vi-VN')}đ` : 'Bị phạt'}</> : <>{'Đã duyệt'}<br />{attention ? 'Cần lưu ý' : 'Tốt'}</>}</span><ChevronRight className="h-4 w-4 text-slate-400" /></button> })}
            {!pendingBatches.length && !processedBatches.length && !missingEmployees.length && <div className="mobile-card p-8 text-center"><Check className="mx-auto h-8 w-8 text-emerald-600" /><p className="mt-3 font-bold">Chưa có nhân viên trong danh sách.</p></div>}
          </section>
        ) : (
          <OtherRequestWorkspace employees={employees} />
        )}

      </PageContainer>

      {selectedPendingBatch && (() => {
        const employee = employees.find((item) => item.uid === selectedPendingBatch.employeeId)
        const weekNote = selectedPendingBatch.schedules.map((item) => item.note?.match(/\[WEEK_NOTE\]\s*([^\[]+)/)?.[1]?.trim()).find(Boolean)
        return (
          <div className="fixed inset-0 z-[70] overflow-y-auto bg-slate-100 dark:bg-slate-950">
            <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95">
              <div className="mx-auto flex min-h-20 max-w-lg items-center gap-3 px-4 pt-[env(safe-area-inset-top)]">
                <button type="button" disabled={!!processingId} onClick={() => setSelectedPendingBatch(null)} className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 disabled:opacity-50 dark:bg-slate-800" aria-label="Quay lại"><ArrowLeft className="h-5 w-5" /></button>
                <div><h2 className="font-black">Bảng đăng ký lịch</h2><p className="text-sm text-muted-foreground">Xem và xử lý lịch nhân viên</p></div>
              </div>
            </header>
            <main className="mx-auto max-w-lg p-3 pb-8">
              <article className="overflow-hidden rounded-[2rem] border border-violet-100 bg-white shadow-xl dark:border-violet-500/20 dark:bg-slate-900">
                <section className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 p-5 text-white">
                  <div className="flex items-center gap-4">
                    <RequestIdentityAvatar name={selectedPendingBatch.employeeName || selectedPendingBatch.employeeId} photoURL={employee?.photoURL} icon={CalendarCheck} iconColor="bg-indigo-600" />
                    <div className="min-w-0 flex-1"><h2 className="truncate text-xl font-black">{selectedPendingBatch.employeeName || selectedPendingBatch.employeeId}</h2><p className="mt-1 text-sm text-white/80">{selectedPendingBatch.employeeCode || 'Nhân viên'}</p><Badge className="mt-2 border-white/20 bg-white/15 text-white">Chờ duyệt</Badge></div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <a href={`tel:${employee?.phone || ''}`} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-white/15 text-sm font-bold"><Phone className="h-4 w-4" /> Gọi điện</a>
                    <a href={employee?.facebookUrl || 'https://facebook.com/'} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-blue-600 text-sm font-bold"><ExternalLink className="h-4 w-4" /> Facebook</a>
                  </div>
                </section>
                <section className="divide-y divide-slate-100 px-4 dark:divide-white/10">
                  {Array.from(new Map(selectedPendingBatch.schedules.map((schedule) => {
                    const date = toDate(schedule.date)
                    const key = localDateKey(date)
                    return [key, { date, rows: selectedPendingBatch.schedules.filter((item) => localDateKey(toDate(item.date)) === key) }]
                  })).values()).filter(({ rows }) => !rows.some((item) => item.note?.includes('[NO_SHIFTS]'))).map(({ date, rows }) => (
                    <div key={localDateKey(date)} className="grid grid-cols-[1fr_.8fr] gap-3 py-4 text-sm"><strong className="capitalize">{date.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })}</strong><span className="text-muted-foreground">{rows.filter((item) => !item.note?.includes('[DUTY_ONLY]')).map((item) => item.note?.includes('[CUSTOM:') ? 'tùy chỉnh' : shortShiftLabel[item.shift]).join(' – ')}</span></div>
                  ))}
                </section>
                {weekNote && <p className="mx-4 mb-4 rounded-2xl bg-slate-50 p-3 text-sm dark:bg-slate-800"><strong>Ghi chú:</strong> {weekNote}</p>}
                <section className="grid grid-cols-2 gap-2 border-t border-slate-100 p-4 dark:border-white/10">
                  <button type="button" disabled={!!processingId || selectedPendingBatch.isEditing} onClick={() => { setRejectingBatch(selectedPendingBatch); setRejectReason(''); setAllowSundayResubmissionWithoutPenalty(false); setSelectedPendingBatch(null) }} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-rose-200 font-extrabold text-rose-600 disabled:opacity-50"><X className="h-4 w-4" /> Từ chối</button>
                  <button type="button" disabled={!!processingId || selectedPendingBatch.isEditing} onClick={async () => { if (isNewEmployeeApproval(selectedPendingBatch)) setNewEmployeeApprovalBatch(selectedPendingBatch); else if (await review(selectedPendingBatch, 'Approved')) setSelectedPendingBatch(null) }} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 font-extrabold text-white disabled:opacity-50">{processingId === selectedPendingBatch.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Duyệt</button>
                </section>
              </article>
            </main>
          </div>
        )
      })()}

      {selectedProcessedBatch && (
        <div className="fixed inset-0 z-[70] overflow-y-auto bg-slate-100 dark:bg-slate-950">
          <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95">
            <div className="mx-auto flex min-h-20 max-w-lg items-center gap-3 px-4 pt-[env(safe-area-inset-top)]">
              <button type="button" disabled={!!processingId} onClick={() => setSelectedProcessedBatch(null)} className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 disabled:opacity-50 dark:bg-slate-800" aria-label="Quay lại">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <h2 className="font-black">{selectedProcessedBatch.schedules.every((item) => item.autoApproved) ? 'Lịch đã tự động duyệt' : `Nhân viên đã ${selectedProcessedBatch.status === 'Approved' ? 'duyệt' : 'từ chối'}`}</h2>
                <p className="text-sm text-muted-foreground">Bản cập nhật mới nhất của nhân viên</p>
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-lg p-3 pb-8">
            <article className="overflow-hidden rounded-[2rem] border border-violet-100 bg-white shadow-xl dark:border-violet-500/20 dark:bg-slate-900">
              <section className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 p-5 text-white">
                <div className="flex items-start gap-3">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15 text-sm font-black">
                    {(selectedProcessedBatch.employeeName || 'NV').split(' ').slice(-2).map((word) => word[0]).join('')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-xl font-black">{selectedProcessedBatch.employeeName || selectedProcessedBatch.employeeId}</h2>
                    <p className="mt-1 text-sm text-white/80">{selectedProcessedBatch.employeeCode || 'Nhân viên'} · {actualShiftCount(selectedProcessedBatch)} ca</p>
                    <span className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-black ${selectedProcessedBatch.status === 'Rejected' || batchHasPenalty(selectedProcessedBatch) ? 'bg-rose-400/25 text-rose-50' : batchNeedsAttention(selectedProcessedBatch) ? 'bg-amber-300/30 text-amber-50' : 'bg-emerald-400/25 text-emerald-50'}`}>
                      {selectedProcessedBatch.status === 'Rejected' ? 'Đã từ chối' : batchHasPenalty(selectedProcessedBatch) ? `Tự duyệt · ${batchPenaltyAmount(selectedProcessedBatch) ? `Trừ ${batchPenaltyAmount(selectedProcessedBatch).toLocaleString('vi-VN')}đ` : 'Bị phạt đăng ký trễ'}` : batchNeedsAttention(selectedProcessedBatch) ? 'Tự duyệt · Cần lưu ý' : 'Tự duyệt · Tốt'}
                    </span>
                  </div>
                </div>
              </section>
              <section className="divide-y divide-slate-100 px-4 dark:divide-white/10">
                {Array.from(new Map(selectedProcessedBatch.schedules.map((schedule) => {
                  const date = toDate(schedule.date)
                  const key = localDateKey(date)
                  return [key, { date, rows: selectedProcessedBatch.schedules.filter((item) => localDateKey(toDate(item.date)) === key) }]
                })).values()).map(({ date, rows }) => (
                  <div key={localDateKey(date)} className="grid grid-cols-[1fr_.8fr] gap-3 py-4 text-sm">
                    <strong className="capitalize">{date.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })}</strong>
                    <span className="text-muted-foreground">{rows.map((item) => shortShiftLabel[item.shift]).join(' – ')}</span>
                  </div>
                ))}
              </section>
              <section className="border-t border-slate-100 p-4 dark:border-white/10">
                {selectedProcessedBatch.status === 'Rejected' && selectedProcessedBatch.schedules.find((item) => item.reviewNote)?.reviewNote && (
                  <p className="mb-3 rounded-2xl bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-500/10 dark:text-rose-100"><strong>Lý do trước đó:</strong> {selectedProcessedBatch.schedules.find((item) => item.reviewNote)?.reviewNote}</p>
                )}
                {selectedProcessedBatch.status === 'Approved' && !selectedProcessedBatch.schedules.every((item) => item.autoApproved) && (
                  <textarea value={processedReason} onChange={(event) => setProcessedReason(event.target.value)} rows={3} maxLength={1000} placeholder="Nhập lý do hoàn tác để nhân viên biết điều chỉnh..." className="w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900" />
                )}
                {!selectedProcessedBatch.schedules.every((item) => item.autoApproved) && <button
                  type="button"
                  disabled={!!processingId || (selectedProcessedBatch.status === 'Approved' && !processedReason.trim())}
                  onClick={async () => {
                    const next = selectedProcessedBatch.status === 'Approved' ? 'Rejected' : 'Approved'
                    const updated = await review(selectedProcessedBatch, next, processedReason.trim())
                    if (updated) {
                      setSelectedProcessedBatch(null)
                      setProcessedReason('')
                    }
                  }}
                  className={`mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl font-extrabold text-white disabled:opacity-50 ${selectedProcessedBatch.status === 'Approved' ? 'bg-rose-600' : 'bg-emerald-600'}`}
                >
                  {processingId === selectedProcessedBatch.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  {selectedProcessedBatch.status === 'Approved' ? 'Hoàn tác và yêu cầu gửi lại' : 'Duyệt lại bảng lịch'}
                </button>}
                {selectedProcessedBatch.schedules.every((item) => item.autoApproved) && (
                  <>
                    <p className={`rounded-2xl border p-3 text-sm font-semibold leading-5 ${batchHasPenalty(selectedProcessedBatch) ? 'border-rose-200 bg-rose-50 text-rose-900' : batchNeedsAttention(selectedProcessedBatch) ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
                      {batchHasPenalty(selectedProcessedBatch) ? `Đã ghi nhận mức trừ ${batchPenaltyAmount(selectedProcessedBatch).toLocaleString('vi-VN')}đ.` : batchNeedsAttention(selectedProcessedBatch) ? `Lịch có ${actualShiftCount(selectedProcessedBatch)}/6 ca.` : `Lịch đủ ${actualShiftCount(selectedProcessedBatch)} ca.`}
                    </p>
                    {selectedProcessedBatch.status === 'Approved' && (
                      <button
                        type="button"
                        disabled={!!processingId}
                        onClick={async () => {
                          const updated = await review(selectedProcessedBatch, 'Rejected')
                          if (updated) setSelectedProcessedBatch(null)
                        }}
                        className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-rose-600 font-extrabold text-white disabled:opacity-50"
                      >
                        {processingId === selectedProcessedBatch.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                        Từ chối · yêu cầu nhập lại
                      </button>
                    )}
                  </>
                )}
                <p className="mt-3 text-center text-xs text-muted-foreground">Từ chối không cần nhập lý do.</p>
              </section>
            </article>
          </main>
        </div>
      )}

      {rejectingBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-4" onClick={() => !processingId && setRejectingBatch(null)}>
          <section className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-[2rem] bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-500/15">
                <MessageSquareText className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-black">Lý do từ chối lịch</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Phản hồi này sẽ được gửi cho {rejectingBatch.employeeName || 'nhân viên'}.
                </p>
              </div>
              <button type="button" disabled={!!processingId} onClick={() => setRejectingBatch(null)} className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 dark:bg-slate-800" aria-label="Đóng">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Lý do nhanh</p>
              <div className="flex flex-wrap gap-2">
                {[
                  'Lịch chưa phù hợp nhu cầu nhân sự',
                  'Cần bổ sung thêm ca làm',
                  'Ca đăng ký đang bị trùng',
                ].map((reason) => (
                  <button key={reason} type="button" onClick={() => setRejectReason(reason)} className={`rounded-full border px-3 py-2 text-xs font-bold transition ${rejectReason === reason ? 'border-rose-500 bg-rose-500 text-white' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800'}`}>
                    {reason}
                  </button>
                ))}
              </div>
            </div>

            <label className="mt-4 block text-sm font-bold">
              Nội dung phản hồi
              <textarea autoFocus value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} className="mobile-field mt-2 min-h-28 py-3" maxLength={1000} placeholder="Nhập lý do cụ thể để nhân viên điều chỉnh..." />
            </label>
            <p className="mt-1 text-right text-xs text-muted-foreground">{rejectReason.length}/1000</p>

            {new Date().getDay() === 0 && (
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-3 text-sm leading-5 text-indigo-950 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-100">
                <input type="checkbox" checked={allowSundayResubmissionWithoutPenalty} onChange={(event) => setAllowSundayResubmissionWithoutPenalty(event.target.checked)} className="mt-1 h-4 w-4 accent-indigo-600" />
                <span><strong>Cho phép nhân viên ghi lại lịch vào Chủ nhật mà không trừ tiền.</strong><br />Nếu không cho phép, lịch gửi lại sẽ áp dụng khoản trừ theo luật hiện tại.</span>
              </label>
            )}

            <div className="mt-5 grid grid-cols-[.8fr_1.2fr] gap-2">
              <button type="button" disabled={!!processingId} onClick={() => setRejectingBatch(null)} className="min-h-12 rounded-2xl border border-slate-200 font-bold dark:border-slate-700">Hủy</button>
              <button type="button" disabled={!rejectReason.trim() || !!processingId} onClick={() => review(rejectingBatch, 'Rejected', rejectReason.trim(), allowSundayResubmissionWithoutPenalty)} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 font-bold text-white disabled:opacity-50">
                {processingId === rejectingBatch.key && processingAction === 'reject' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                {processingId ? 'Đang từ chối...' : 'Từ chối bảng lịch'}
              </button>
            </div>
          </section>
        </div>
      )}

      {newEmployeeApprovalBatch && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-4" onClick={() => !processingId && setNewEmployeeApprovalBatch(null)}>
          <section className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-[2rem] bg-white shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
            <div className="bg-gradient-to-br from-fuchsia-600 via-pink-500 to-violet-600 p-6 text-white">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-white/20 text-3xl">✨</div>
              <h2 className="mt-4 text-center text-2xl font-black">Nhân viên mới vào</h2>
              <p className="mt-2 text-center text-sm leading-6 text-white/85">Có vẻ đây là lịch đầu tiên của nhân viên. Bạn có muốn miễn khoản phạt đăng ký trễ lần đầu không?</p>
            </div>
            <div className="grid gap-2 p-5">
              <button type="button" disabled={!!processingId} onClick={async () => { if (await review(newEmployeeApprovalBatch, 'Approved', '', false, true)) { setNewEmployeeApprovalBatch(null); setSelectedPendingBatch(null) } }} className="min-h-12 rounded-2xl bg-gradient-to-r from-fuchsia-600 to-violet-600 font-extrabold text-white shadow-lg shadow-fuchsia-500/20 disabled:opacity-50">
                Có, miễn phạt lần đầu
              </button>
              <button type="button" disabled={!!processingId} onClick={async () => { if (await review(newEmployeeApprovalBatch, 'Approved')) { setNewEmployeeApprovalBatch(null); setSelectedPendingBatch(null) } }} className="min-h-12 rounded-2xl border border-slate-200 font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200 disabled:opacity-50">
                Không, vẫn tính phạt
              </button>
              <button type="button" disabled={!!processingId} onClick={() => setNewEmployeeApprovalBatch(null)} className="min-h-10 text-sm font-semibold text-muted-foreground">Quay lại</button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
