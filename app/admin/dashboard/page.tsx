'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarCheck, Check, ChevronRight, ClipboardCheck, ExternalLink, Loader2, MessageSquareText, Phone, UsersRound, X } from 'lucide-react'
import { useAuth, useUserRole } from '@/lib/hooks/useAuth'
import { subscribeToAllEmployees } from '@/lib/services/employeeService'
import { reviewWorkScheduleBatch, subscribeToAllSchedules } from '@/lib/services/scheduleService'
import { getPreviewSchedules, updatePreviewSchedule } from '@/lib/services/previewWorkflow'
import type { Employee, WorkSchedule } from '@/lib/models/types'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { Badge } from '@/components/ui/badge'
import { getWeeklyScheduleTarget, updateWeeklyScheduleTarget } from '@/lib/services/managementSettingsService'

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

export default function AdminDashboardPage() {
  const { authUser, isPreviewMode } = useAuth()
  const role = useUserRole()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [schedules, setSchedules] = useState<ScheduleRow[]>([])
  const [tab, setTab] = useState<'requests' | 'employees'>('requests')
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState('')
  const [processingAction, setProcessingAction] = useState<'approve' | 'reject' | ''>('')
  const [rejectingBatch, setRejectingBatch] = useState<ScheduleBatch | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [message, setMessage] = useState('')
  const [expectedEmployees, setExpectedEmployees] = useState(0)
  const [savingTarget, setSavingTarget] = useState(false)

  useEffect(() => {
    if (!authUser || isPreviewMode) return
    void getWeeklyScheduleTarget(nextMondayKey())
      .then((result) => setExpectedEmployees(result.expectedEmployees))
      .catch(() => setMessage('Chưa tải được mục tiêu nhân viên của tuần này.'))
  }, [authUser, isPreviewMode])

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
        const unsubscribeEmployees = subscribeToAllEmployees((nextEmployees) => {
          employeeData = nextEmployees
          employeesReady = true
          publish()
        })
        const unsubscribeSchedules = subscribeToAllSchedules((nextSchedules) => {
          scheduleData = nextSchedules
          schedulesReady = true
          publish()
        })
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
  }, [authUser, isPreviewMode])

  const activeEmployees = useMemo(() => employees.filter((item) => item.status === 'active'), [employees])
  const pendingBatches = useMemo(() => {
    const grouped = new Map<string, ScheduleBatch>()
    schedules.filter((item) =>
      ['Registered', 'Pending', 'Editing'].includes(item.status) &&
      mondayKey(toDate(item.date)) === nextMondayKey()
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
  }, [schedules])
  const submittedEmployees = useMemo(
    () => new Set(schedules.filter((item) =>
      item.status !== 'Cancelled' && mondayKey(toDate(item.date)) === nextMondayKey()
    ).map((item) => item.employeeId)).size,
    [schedules]
  )
  const weeklyTarget = expectedEmployees || activeEmployees.length

  const saveWeeklyTarget = async () => {
    const target = Math.floor(expectedEmployees)
    if (target < 1) {
      setMessage('Số nhân viên cần gửi lịch phải từ 1 trở lên.')
      return
    }
    setSavingTarget(true)
    try {
      if (!isPreviewMode) {
        const result = await updateWeeklyScheduleTarget(nextMondayKey(), target)
        setExpectedEmployees(result.expectedEmployees)
      }
      setMessage(`Đã lưu mục tiêu chung ${target} nhân viên cho tuần kế tiếp.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể lưu mục tiêu tuần.')
    } finally {
      setSavingTarget(false)
    }
  }

  const review = async (batch: ScheduleBatch, status: 'Approved' | 'Rejected', reviewNote = '') => {
    if (status === 'Rejected' && !reviewNote.trim()) return
    setProcessingId(batch.key)
    setProcessingAction(status === 'Approved' ? 'approve' : 'reject')
    setMessage('')
    try {
      const ids = batch.schedules.map((item) => item.id)
      if (isPreviewMode) ids.forEach((id) => updatePreviewSchedule(id, { status, reviewNote }))
      else await reviewWorkScheduleBatch(ids, status, reviewNote)
      setSchedules((prev) => prev.map((item) => ids.includes(item.id) ? { ...item, status, reviewNote } : item))
      setMessage(
        status === 'Approved'
          ? `Đã xác nhận toàn bộ bảng gồm ${ids.length} ca.`
          : 'Đã từ chối bảng lịch và gửi thông báo cho nhân viên.'
      )
      setRejectingBatch(null)
      setRejectReason('')
    } catch {
      setMessage('Không thể cập nhật. Kiểm tra tài khoản hiện tại có role admin trong employees/{uid}.')
    } finally {
      setProcessingId('')
      setProcessingAction('')
    }
  }

  if ((!role || !['admin', 'manager'].includes(role)) && !isPreviewMode) {
    return (
      <main className="min-h-screen">
        <Header title="Trung tâm quản lý" />
        <PageContainer><div className="mobile-card p-8 text-center font-bold">Tài khoản này không có quyền quản lý.</div></PageContainer>
      </main>
    )
  }

  return (
    <main className="min-h-screen pb-8">
      <Header title="Trung tâm quản lý" subtitle="Duyệt lịch và theo dõi nhân viên" />
      <PageContainer maxWidth="2xl">
        <Link href="/admin/requests" className="mb-4 flex min-h-14 items-center gap-3 rounded-2xl bg-indigo-600 px-4 text-white shadow-lg shadow-indigo-600/20">
          <ClipboardCheck className="h-5 w-5" />
          <div className="min-w-0 flex-1">
            <p className="font-extrabold">Duyệt yêu cầu khác</p>
            <p className="truncate text-xs text-indigo-100">Xin nghỉ · Đi trễ · Ứng lương</p>
          </div>
          <ChevronRight className="h-5 w-5" />
        </Link>
        <section className="grid grid-cols-3 gap-2">
          {[
            { label: 'Đang hoạt động', value: activeEmployees.length, icon: UsersRound, color: 'bg-indigo-600' },
            { label: 'Bảng chờ', value: pendingBatches.length, icon: CalendarCheck, color: 'bg-amber-500' },
            { label: 'Đã gửi lịch', value: `${submittedEmployees}/${weeklyTarget}`, icon: Check, color: 'bg-emerald-600' },
          ].map(({ label, value, icon: Icon, color }) => (
            <article key={label} className="mobile-card p-3">
              <div className={`grid h-9 w-9 place-items-center rounded-xl text-white ${color}`}><Icon className="h-4 w-4" /></div>
              <p className="mt-3 text-xl font-black">{value}</p>
              <p className="truncate text-[11px] font-semibold text-muted-foreground">{label}</p>
            </article>
          ))}
        </section>
        <section className="mt-3 flex items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
          <label className="min-w-0 flex-1 text-xs font-bold text-muted-foreground">Số nhân viên cần gửi lịch tuần này
            <input type="number" min="1" inputMode="numeric" value={expectedEmployees || ''} onChange={(event) => setExpectedEmployees(Math.max(0, Number(event.target.value) || 0))} className="mobile-field mt-2" placeholder={String(activeEmployees.length)} />
          </label>
          <button type="button" disabled={savingTarget} onClick={() => void saveWeeklyTarget()} className="min-h-12 rounded-2xl bg-slate-950 px-5 text-sm font-bold text-white disabled:opacity-60 dark:bg-white dark:text-slate-950">{savingTarget ? 'Đang lưu...' : 'Lưu'}</button>
        </section>

        <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
          <button type="button" onClick={() => setTab('requests')} className={`min-h-11 rounded-xl text-sm font-bold ${tab === 'requests' ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-950' : 'text-muted-foreground'}`}>Lịch chờ duyệt</button>
          <button type="button" onClick={() => setTab('employees')} className={`min-h-11 rounded-xl text-sm font-bold ${tab === 'employees' ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-950' : 'text-muted-foreground'}`}>Nhân viên</button>
        </div>

        {message && <p className="mt-4 rounded-2xl bg-indigo-50 p-3 text-sm font-semibold text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200">{message}</p>}

        {loading ? (
          <div className="grid min-h-56 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>
        ) : tab === 'requests' ? (
          <section id="schedules" className="mt-5 space-y-3">
            {pendingBatches.map((batch) => {
              const startDate = toDate(batch.schedules[0].date)
              const endDate = toDate(batch.schedules[batch.schedules.length - 1].date)
              const employee = employees.find((item) => item.uid === batch.employeeId)
              const noShifts = batch.schedules.some((item) => item.note?.includes('[NO_SHIFTS]'))
              const weekNote = batch.schedules.map((item) => item.note?.match(/\[WEEK_NOTE\]\s*([^\[]+)/)?.[1]?.trim()).find(Boolean)
              return (
                <article key={batch.key} className={`overflow-hidden rounded-[1.75rem] border bg-white shadow-sm transition dark:bg-slate-900 ${batch.isEditing ? 'border-slate-300 opacity-55 grayscale-[.35] dark:border-slate-700' : batch.requiresReapproval ? 'border-amber-300 dark:border-amber-500/30' : 'border-indigo-100 dark:border-indigo-500/20'}`}>
                  <div className={`p-4 text-white ${batch.isEditing ? 'bg-slate-600' : batch.requiresReapproval ? 'bg-gradient-to-r from-amber-500 to-orange-600' : 'bg-gradient-to-r from-indigo-600 to-violet-600'}`}>
                  <div className="flex items-start gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-950 text-xs font-black text-white">
                      {(batch.employeeName || 'NV').split(' ').slice(-2).map((word) => word[0]).join('')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-extrabold">{batch.employeeName || batch.employeeId}</h3>
                      <p className="text-xs text-indigo-100">{batch.employeeCode || 'Nhân viên'} · {startDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}–{endDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</p>
                      <p className="mt-1 text-xs font-semibold text-white/80">{noShifts ? 'Tuần này không đăng ký ca nào' : `${batch.schedules.filter((item) => !item.note?.includes('[DUTY_ONLY]')).length} ca trong bảng`}</p>
                      <Badge className="mt-2 border-white/20 bg-white/15 text-white">
                        {batch.isEditing ? 'Đang sửa' : batch.requiresReapproval ? 'Cần xác nhận lại' : 'Chờ xác nhận'}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <a href={`tel:${employee?.phone || ''}`} className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-white/15 text-sm font-bold"><Phone className="h-4 w-4" /> Gọi điện</a>
                    <a href={employee?.facebookUrl || 'https://facebook.com/'} target="_blank" rel="noreferrer" className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-bold"><ExternalLink className="h-4 w-4" /> Mở Facebook</a>
                  </div>
                  </div>
                  {weekNote && <div className="border-b border-slate-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-950 dark:border-white/10 dark:bg-indigo-500/10 dark:text-indigo-100"><strong>Ghi chú:</strong> {weekNote}</div>}
                  <div className="divide-y divide-slate-100 px-3 dark:divide-white/10">
                    {Array.from(new Map(batch.schedules.map((schedule) => {
                      const date = toDate(schedule.date)
                      const dayKey = date.toISOString().slice(0, 10)
                      return [dayKey, { date, rows: batch.schedules.filter((item) => toDate(item.date).toISOString().slice(0, 10) === dayKey) }]
                    })).values()).filter(({ rows }) => !rows.some((item) => item.note?.includes('[NO_SHIFTS]'))).map(({ date, rows }) => (
                      <div key={date.toISOString()} className="flex items-start gap-3 py-3 text-sm">
                        <span className="w-24 shrink-0 font-extrabold capitalize">{date.toLocaleDateString('vi-VN', { weekday: 'long' })}</span>
                        <span className="text-muted-foreground">
                          {rows.filter((item) => !item.note?.includes('[DUTY_ONLY]')).map((item) =>
                            item.note?.includes('[CUSTOM:') ? 'tùy chỉnh' : shortShiftLabel[item.shift]
                          ).join(' – ')}
                          {rows.some((item) => item.note?.includes('[DUTY')) && <strong className="text-rose-600">{rows.some((item) => !item.note?.includes('[DUTY_ONLY]')) ? ' + ' : ''}trực</strong>}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-3 dark:border-white/10">
                    <button disabled={processingId === batch.key || batch.isEditing} onClick={() => { setRejectingBatch(batch); setRejectReason('') }} className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-rose-200 text-sm font-bold text-rose-600 disabled:cursor-not-allowed disabled:opacity-40">
                      {processingId === batch.key && processingAction === 'reject' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} Từ chối
                    </button>
                    <button disabled={processingId === batch.key || batch.isEditing} onClick={() => review(batch, 'Approved')} className="flex min-h-11 items-center justify-center gap-1 rounded-xl bg-emerald-600 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
                      {processingId === batch.key && processingAction === 'approve' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Xác nhận
                    </button>
                  </div>
                </article>
              )
            })}
            {!pendingBatches.length && <div className="mobile-card p-8 text-center"><Check className="mx-auto h-8 w-8 text-emerald-600" /><h3 className="mt-3 font-extrabold">Đã xử lý hết</h3><p className="text-sm text-muted-foreground">Không còn bảng lịch chờ duyệt.</p></div>}
          </section>
        ) : (
          <section id="employees" className="mt-5 space-y-3">
            {activeEmployees.map((employee) => (
              <Link key={employee.uid} href={`/admin/employees/${employee.uid}`} className="mobile-card flex min-h-20 items-center gap-3 p-3">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-indigo-50 font-black text-indigo-600 dark:bg-indigo-500/10">
                  {employee.fullName.split(' ').slice(-2).map((word) => word[0]).join('')}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-extrabold">{employee.fullName}</h3>
                  <p className="text-xs text-muted-foreground">{employee.employeeCode} · {employee.phone || 'Chưa có SĐT'}</p>
                </div>
                <Badge variant="success">Đang làm tháng này</Badge>
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
              </Link>
            ))}
          </section>
        )}

        <div className="mt-6 flex gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Mỗi nhân viên chỉ có một bảng cho tuần kế tiếp. Bảng đang sửa sẽ tạm khóa thao tác xác nhận.
        </div>
      </PageContainer>

      {rejectingBatch && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => !processingId && setRejectingBatch(null)}>
          <section className="w-full max-w-lg rounded-t-[2rem] bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl dark:bg-slate-900 sm:rounded-[2rem]" onClick={(event) => event.stopPropagation()}>
            <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-slate-200 dark:bg-slate-700 sm:hidden" />
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

            <div className="mt-5 grid grid-cols-[.8fr_1.2fr] gap-2">
              <button type="button" disabled={!!processingId} onClick={() => setRejectingBatch(null)} className="min-h-12 rounded-2xl border border-slate-200 font-bold dark:border-slate-700">Hủy</button>
              <button type="button" disabled={!rejectReason.trim() || !!processingId} onClick={() => review(rejectingBatch, 'Rejected', rejectReason.trim())} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 font-bold text-white disabled:opacity-50">
                {processingId === rejectingBatch.key && processingAction === 'reject' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                {processingId ? 'Đang từ chối...' : 'Từ chối bảng lịch'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
