'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarCheck, Check, ChevronRight, ClipboardCheck, Loader2, MessageSquareText, UsersRound, X } from 'lucide-react'
import { useAuth, useUserRole } from '@/lib/hooks/useAuth'
import { getAllEmployees } from '@/lib/services/employeeService'
import { getAllSchedules, reviewWorkSchedule } from '@/lib/services/scheduleService'
import { getPreviewSchedules, updatePreviewSchedule } from '@/lib/services/previewWorkflow'
import type { Employee, WorkSchedule } from '@/lib/models/types'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { Badge } from '@/components/ui/badge'

type ScheduleRow = WorkSchedule & {
  id: string
  employeeName?: string
  employeeCode?: string
}

const shiftLabel = { Morning: 'Ca sáng', Afternoon: 'Ca chiều', Evening: 'Ca tối' }

export default function AdminDashboardPage() {
  const { authUser, isPreviewMode } = useAuth()
  const role = useUserRole()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [schedules, setSchedules] = useState<ScheduleRow[]>([])
  const [tab, setTab] = useState<'requests' | 'employees'>('requests')
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState('')
  const [message, setMessage] = useState('')

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
        const [employeeData, scheduleData] = await Promise.all([getAllEmployees(), getAllSchedules()])
        setEmployees(employeeData)
        setSchedules(scheduleData.map((schedule) => {
          const employee = employeeData.find((item) => item.uid === schedule.employeeId)
          return { ...schedule, id: schedule.id!, employeeName: employee?.fullName, employeeCode: employee?.employeeCode }
        }))
      } catch {
        setMessage('Chưa tải được dữ liệu quản lý. Hãy kiểm tra quyền admin trong Firestore.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [authUser, isPreviewMode])

  const pending = useMemo(
    () => schedules.filter((item) => ['Registered', 'Pending'].includes(item.status)),
    [schedules]
  )

  const review = async (schedule: ScheduleRow, status: 'Approved' | 'Rejected' | 'ChangesRequested') => {
    let reviewNote = ''
    if (status !== 'Approved') {
      reviewNote = window.prompt(
        status === 'Rejected' ? 'Nhập lý do từ chối lịch:' : 'Nhập nội dung cần nhân viên chỉnh sửa:'
      )?.trim() || ''
      if (!reviewNote) return
    }
    setProcessingId(schedule.id)
    setMessage('')
    try {
      if (isPreviewMode) updatePreviewSchedule(schedule.id, { status, reviewNote })
      else await reviewWorkSchedule(schedule.id, status, reviewNote)
      setSchedules((prev) => prev.map((item) => item.id === schedule.id ? { ...item, status, reviewNote } : item))
      setMessage(
        status === 'Approved'
          ? 'Đã xác nhận và khóa ca làm.'
          : status === 'Rejected'
            ? 'Đã từ chối ca làm.'
            : 'Đã gửi yêu cầu chỉnh sửa cho nhân viên.'
      )
    } catch {
      setMessage('Không thể cập nhật. Kiểm tra tài khoản hiện tại có role admin trong employees/{uid}.')
    } finally {
      setProcessingId('')
    }
  }

  if (role !== 'admin' && !isPreviewMode) {
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
            { label: 'Nhân viên', value: employees.length, icon: UsersRound, color: 'bg-indigo-600' },
            { label: 'Chờ duyệt', value: pending.length, icon: CalendarCheck, color: 'bg-amber-500' },
            { label: 'Đã duyệt', value: schedules.filter((item) => item.status === 'Approved').length, icon: Check, color: 'bg-emerald-600' },
          ].map(({ label, value, icon: Icon, color }) => (
            <article key={label} className="mobile-card p-3">
              <div className={`grid h-9 w-9 place-items-center rounded-xl text-white ${color}`}><Icon className="h-4 w-4" /></div>
              <p className="mt-3 text-xl font-black">{value}</p>
              <p className="truncate text-[11px] font-semibold text-muted-foreground">{label}</p>
            </article>
          ))}
        </section>

        <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
          <button type="button" onClick={() => setTab('requests')} className={`min-h-11 rounded-xl text-sm font-bold ${tab === 'requests' ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-950' : 'text-muted-foreground'}`}>Lịch chờ duyệt</button>
          <button type="button" onClick={() => setTab('employees')} className={`min-h-11 rounded-xl text-sm font-bold ${tab === 'employees' ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-950' : 'text-muted-foreground'}`}>Nhân viên</button>
        </div>

        {message && <p className="mt-4 rounded-2xl bg-indigo-50 p-3 text-sm font-semibold text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200">{message}</p>}

        {loading ? (
          <div className="grid min-h-56 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>
        ) : tab === 'requests' ? (
          <section className="mt-5 space-y-3">
            {pending.map((schedule) => {
              const date = schedule.date instanceof Date ? schedule.date : schedule.date.toDate()
              return (
                <article key={schedule.id} className="mobile-card p-4">
                  <Link href={`/admin/employees/${schedule.employeeId}`} className="flex items-start gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-950 text-xs font-black text-white">
                      {(schedule.employeeName || 'NV').split(' ').slice(-2).map((word) => word[0]).join('')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-extrabold">{schedule.employeeName || schedule.employeeId}</h3>
                      <p className="text-xs text-muted-foreground">{schedule.employeeCode || 'Nhân viên'} · {date.toLocaleDateString('vi-VN')}</p>
                      <p className="mt-2 text-sm font-bold text-indigo-600">{shiftLabel[schedule.shift]}</p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-slate-400" />
                  </Link>
                  <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 dark:border-white/10">
                    <button disabled={processingId === schedule.id} onClick={() => review(schedule, 'Rejected')} className="flex min-h-10 items-center justify-center gap-1 rounded-xl border border-rose-200 text-xs font-bold text-rose-600">
                      <X className="h-3.5 w-3.5" /> Từ chối
                    </button>
                    <button disabled={processingId === schedule.id} onClick={() => review(schedule, 'ChangesRequested')} className="flex min-h-10 items-center justify-center gap-1 rounded-xl border border-amber-200 text-xs font-bold text-amber-700">
                      <MessageSquareText className="h-3.5 w-3.5" /> Yêu cầu sửa
                    </button>
                    <button disabled={processingId === schedule.id} onClick={() => review(schedule, 'Approved')} className="flex min-h-10 items-center justify-center gap-1 rounded-xl bg-emerald-600 text-xs font-bold text-white">
                      {processingId === schedule.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Duyệt
                    </button>
                  </div>
                </article>
              )
            })}
            {!pending.length && <div className="mobile-card p-8 text-center"><Check className="mx-auto h-8 w-8 text-emerald-600" /><h3 className="mt-3 font-extrabold">Đã xử lý hết</h3><p className="text-sm text-muted-foreground">Không còn lịch chờ duyệt.</p></div>}
          </section>
        ) : (
          <section id="employees" className="mt-5 space-y-3">
            {employees.map((employee) => (
              <Link key={employee.uid} href={`/admin/employees/${employee.uid}`} className="mobile-card flex min-h-20 items-center gap-3 p-3">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-indigo-50 font-black text-indigo-600 dark:bg-indigo-500/10">
                  {employee.fullName.split(' ').slice(-2).map((word) => word[0]).join('')}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-extrabold">{employee.fullName}</h3>
                  <p className="text-xs text-muted-foreground">{employee.employeeCode} · {employee.phone || 'Chưa có SĐT'}</p>
                </div>
                <Badge variant={employee.status === 'active' ? 'success' : 'outline'}>{employee.status === 'active' ? 'Đang làm' : 'Tạm nghỉ'}</Badge>
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
              </Link>
            ))}
          </section>
        )}

        <div className="mt-6 flex gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Khi duyệt, ca làm sẽ bị khóa. Nhân viên chỉ có thể xem hoặc gửi yêu cầu điều chỉnh.
        </div>
      </PageContainer>
    </main>
  )
}
