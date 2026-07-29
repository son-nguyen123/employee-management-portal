'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { CalendarDays, CircleDollarSign, Clock3, ExternalLink, FileText, Loader2, Phone, UserRound } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import { getEmployeeByUID } from '@/lib/services/employeeService'
import { getEmployeeSchedules } from '@/lib/services/scheduleService'
import { getEmployeeLeaves } from '@/lib/services/leaveService'
import { getEmployeeLateRequests } from '@/lib/services/lateService'
import { getEmployeeSalaryAdvances } from '@/lib/services/salaryService'
import { getPreviewSchedules } from '@/lib/services/previewWorkflow'
import type { Employee, LateRequest, LeaveRequest, SalaryAdvance, WorkSchedule } from '@/lib/models/types'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { Badge } from '@/components/ui/badge'

type DetailSchedule = WorkSchedule & { id: string }
type ActivityStatus = WorkSchedule['status'] | LeaveRequest['status'] | LateRequest['status'] | SalaryAdvance['status']
type Activity = {
  id: string
  type: 'schedule' | 'leave' | 'late' | 'salary'
  title: string
  summary: string
  status: ActivityStatus
  sortAt: Date
  note?: string
  reviewNote?: string
  schedules?: DetailSchedule[]
}

const shiftLabel = { Morning: 'sáng', Afternoon: 'chiều', Evening: 'tối' }

function toDate(value: Date | { toDate(): Date } | undefined) {
  if (!value) return new Date(0)
  return value instanceof Date ? value : value.toDate()
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function mondayKey(date: Date) {
  const monday = new Date(date)
  const weekday = monday.getDay() || 7
  monday.setDate(monday.getDate() - weekday + 1)
  monday.setHours(0, 0, 0, 0)
  return localDateKey(monday)
}

function statusLabel(status: ActivityStatus) {
  if (status === 'Approved') return 'Đã chấp nhận'
  if (status === 'Rejected') return 'Đã từ chối'
  if (status === 'Cancelled') return 'Đã hủy'
  if (status === 'ChangesRequested') return 'Cần chỉnh sửa'
  if (status === 'Editing') return 'Đang chỉnh sửa'
  return 'Đang xử lý'
}

function statusVariant(status: ActivityStatus): 'success' | 'destructive' | 'warning' | 'outline' {
  if (status === 'Approved') return 'success'
  if (status === 'Rejected') return 'destructive'
  if (status === 'Cancelled') return 'outline'
  return 'warning'
}

function cleanScheduleNote(note: string) {
  return note
    .replace(/\[WEEK_NOTE\]\s*[^\[]+/g, '')
    .replace(/\[(?:CUSTOM:[^\]]+|DUTY(?:_ONLY)?|NO_SHIFTS)\]/g, '')
    .replace(/Trực 17:00–17:30/g, '')
    .trim()
}

function buildScheduleActivities(schedules: DetailSchedule[]): Activity[] {
  const groups = new Map<string, DetailSchedule[]>()
  schedules.forEach((schedule) => {
    const key = schedule.batchKey || `${schedule.employeeId}-${mondayKey(toDate(schedule.date))}`
    groups.set(key, [...(groups.get(key) || []), schedule])
  })
  return Array.from(groups.entries()).map(([key, rows]) => {
    const sorted = [...rows].sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime())
    const firstDate = toDate(sorted[0].date)
    const weekStart = new Date(firstDate)
    const weekday = weekStart.getDay() || 7
    weekStart.setDate(weekStart.getDate() - weekday + 1)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 6)
    const statuses = new Set(rows.map((row) => row.status))
    const status: ActivityStatus = statuses.has('Editing') ? 'Editing'
      : statuses.has('Pending') || statuses.has('Registered') ? 'Pending'
        : statuses.has('ChangesRequested') ? 'ChangesRequested'
          : statuses.has('Rejected') ? 'Rejected'
            : statuses.has('Approved') ? 'Approved'
              : rows[0].status
    const weekNote = rows.map((row) => row.note?.match(/\[WEEK_NOTE\]\s*([^\[]+)/)?.[1]?.trim()).find(Boolean)
    const shiftCount = rows.filter((row) => !row.note?.includes('[DUTY_ONLY]') && !row.note?.includes('[NO_SHIFTS]')).length
    return {
      id: `schedule-${key}`,
      type: 'schedule',
      title: 'Bảng lịch làm tuần',
      summary: `${weekStart.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}–${weekEnd.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })} · ${shiftCount ? `${shiftCount} ca` : 'nghỉ cả tuần'}`,
      status,
      sortAt: rows.reduce((latest, row) => toDate(row.updatedAt) > latest ? toDate(row.updatedAt) : latest, new Date(0)),
      note: weekNote,
      reviewNote: rows.map((row) => row.reviewNote).find(Boolean),
      schedules: sorted,
    }
  })
}

export default function EmployeeDetailPage() {
  const params = useParams<{ uid: string }>()
  const { authUser, isPreviewMode } = useAuth()
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [schedules, setSchedules] = useState<DetailSchedule[]>([])
  const [otherActivities, setOtherActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!authUser) return
    const load = async () => {
      try {
        if (isPreviewMode) {
          const rows = getPreviewSchedules().filter((item) => item.employeeId === params.uid)
          const first = rows[0]
          if (first) setEmployee({ uid: first.employeeId, fullName: first.employeeName, employeeCode: first.employeeCode, phone: first.phone, facebookUrl: first.facebookUrl, email: `${first.employeeCode.toLowerCase()}@example.com`, role: 'employee', status: 'active', joinDate: new Date(), createdAt: new Date(), updatedAt: new Date() })
          setSchedules(rows.map((item) => ({ id: item.id, employeeId: item.employeeId, date: new Date(item.date), shift: item.shift, status: item.status, note: item.note, reviewNote: item.reviewNote, createdAt: new Date(item.date), updatedAt: new Date(item.date) })))
          return
        }
        const [employeeData, scheduleData, leaves, lates, salaries] = await Promise.all([
          getEmployeeByUID(params.uid),
          getEmployeeSchedules(params.uid),
          getEmployeeLeaves(params.uid),
          getEmployeeLateRequests(params.uid),
          getEmployeeSalaryAdvances(params.uid),
        ])
        setEmployee(employeeData)
        setSchedules(scheduleData.map((item) => ({ ...item, id: item.id! })))
        setOtherActivities([
          ...leaves.map((item): Activity => ({ id: `leave-${item.id}`, type: 'leave', title: 'Yêu cầu xin nghỉ', summary: `${toDate(item.leaveDate).toLocaleDateString('vi-VN')}${item.endDate ? `–${toDate(item.endDate).toLocaleDateString('vi-VN')}` : ''}`, status: item.status, sortAt: toDate(item.updatedAt), note: item.reason, reviewNote: item.reviewNote })),
          ...lates.map((item): Activity => ({ id: `late-${item.id}`, type: 'late', title: 'Thông báo đi trễ', summary: `${toDate(item.date).toLocaleDateString('vi-VN')} · ${item.lateMinutes} phút${item.expectedArrival ? ` · đến lúc ${item.expectedArrival}` : ''}`, status: item.status, sortAt: toDate(item.updatedAt), note: item.reason, reviewNote: item.reviewNote })),
          ...salaries.map((item): Activity => ({ id: `salary-${item.id}`, type: 'salary', title: 'Yêu cầu ứng lương', summary: `${Number(item.amount).toLocaleString('vi-VN')}đ`, status: item.status, sortAt: toDate(item.updatedAt), note: item.reason, reviewNote: item.reviewNote })),
        ])
      } catch {
        setMessage('Không thể tải đầy đủ lịch sử hoạt động của nhân viên.')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [authUser, isPreviewMode, params.uid])

  const activities = useMemo(() => [...buildScheduleActivities(schedules), ...otherActivities].sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime()), [schedules, otherActivities])
  const activityMeta = {
    schedule: { icon: CalendarDays, color: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10' },
    leave: { icon: FileText, color: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10' },
    late: { icon: Clock3, color: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10' },
    salary: { icon: CircleDollarSign, color: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10' },
  }

  return (
    <main className="min-h-screen pb-8">
      <Header title="Chi tiết nhân viên" subtitle="Hồ sơ và lịch sử yêu cầu" />
      <PageContainer>
        {loading ? <div className="grid min-h-64 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div> : !employee ? <div className="mobile-card p-8 text-center font-bold">Không tìm thấy nhân viên.</div> : <>
          <section className="overflow-hidden rounded-3xl bg-slate-950 p-5 text-white">
            <div className="flex items-center gap-4"><div className="grid h-16 w-16 place-items-center rounded-3xl bg-indigo-600"><UserRound className="h-7 w-7" /></div><div className="min-w-0"><h1 className="truncate text-xl font-black">{employee.fullName}</h1><p className="text-sm text-slate-300">{employee.employeeCode} · {employee.status === 'active' ? 'Đang làm việc' : 'Tạm nghỉ'}</p><p className="mt-1 truncate text-xs text-slate-400">{employee.email}</p></div></div>
            <div className="mt-5 grid grid-cols-2 gap-2"><a href={`tel:${employee.phone}`} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-white/10 text-sm font-bold"><Phone className="h-4 w-4" /> Gọi điện</a><a href={employee.facebookUrl || 'https://facebook.com/'} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-blue-600 text-sm font-bold"><ExternalLink className="h-4 w-4" /> Mở Facebook</a></div>
          </section>
          {message && <p className="mt-4 rounded-2xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">{message}</p>}
          <section className="mt-6"><div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-black">Lịch sử hoạt động</h2><Badge variant="outline">{activities.length} yêu cầu</Badge></div><div className="space-y-3">
            {activities.map((activity) => { const meta = activityMeta[activity.type]; const Icon = meta.icon; return <details key={activity.id} className="mobile-card overflow-hidden"><summary className="cursor-pointer list-none p-4"><div className="flex items-start gap-3"><div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${meta.color}`}><Icon className="h-5 w-5" /></div><div className="min-w-0 flex-1"><h3 className="font-extrabold">{activity.title}</h3><p className="mt-1 text-xs text-muted-foreground">{activity.summary}</p></div><Badge variant={statusVariant(activity.status)}>{statusLabel(activity.status)}</Badge></div></summary><div className="border-t border-slate-100 bg-white px-4 py-3 dark:border-white/10 dark:bg-slate-900">
              {activity.schedules && <div className="divide-y divide-slate-100 dark:divide-white/10">{Array.from(new Map(activity.schedules.map((row) => { const key = localDateKey(toDate(row.date)); return [key, { date: toDate(row.date), rows: activity.schedules!.filter((item) => localDateKey(toDate(item.date)) === key) }] })).values()).filter(({ rows }) => !rows.some((row) => row.note?.includes('[NO_SHIFTS]'))).map(({ date, rows }) => <div key={localDateKey(date)} className="flex gap-3 py-2 text-sm"><span className="w-24 shrink-0 font-bold capitalize">{date.toLocaleDateString('vi-VN', { weekday: 'long' })}</span><span className="text-muted-foreground">{rows.filter((row) => !row.note?.includes('[DUTY_ONLY]')).map((row) => shiftLabel[row.shift]).join(' – ')}{rows.some((row) => row.note?.includes('[DUTY')) ? ' + trực' : ''}</span></div>)}</div>}
              {activity.note && <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:bg-slate-800 dark:text-slate-200"><strong>Ghi chú:</strong> {activity.note}</p>}
              {activity.schedules?.map((row) => cleanScheduleNote(row.note)).find(Boolean) && <p className="mt-2 text-xs text-muted-foreground">Chi tiết ca: {activity.schedules.map((row) => cleanScheduleNote(row.note)).filter(Boolean).join(' · ')}</p>}
              {activity.reviewNote && <p className="mt-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900"><strong>Phản hồi:</strong> {activity.reviewNote}</p>}
              {!['Approved', 'Rejected', 'Cancelled'].includes(activity.status) && <p className="mt-3 text-xs font-semibold text-amber-700">Yêu cầu đang được xử lý.</p>}
            </div></details> })}
            {!activities.length && <div className="mobile-card p-8 text-center"><CalendarDays className="mx-auto h-8 w-8 text-slate-400" /><p className="mt-3 font-bold">Nhân viên chưa có hoạt động.</p></div>}
          </div></section>
        </>}
      </PageContainer>
    </main>
  )
}
