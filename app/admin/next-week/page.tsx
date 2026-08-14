'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarRange, Check, ChevronDown, Download, Loader2, Pencil, Trash2, UsersRound, X } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { useAuth, useUserRole } from '@/lib/hooks/useAuth'
import type { Employee, WorkSchedule } from '@/lib/models/types'
import { subscribeToAllEmployees } from '@/lib/services/employeeService'
import { getPreviewSchedules } from '@/lib/services/previewWorkflow'
import { adminCancelWorkSchedules, subscribeToAllSchedules } from '@/lib/services/scheduleService'
import { auth } from '@/lib/firebase'
import { employeeFactoryId } from '@/lib/models/factory'

type Shift = WorkSchedule['shift']

type ScheduleRow = WorkSchedule & {
  employeeName?: string
}

type SchedulePerson = {
  employeeId: string
  name: string
  scheduleIds: string[]
}

type DaySummary = {
  key: string
  label: string
  shifts: Record<Shift, SchedulePerson[]>
  total: number
}

type DutySummary = {
  key: string
  label: string
  people: SchedulePerson[]
}

const DUTY_TEAM_CAPACITY = 7

const shiftSections: Array<{ key: Shift; label: string; tone: string }> = [
  { key: 'Morning', label: 'Ca sáng', tone: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300' },
  { key: 'Afternoon', label: 'Ca chiều', tone: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300' },
  { key: 'Evening', label: 'Ca tối', tone: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300' },
]

function toDate(value: WorkSchedule['date']) {
  return value instanceof Date ? value : value.toDate()
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function weekDaysFrom(monday: Date) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + index)
    return {
      date,
      key: dateKey(date),
      label: index === 6 ? 'Chủ nhật' : `Thứ ${index + 2}`,
    }
  })
}

function currentWeekDays() {
  const now = new Date()
  const currentMonday = new Date(now)
  const day = now.getDay() || 7
  currentMonday.setDate(now.getDate() - day + 1)
  currentMonday.setHours(0, 0, 0, 0)
  return weekDaysFrom(currentMonday)
}

function isVisibleSchedule(schedule: WorkSchedule) {
  return !['Draft', 'Rejected', 'Cancelled'].includes(schedule.status)
    && !schedule.note?.includes('[NO_SHIFTS]')
    && !schedule.note?.includes('[DUTY_ONLY]')
}

function isDutySchedule(schedule: WorkSchedule) {
  return !['Draft', 'Rejected', 'Cancelled'].includes(schedule.status)
    && !schedule.note?.includes('[NO_SHIFTS]')
    && schedule.note?.includes('[DUTY')
}

export default function NextWeekStaffPage() {
  const { authUser, employee: currentEmployee, isPreviewMode } = useAuth()
  const role = useUserRole()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [schedules, setSchedules] = useState<ScheduleRow[]>([])
  const [employeesReady, setEmployeesReady] = useState(false)
  const [schedulesReady, setSchedulesReady] = useState(false)
  const [openDay, setOpenDay] = useState('')
  const [dutyRosterOpen, setDutyRosterOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [editor, setEditor] = useState<{ employeeId: string; name: string; dayKey: string; scheduleIds: string[] } | null>(null)
  const [editScope, setEditScope] = useState<'shift' | 'day' | 'custom' | 'week'>('shift')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [editReason, setEditReason] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [exportingNextWeek, setExportingNextWeek] = useState(false)
  const [exportingDuty, setExportingDuty] = useState(false)
  // Saturday registrations belong to the following week, but management
  // always views the week that is currently running.
  const days = useMemo(() => currentWeekDays(), [])

  useEffect(() => {
    if (!authUser) return

    if (isPreviewMode) {
      const preview = getPreviewSchedules()
      setSchedules(preview.map((item) => ({
        id: item.id,
        employeeId: item.employeeId,
        employeeName: item.employeeName,
        date: new Date(item.date),
        shift: item.shift,
        status: item.status,
        note: item.note,
        reviewNote: item.reviewNote,
        createdAt: new Date(),
        updatedAt: new Date(),
      })))
      setEmployeesReady(true)
      setSchedulesReady(true)
      return
    }

    const factoryScope = role === 'director' ? undefined : employeeFactoryId(currentEmployee)
    const unsubscribeEmployees = subscribeToAllEmployees(
      (items) => {
        setEmployees(items)
        setEmployeesReady(true)
      },
      () => {
        setMessage('Chưa tải được danh sách nhân viên.')
        setEmployeesReady(true)
      },
      factoryScope
    )
    const unsubscribeSchedules = subscribeToAllSchedules(
      (items) => {
        setSchedules(items)
        setSchedulesReady(true)
      },
      () => {
        setMessage('Chưa tải được lịch tuần này. Hãy kiểm tra quyền quản lý.')
        setSchedulesReady(true)
      },
      factoryScope,
      (() => {
        const startDate = days[0].date
        const endDate = new Date(days[6].date)
        endDate.setHours(23, 59, 59, 999)
        return { startDate, endDate }
      })()
    )

    return () => {
      unsubscribeEmployees()
      unsubscribeSchedules()
    }
  }, [authUser, currentEmployee, days, isPreviewMode, role])
  const activeEmployees = useMemo(() => employees.filter((employee) => employee.status === 'active'), [employees])
  const activeEmployeeIds = useMemo(() => new Set(activeEmployees.map((employee) => employee.uid)), [activeEmployees])
  const employeeNames = useMemo(
    () => new Map(activeEmployees.map((employee) => [employee.uid, employee.fullName])),
    [activeEmployees]
  )
  const summaries = useMemo<DaySummary[]>(() => days.map((day) => {
    const shifts: Record<Shift, Map<string, string>> = {
      Morning: new Map(),
      Afternoon: new Map(),
      Evening: new Map(),
    }

    schedules
      .filter((schedule) => activeEmployeeIds.has(schedule.employeeId) && dateKey(toDate(schedule.date)) === day.key && isVisibleSchedule(schedule))
      .forEach((schedule) => {
        const name = schedule.employeeName || employeeNames.get(schedule.employeeId) || 'Nhân viên chưa có tên'
        const current = shifts[schedule.shift].get(schedule.employeeId)
        shifts[schedule.shift].set(schedule.employeeId, current
          ? `${current}\u0000${schedule.id || ''}`
          : `${name}\u0000${schedule.id || ''}`)
      })

    const employeeIds = new Set([
      ...shifts.Morning.keys(),
      ...shifts.Afternoon.keys(),
      ...shifts.Evening.keys(),
    ])
    return {
      key: day.key,
      label: day.label,
      shifts: {
        Morning: [...shifts.Morning.entries()].map(([employeeId, packed]) => {
          const [name, ...ids] = packed.split('\u0000')
          return { employeeId, name, scheduleIds: ids.filter(Boolean) }
        }).sort((a, b) => a.name.localeCompare(b.name, 'vi')),
        Afternoon: [...shifts.Afternoon.entries()].map(([employeeId, packed]) => {
          const [name, ...ids] = packed.split('\u0000')
          return { employeeId, name, scheduleIds: ids.filter(Boolean) }
        }).sort((a, b) => a.name.localeCompare(b.name, 'vi')),
        Evening: [...shifts.Evening.entries()].map(([employeeId, packed]) => {
          const [name, ...ids] = packed.split('\u0000')
          return { employeeId, name, scheduleIds: ids.filter(Boolean) }
        }).sort((a, b) => a.name.localeCompare(b.name, 'vi')),
      },
      total: employeeIds.size,
    }
  }), [activeEmployeeIds, days, employeeNames, schedules])

  const weekTotal = useMemo(() => new Set(
    schedules
      .filter((schedule) => activeEmployeeIds.has(schedule.employeeId) && days.some((day) => day.key === dateKey(toDate(schedule.date))) && isVisibleSchedule(schedule))
      .map((schedule) => schedule.employeeId)
  ).size, [activeEmployeeIds, days, schedules])

  const dutySummaries = useMemo<DutySummary[]>(() => days.map((day) => {
    const people = new Map<string, SchedulePerson>()
    schedules
      .filter((schedule) => activeEmployeeIds.has(schedule.employeeId) && dateKey(toDate(schedule.date)) === day.key && isDutySchedule(schedule))
      .forEach((schedule) => {
        const existing = people.get(schedule.employeeId)
        const name = schedule.employeeName || employeeNames.get(schedule.employeeId) || 'Nhân viên chưa có tên'
        people.set(schedule.employeeId, {
          employeeId: schedule.employeeId,
          name,
          scheduleIds: Array.from(new Set([...(existing?.scheduleIds || []), schedule.id || ''])).filter(Boolean),
        })
      })
    return {
      key: day.key,
      label: day.label,
      people: [...people.values()].sort((left, right) => left.name.localeCompare(right.name, 'vi')),
    }
  }), [activeEmployeeIds, days, employeeNames, schedules])

  const dutyTotal = useMemo(() => dutySummaries.reduce((total, day) => total + day.people.length, 0), [dutySummaries])

  const openEditor = (person: SchedulePerson, dayKey: string) => {
    setEditor({ ...person, dayKey })
    setEditScope('shift')
    setSelectedIds(person.scheduleIds)
    setEditReason('')
  }

  const editorSchedules = useMemo(() => {
    if (!editor) return []
    return schedules.filter((schedule) =>
      schedule.employeeId === editor.employeeId &&
      days.some((day) => day.key === dateKey(toDate(schedule.date))) &&
      isVisibleSchedule(schedule) &&
      Boolean(schedule.id)
    )
  }, [days, editor, schedules])

  const chooseScope = (scope: typeof editScope) => {
    if (!editor) return
    setEditScope(scope)
    if (scope === 'shift') setSelectedIds(editor.scheduleIds)
    if (scope === 'day') setSelectedIds(editorSchedules.filter((item) => dateKey(toDate(item.date)) === editor.dayKey).map((item) => item.id!))
    if (scope === 'week') setSelectedIds(editorSchedules.map((item) => item.id!))
  }

  const submitEdit = async () => {
    if (!editor || !selectedIds.length || !editReason.trim()) return
    setSavingEdit(true)
    try {
      if (!isPreviewMode) await adminCancelWorkSchedules(selectedIds, editReason.trim())
      setSchedules((current) => current.map((item) =>
        item.id && selectedIds.includes(item.id) ? { ...item, status: 'Cancelled' } : item
      ))
      setEditor(null)
      setMessage(`Đã hủy ${selectedIds.length} ca của ${editor.name}.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể điều chỉnh lịch.')
    } finally {
      setSavingEdit(false)
    }
  }

  const exportNextWeekExcel = async () => {
    if (isPreviewMode) {
      setMessage('Chế độ xem thử không tạo file Excel.')
      return
    }
    setExportingNextWeek(true)
    setMessage('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')
      const response = await fetch('/api/exports/next-week-schedule', {
        headers: { authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(data?.error || 'Chưa thể xuất lịch nhân sự tuần này.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `lich-nhan-su-tuan-nay-${new Date().toISOString().slice(0, 10)}.xlsx`
      anchor.click()
      URL.revokeObjectURL(url)
      setMessage('Đã tải lịch nhân sự tuần này về máy.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể xuất lịch nhân sự tuần này.')
    } finally {
      setExportingNextWeek(false)
    }
  }

  const exportNextWeekDuty = async () => {
    if (isPreviewMode) {
      setMessage('Chế độ xem thử không tạo file Excel.')
      return
    }
    setExportingDuty(true)
    setMessage('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')
      const response = await fetch('/api/exports/next-week-duty', {
        headers: { authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(data?.error || 'Chưa thể xuất lịch trực tuần này.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `lich-truc-tuan-nay-${new Date().toISOString().slice(0, 10)}.xlsx`
      anchor.click()
      URL.revokeObjectURL(url)
      setMessage('Đã tải lịch trực tuần này về máy.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể xuất lịch trực tuần này.')
    } finally {
      setExportingDuty(false)
    }
  }

  if ((!role || !['admin', 'manager', 'director'].includes(role)) && !isPreviewMode) {
    return (
      <main className="min-h-screen">
        <Header title="Nhân sự tuần này" />
        <PageContainer>
          <div className="mobile-card p-8 text-center font-bold">Tài khoản này không có quyền xem lịch nhân sự.</div>
        </PageContainer>
      </main>
    )
  }

  const loading = !employeesReady || !schedulesReady

  return (
    <main className="min-h-screen pb-8">
      <Header
        title="Nhân sự tuần này"
        rightAction={(
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void exportNextWeekExcel()}
              disabled={exportingNextWeek || exportingDuty}
              className="flex min-h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-2.5 text-xs font-extrabold text-white shadow-sm shadow-emerald-600/20 transition active:scale-[.98] disabled:cursor-wait disabled:opacity-60 sm:px-3"
              aria-label="Xuất lịch nhân sự tuần này ra Excel"
            >
              {exportingNextWeek ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span className="hidden sm:inline">Excel</span>
            </button>
            <button
              type="button"
              onClick={() => void exportNextWeekDuty()}
              disabled={exportingNextWeek || exportingDuty}
              className="flex min-h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-2.5 text-xs font-extrabold text-white shadow-sm shadow-violet-600/20 transition active:scale-[.98] disabled:cursor-wait disabled:opacity-60 sm:px-3"
              aria-label="Xuất lịch trực tuần này ra Excel"
            >
              {exportingDuty ? <Loader2 className="h-4 w-4 animate-spin" /> : <UsersRound className="h-4 w-4" />}
              <span className="hidden sm:inline">Trực</span>
            </button>
          </div>
        )}
      />
      <PageContainer maxWidth="2xl">
        <section className="mb-4 flex items-center gap-3 rounded-3xl bg-gradient-to-r from-indigo-600 to-violet-600 p-4 text-white shadow-lg shadow-indigo-600/20">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15">
            <CalendarRange className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-indigo-100">
              Tuần {days[0].date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}
              {' – '}
              {days[6].date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}
            </p>
            <p className="text-xl font-black">{weekTotal} nhân viên</p>
          </div>
          <UsersRound className="h-6 w-6 text-indigo-100" />
        </section>

        <button
          type="button"
          onClick={() => setDutyRosterOpen((open) => !open)}
          className="mb-4 flex min-h-14 w-full items-center gap-3 rounded-3xl border border-violet-100 bg-white px-4 text-left shadow-sm transition active:scale-[0.99] dark:border-violet-500/30 dark:bg-slate-900"
          aria-expanded={dutyRosterOpen}
        >
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-violet-50 text-violet-600 dark:bg-violet-500/10"><UsersRound className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="block font-extrabold">Danh sách trực</span><span className="block truncate whitespace-nowrap text-[11px] text-muted-foreground">Trực mỗi ngày · tối đa {DUTY_TEAM_CAPACITY} người</span></span>
          <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-black text-violet-700 dark:bg-violet-500/10 dark:text-violet-200">{dutyTotal}</span>
          <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${dutyRosterOpen ? 'rotate-180' : ''}`} />
        </button>

        {dutyRosterOpen && (
          <section className="mb-4 space-y-2 rounded-3xl border border-violet-100 bg-violet-50/40 p-2.5 dark:border-violet-500/20 dark:bg-violet-500/5">
            {dutySummaries.map((day) => {
              const overloaded = day.people.length > DUTY_TEAM_CAPACITY
              const fill = Math.min(100, (day.people.length / DUTY_TEAM_CAPACITY) * 100)
              return (
                <article key={day.key} className={`rounded-2xl border border-slate-100 bg-white p-3.5 shadow-sm dark:border-white/10 dark:bg-slate-900 ${overloaded ? 'ring-2 ring-rose-400' : ''}`}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1"><strong className="block text-base">{day.label}</strong><p className="mt-0.5 text-xs font-medium text-muted-foreground">{day.people.length ? `${day.people.length} người đăng ký trực` : 'Chưa có người đăng ký'}</p></div>
                    {overloaded && <span className="flex items-center gap-1 text-xs font-black text-rose-600"><AlertTriangle className="h-4 w-4" /> Quá tải</span>}
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-black ${overloaded ? 'bg-rose-600 text-white' : day.people.length ? 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-200' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>{day.people.length} / {DUTY_TEAM_CAPACITY}</span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full ${overloaded ? 'bg-rose-500' : 'bg-violet-500'}`} style={{ width: `${fill}%` }} /></div>
                  {day.people.length ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {day.people.map((person) => <span key={person.employeeId} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{person.name}</span>)}
                    </div>
                  ) : null}
                </article>
              )
            })}
          </section>
        )}

        {message && (
          <p className="mb-4 rounded-2xl bg-rose-50 p-3 text-sm font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">
            {message}
          </p>
        )}

        {loading ? (
          <div className="grid min-h-56 place-items-center">
            <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
          </div>
        ) : (
          <section className="space-y-2">
            {summaries.map((day) => {
              const isOpen = openDay === day.key
              return (
                <article key={day.key} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
                  <button
                    type="button"
                    onClick={() => setOpenDay(isOpen ? '' : day.key)}
                    className="flex min-h-16 w-full items-center gap-3 px-4 text-left"
                    aria-expanded={isOpen}
                  >
                    <span className="min-w-0 flex-1 font-extrabold">{day.label}</span>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${day.total ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>
                      {day.total} nhân viên
                    </span>
                    <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {isOpen && (
                    <div className="space-y-3 border-t border-slate-100 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-slate-950/30">
                      {shiftSections.map((shift) => (
                        <section key={shift.key} className="rounded-2xl bg-white p-3 dark:bg-slate-900">
                          <div className="flex items-center justify-between gap-3">
                            <h2 className={`rounded-lg px-2 py-1 text-xs font-extrabold ${shift.tone}`}>{shift.label}</h2>
                            <span className="text-xs font-bold text-muted-foreground">{day.shifts[shift.key].length} người</span>
                          </div>
                          {day.shifts[shift.key].length ? (
                            <ul className="mt-3 space-y-2">
                              {day.shifts[shift.key].map((person) => (
                                <li key={person.employeeId} className="flex min-h-10 items-center gap-2 text-sm font-semibold">
                                  <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-500" />
                                  <span className="min-w-0 flex-1 truncate">{person.name}</span>
                                  {role === 'admin' && (
                                    <button type="button" onClick={() => openEditor(person, day.key)} aria-label={`Sửa lịch của ${person.name}`} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 active:scale-95 dark:bg-slate-800 dark:text-slate-300">
                                      <Pencil className="h-4 w-4" />
                                    </button>
                                  )}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-3 text-sm text-muted-foreground">Chưa có nhân viên.</p>
                          )}
                        </section>
                      ))}
                    </div>
                  )}
                </article>
              )
            })}
          </section>
        )}
      </PageContainer>
      {editor && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => !savingEdit && setEditor(null)}>
          <section role="dialog" aria-modal="true" aria-labelledby="schedule-editor-title" className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[2rem] bg-white shadow-2xl dark:bg-slate-900 sm:rounded-[2rem]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start gap-3 border-b border-slate-100 p-5 dark:border-white/10">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-500/10"><Pencil className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-wider text-rose-600">Điều chỉnh lịch</p><h2 id="schedule-editor-title" className="truncate text-xl font-black">{editor.name}</h2></div>
              <button type="button" onClick={() => setEditor(null)} className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 dark:bg-slate-800"><X className="h-5 w-5" /></button>
            </div>
            <div className="overflow-y-auto px-5 pb-5">
            <p className="mt-5 text-sm font-extrabold">Bạn muốn hủy như thế nào?</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {([
                ['shift', 'Ca này'],
                ['day', 'Trong ngày này'],
                ['custom', 'Chọn nhiều ca'],
                ['week', 'Toàn bộ tuần'],
              ] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => chooseScope(value)} className={`min-h-11 rounded-xl px-3 text-sm font-bold ${editScope === value ? 'bg-indigo-600 text-white' : value === 'week' ? 'border border-rose-200 text-rose-600' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>{label}</button>
              ))}
            </div>
            {editScope === 'custom' && (
              <div className="mt-4 space-y-2 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/70">
                {editorSchedules.map((schedule) => {
                  const active = selectedIds.includes(schedule.id!)
                  return (
                    <button key={schedule.id} type="button" onClick={() => setSelectedIds((current) => active ? current.filter((id) => id !== schedule.id) : [...current, schedule.id!])} className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 text-left text-sm ${active ? 'border-indigo-600 bg-indigo-50 text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'}`}>
                      <span className={`grid h-6 w-6 place-items-center rounded-lg ${active ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800'}`}>{active && <Check className="h-4 w-4" />}</span>
                      <span className="font-bold">{toDate(schedule.date).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' })} · {shiftSections.find((item) => item.key === schedule.shift)?.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
            <div className="mt-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-500/10 dark:text-rose-200"><strong>{selectedIds.length} ca sẽ bị hủy.</strong> Dữ liệu vẫn được giữ trong lịch sử và nhân viên sẽ nhận thông báo.</div>
            <label className="mt-4 block text-sm font-bold">Lý do điều chỉnh<textarea value={editReason} onChange={(event) => setEditReason(event.target.value)} maxLength={500} className="mobile-field mt-2 min-h-24 py-3" placeholder="Nhập lý do để nhân viên hiểu..." /></label>
            </div>
            <div className="border-t border-slate-100 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-white/10 dark:bg-slate-900">
            <button type="button" onClick={() => void submitEdit()} disabled={savingEdit || !selectedIds.length || !editReason.trim()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-rose-600 px-4 font-bold text-white disabled:opacity-50">
              {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} {savingEdit ? 'Đang lưu...' : `Xác nhận hủy ${selectedIds.length} ca`}
            </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
