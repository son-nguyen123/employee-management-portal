'use client'

import { useEffect, useState } from 'react'
import { CalendarDays, Check, CheckCircle2, Info, Loader2, Palmtree, Pencil, Send, Trash2 } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import { cancelLeaveRequest, createLeaveRequest, getEmployeeLeaves, reviseLeaveRequest } from '@/lib/services/leaveService'
import { mockLeaveRequests } from '@/lib/services/mockData'
import { getEmployeeSchedules } from '@/lib/services/scheduleService'
import { getPreviewSchedules } from '@/lib/services/previewWorkflow'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { Badge } from '@/components/ui/badge'

type Duration = 'short' | 'long'
type ApprovedShift = { id: string; date: Date; shift: 'Morning' | 'Afternoon' | 'Evening' }

const shiftLabels = {
  Morning: 'Ca sáng',
  Afternoon: 'Ca chiều',
  Evening: 'Ca tối',
}

export default function LeaveRequestPage() {
  const { authUser, isPreviewMode } = useAuth()
  const [duration, setDuration] = useState<Duration>('short')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [approvedShifts, setApprovedShifts] = useState<ApprovedShift[]>([])
  const [selectedScheduleId, setSelectedScheduleId] = useState('')
  const [requests, setRequests] = useState<any[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    if (!authUser) return
    const load = async () => {
      try {
        const [data, scheduleData] = isPreviewMode
          ? [mockLeaveRequests, getPreviewSchedules().filter((item) => item.employeeId === authUser.uid)]
          : await Promise.all([getEmployeeLeaves(authUser.uid), getEmployeeSchedules(authUser.uid)])
        setRequests(data.slice(0, 5))
        const now = new Date()
        const monday = new Date(now)
        const day = now.getDay() || 7
        monday.setDate(now.getDate() - day + 1)
        monday.setHours(0, 0, 0, 0)
        const sunday = new Date(monday)
        sunday.setDate(monday.getDate() + 6)
        sunday.setHours(23, 59, 59, 999)
        setApprovedShifts(scheduleData
          .filter((item) => {
            const date = item.date instanceof Date ? item.date : typeof item.date === 'string' ? new Date(item.date) : item.date.toDate()
            return item.status === 'Approved' && date >= monday && date <= sunday && !item.note?.includes('[DUTY_ONLY]')
          })
          .map((item) => ({
            id: item.id!,
            date: item.date instanceof Date ? item.date : typeof item.date === 'string' ? new Date(item.date) : item.date.toDate(),
            shift: item.shift,
          })))
      } catch {
        setRequests([])
      }
    }
    load()
  }, [authUser, isPreviewMode])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!authUser || !startDate || !reason.trim() || (duration === 'long' && !endDate)) {
      setMessage('Vui lòng điền đầy đủ thông tin.')
      return
    }
    if (duration === 'long' && new Date(endDate) < new Date(startDate)) {
      setMessage('Ngày kết thúc phải từ ngày bắt đầu trở đi.')
      return
    }
    setSubmitting(true)
    setMessage('')
    const request = {
      employeeId: authUser.uid,
      leaveDate: new Date(`${startDate}T12:00:00`),
      endDate: new Date(`${duration === 'short' ? startDate : endDate}T12:00:00`),
      duration,
      leaveType: 'personal' as const,
      reason: reason.trim(),
      status: 'Pending' as const,
      workScheduleId: duration === 'short' ? selectedScheduleId || undefined : undefined,
    }
    try {
      const id = editingId || (isPreviewMode ? `local-${Date.now()}` : await createLeaveRequest(request))
      if (editingId && !isPreviewMode) await reviseLeaveRequest(editingId, request)
      setRequests((prev) => editingId
        ? prev.map((item) => item.id === editingId ? { ...item, ...request, status: 'Pending' } : item)
        : [{ ...request, id }, ...prev])
      setMessage(editingId ? 'Đã gửi bản điều chỉnh cho quản lý.' : 'Đã gửi yêu cầu nghỉ. Quản lý sẽ xem xét và phản hồi.')
      setEditingId(null)
      setStartDate('')
      setEndDate('')
      setReason('')
      setSelectedScheduleId('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể gửi yêu cầu. Vui lòng thử lại.')
    } finally {
      setSubmitting(false)
    }
  }

  const editRequest = (request: any) => {
    const start = request.leaveDate?.toDate?.() || request.leaveDate
    const end = request.endDate?.toDate?.() || request.endDate
    setEditingId(request.id)
    setDuration(request.duration || 'short')
    setStartDate(new Date(start).toISOString().slice(0, 10))
    setEndDate(end ? new Date(end).toISOString().slice(0, 10) : '')
    setReason(request.reason || '')
    setSelectedScheduleId(request.workScheduleId || '')
    setMessage('Bạn đang điều chỉnh yêu cầu đã gửi.')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cancelRequest = async (id: string) => {
    if (!window.confirm('Bạn muốn rút yêu cầu nghỉ này?')) return
    try {
      if (!isPreviewMode) await cancelLeaveRequest(id)
      setRequests((prev) => prev.map((item) => item.id === id ? { ...item, status: 'Cancelled' } : item))
      if (editingId === id) setEditingId(null)
      setMessage('Đã rút yêu cầu nghỉ. Khoản phạt phát sinh trước đó (nếu có) vẫn được giữ.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể hủy yêu cầu.')
    }
  }

  const hasPendingRequest = requests.some((item) => item.status === 'Pending')

  return (
    <main className="min-h-screen pb-8">
      <Header title="Xin nghỉ" subtitle="Chọn hình thức nghỉ phù hợp" />
      <PageContainer>
        <section className="mb-4 rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-700 p-5 text-white">
          <Palmtree className="h-7 w-7 text-emerald-100" />
          <h2 className="mt-4 text-2xl font-black">Bạn cần nghỉ khi nào?</h2>
          <p className="mt-1 text-sm leading-6 text-emerald-50">
            Nghỉ ngắn hạn áp dụng cho một ngày. Nghỉ dài hạn cần chọn khoảng ngày cụ thể.
          </p>
        </section>

        {(!hasPendingRequest || editingId) && <form onSubmit={submit} className="mobile-card p-4 sm:p-6">
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
            {[
              { value: 'short' as const, label: 'Nghỉ ngắn hạn', note: 'Một ngày' },
              { value: 'long' as const, label: 'Nghỉ dài hạn', note: 'Nhiều ngày' },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => { setDuration(item.value); setStartDate(''); setSelectedScheduleId('') }}
                className={`min-h-14 rounded-xl px-2 text-sm transition ${duration === item.value ? 'bg-white font-extrabold text-indigo-600 shadow-sm dark:bg-slate-950' : 'text-muted-foreground'}`}
              >
                <span className="block">{item.label}</span>
                <span className="text-[11px] font-medium">{item.note}</span>
              </button>
            ))}
          </div>

          {duration === 'short' && approvedShifts.length > 0 ? (
            <div className="mt-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-extrabold">Chọn ca muốn nghỉ</p>
                  <p className="text-xs text-muted-foreground">Các ca đã được duyệt trong tuần này</p>
                </div>
                <Badge variant="success">{approvedShifts.length} ca</Badge>
              </div>
              <div className="space-y-2">
                {approvedShifts.map((shift) => {
                  const active = selectedScheduleId === shift.id
                  return (
                    <button key={shift.id} type="button" onClick={() => { setSelectedScheduleId(shift.id); setStartDate(shift.date.toISOString().slice(0, 10)) }} className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${active ? 'border-emerald-600 bg-emerald-600 text-white shadow-lg shadow-emerald-600/20' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800'}`}>
                      <div className={`grid h-10 w-10 place-items-center rounded-xl ${active ? 'bg-white/15' : 'bg-white text-emerald-600 dark:bg-slate-900'}`}><CalendarDays className="h-4 w-4" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="font-extrabold">{shiftLabels[shift.shift]}</p>
                        <p className={`text-xs ${active ? 'text-emerald-50' : 'text-muted-foreground'}`}>{shift.date.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })}</p>
                      </div>
                      {active && <Check className="h-5 w-5" />}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <>
              {duration === 'short' && (
                <div className="mt-5 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                  <Info className="mt-0.5 h-5 w-5 shrink-0" />
                  <div><p className="font-extrabold">Bạn không có lịch trong tuần này.</p><p>Bạn muốn đăng ký một ngày nghỉ?</p></div>
                </div>
              )}
              <div className={`mt-5 grid gap-3 ${duration === 'long' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <label className="text-sm font-bold">
                  {duration === 'short' ? 'Ngày muốn nghỉ' : 'Từ ngày'}
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mobile-field mt-2" required />
                </label>
            {duration === 'long' && (
              <label className="text-sm font-bold">
                Đến ngày
                <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className="mobile-field mt-2" required />
              </label>
            )}
              </div>
            </>
          )}

          <label className="mt-5 block text-sm font-bold">
            Lý do xin nghỉ
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} className="mobile-field mt-2 min-h-28 py-3" placeholder="Nhập lý do để quản lý xem xét..." required />
          </label>

          {startDate && (
            <div className="mt-4 flex gap-2 rounded-2xl bg-indigo-50 p-3 text-xs leading-5 text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200">
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" />
              {duration === 'short'
                ? `Bạn đang xin nghỉ ngày ${new Date(`${startDate}T12:00:00`).toLocaleDateString('vi-VN')}.`
                : `Khoảng nghỉ từ ${new Date(`${startDate}T12:00:00`).toLocaleDateString('vi-VN')}${endDate ? ` đến ${new Date(`${endDate}T12:00:00`).toLocaleDateString('vi-VN')}` : ''}.`}
            </div>
          )}

          {message && <p className="mt-4 rounded-2xl bg-slate-100 p-3 text-sm font-semibold dark:bg-slate-800">{message}</p>}
          <button type="submit" disabled={submitting} className="mobile-primary-button mt-5">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitting ? 'Đang gửi...' : editingId ? 'Gửi điều chỉnh' : 'Gửi yêu cầu nghỉ'}
          </button>
        </form>}

        <section className="mt-6">
          <h2 className="mb-3 text-lg font-extrabold">Yêu cầu gần đây</h2>
          <div className="space-y-3">
            {requests.map((request, index) => {
              const start = request.leaveDate?.toDate?.() || request.leaveDate || request.startDate
              const end = request.endDate?.toDate?.() || request.endDate
              return (
                <article key={request.id || index} className="mobile-card p-4">
                  <div className="flex items-center gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10"><CheckCircle2 className="h-5 w-5" /></div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-extrabold">{request.duration === 'long' ? 'Nghỉ dài hạn' : 'Nghỉ ngắn hạn'}</h3>
                      <p className="text-xs text-muted-foreground">{start ? new Date(start).toLocaleDateString('vi-VN') : 'Chưa rõ ngày'}{request.duration === 'long' && end ? ` – ${new Date(end).toLocaleDateString('vi-VN')}` : ''}</p>
                    </div>
                    <Badge variant={request.status === 'Approved' ? 'success' : request.status === 'Rejected' ? 'destructive' : request.status === 'Cancelled' ? 'outline' : 'warning'}>
                      {request.status === 'Approved' ? 'Đã duyệt' : request.status === 'Rejected' ? 'Từ chối' : request.status === 'Cancelled' ? 'Đã hủy' : 'Chờ duyệt'}
                    </Badge>
                  </div>
                  {request.status === 'Pending' && (
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => editRequest(request)} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-indigo-50 text-sm font-bold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-200"><Pencil className="h-4 w-4" /> Điều chỉnh</button>
                      <button type="button" onClick={() => cancelRequest(request.id)} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-rose-50 text-sm font-bold text-rose-700 dark:bg-rose-500/10 dark:text-rose-200"><Trash2 className="h-4 w-4" /> Hủy yêu cầu</button>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        </section>
      </PageContainer>
    </main>
  )
}
