'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { CalendarDays, Check, Clock3, ExternalLink, Loader2, MessageSquareText, Phone, UserRound, X } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import { getEmployeeByUID } from '@/lib/services/employeeService'
import { getEmployeeSchedules, reviewWorkSchedule } from '@/lib/services/scheduleService'
import { getPreviewSchedules, updatePreviewSchedule } from '@/lib/services/previewWorkflow'
import type { Employee, WorkSchedule } from '@/lib/models/types'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { Badge } from '@/components/ui/badge'

type DetailSchedule = WorkSchedule & { id: string }
const shiftLabel = { Morning: 'Ca sáng', Afternoon: 'Ca chiều', Evening: 'Ca tối' }

export default function EmployeeDetailPage() {
  const params = useParams<{ uid: string }>()
  const { authUser, isPreviewMode } = useAuth()
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [schedules, setSchedules] = useState<DetailSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!authUser) return
    const load = async () => {
      try {
        if (isPreviewMode) {
          const rows = getPreviewSchedules().filter((item) => item.employeeId === params.uid)
          const first = rows[0]
          if (first) {
            setEmployee({
              uid: first.employeeId,
              fullName: first.employeeName,
              employeeCode: first.employeeCode,
              phone: first.phone,
              email: `${first.employeeCode.toLowerCase()}@example.com`,
              role: 'employee',
              status: 'active',
              joinDate: new Date(),
              createdAt: new Date(),
              updatedAt: new Date(),
            })
          }
          setSchedules(rows.map((item) => ({
            id: item.id,
            employeeId: item.employeeId,
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
        const [employeeData, scheduleData] = await Promise.all([
          getEmployeeByUID(params.uid),
          getEmployeeSchedules(params.uid),
        ])
        setEmployee(employeeData)
        setSchedules(scheduleData.map((item) => ({ ...item, id: item.id! })))
      } catch {
        setMessage('Không thể tải chi tiết nhân viên.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [authUser, isPreviewMode, params.uid])

  const review = async (schedule: DetailSchedule, status: 'Approved' | 'Rejected' | 'ChangesRequested') => {
    const note = status === 'Approved'
      ? ''
      : window.prompt(status === 'Rejected' ? 'Lý do từ chối:' : 'Nội dung cần chỉnh sửa:')?.trim() || ''
    if (status !== 'Approved' && !note) return
    try {
      if (isPreviewMode) updatePreviewSchedule(schedule.id, { status, reviewNote: note })
      else await reviewWorkSchedule(schedule.id, status, note)
      setSchedules((prev) => prev.map((item) => item.id === schedule.id ? { ...item, status, reviewNote: note } : item))
      setMessage('Đã cập nhật trạng thái ca làm.')
    } catch {
      setMessage('Không thể cập nhật. Vui lòng kiểm tra quyền quản lý.')
    }
  }

  return (
    <main className="min-h-screen pb-8">
      <Header title="Chi tiết nhân viên" subtitle="Hồ sơ và lịch làm việc" />
      <PageContainer>
        {loading ? (
          <div className="grid min-h-64 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>
        ) : !employee ? (
          <div className="mobile-card p-8 text-center font-bold">Không tìm thấy nhân viên.</div>
        ) : (
          <>
            <section className="overflow-hidden rounded-3xl bg-slate-950 text-white">
              <div className="p-5">
                <div className="flex items-center gap-4">
                  <div className="grid h-16 w-16 place-items-center rounded-3xl bg-indigo-600"><UserRound className="h-7 w-7" /></div>
                  <div className="min-w-0">
                    <h1 className="truncate text-xl font-black">{employee.fullName}</h1>
                    <p className="text-sm text-slate-300">{employee.employeeCode} · {employee.status === 'active' ? 'Đang làm việc' : 'Tạm nghỉ'}</p>
                    <p className="mt-1 truncate text-xs text-slate-400">{employee.email}</p>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <a href={`tel:${employee.phone}`} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-white/10 text-sm font-bold"><Phone className="h-4 w-4" /> Gọi điện</a>
                  <a href="https://facebook.com/" target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-blue-600 text-sm font-bold"><ExternalLink className="h-4 w-4" /> Mở Facebook</a>
                </div>
              </div>
            </section>

            {message && <p className="mt-4 rounded-2xl bg-indigo-50 p-3 text-sm font-semibold text-indigo-800">{message}</p>}

            <section className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xl font-black">Lịch làm đã gửi</h2>
                <Badge variant="outline">{schedules.length} ca</Badge>
              </div>
              <div className="space-y-3">
                {schedules.map((schedule) => {
                  const date = schedule.date instanceof Date ? schedule.date : schedule.date.toDate()
                  const pending = ['Registered', 'Pending'].includes(schedule.status)
                  return (
                    <article key={schedule.id} className="mobile-card p-4">
                      <div className="flex items-start gap-3">
                        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10"><Clock3 className="h-5 w-5" /></div>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-extrabold">{shiftLabel[schedule.shift]}</h3>
                          <p className="text-xs text-muted-foreground">{date.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</p>
                          {schedule.note && <p className="mt-2 text-xs text-muted-foreground">{schedule.note}</p>}
                        </div>
                        <Badge variant={schedule.status === 'Approved' ? 'success' : schedule.status === 'Rejected' ? 'destructive' : 'warning'}>
                          {schedule.status === 'Approved' ? 'Đã duyệt' : schedule.status === 'Rejected' ? 'Từ chối' : schedule.status === 'ChangesRequested' ? 'Cần sửa' : 'Chờ duyệt'}
                        </Badge>
                      </div>
                      {schedule.reviewNote && <p className="mt-3 rounded-xl bg-amber-50 p-2 text-xs text-amber-800">Phản hồi: {schedule.reviewNote}</p>}
                      {pending && (
                        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 dark:border-white/10">
                          <button onClick={() => review(schedule, 'Rejected')} className="flex min-h-10 items-center justify-center gap-1 rounded-xl border border-rose-200 text-xs font-bold text-rose-600"><X className="h-3.5 w-3.5" /> Từ chối</button>
                          <button onClick={() => review(schedule, 'ChangesRequested')} className="flex min-h-10 items-center justify-center gap-1 rounded-xl border border-amber-200 text-xs font-bold text-amber-700"><MessageSquareText className="h-3.5 w-3.5" /> Yêu cầu sửa</button>
                          <button onClick={() => review(schedule, 'Approved')} className="flex min-h-10 items-center justify-center gap-1 rounded-xl bg-emerald-600 text-xs font-bold text-white"><Check className="h-3.5 w-3.5" /> Duyệt</button>
                        </div>
                      )}
                    </article>
                  )
                })}
                {!schedules.length && <div className="mobile-card p-8 text-center"><CalendarDays className="mx-auto h-8 w-8 text-slate-400" /><p className="mt-3 font-bold">Nhân viên chưa gửi lịch.</p></div>}
              </div>
            </section>
          </>
        )}
      </PageContainer>
    </main>
  )
}
