'use client'

import { useEffect, useState } from 'react'
import { CalendarDays, CheckCircle2, Clock3, Loader2, Pencil, Send, Trash2, X } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import { cancelLateRequest, createLateRequest, getEmployeeLateRequests, reviseLateRequest } from '@/lib/services/lateService'
import { getEmployeeSchedules } from '@/lib/services/scheduleService'
import { getPreviewSchedules } from '@/lib/services/previewWorkflow'
import { mockLateRequests } from '@/lib/services/mockData'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { Badge } from '@/components/ui/badge'

type ShiftName = 'Morning' | 'Afternoon' | 'Evening'
type ShiftItem = { id: string; date: Date; shift: ShiftName; status: string; note?: string }

const shiftMeta: Record<ShiftName, { label: string; time: string; startMinutes: number; color: string }> = {
  Morning: { label: 'Ca sáng', time: '07:30 – 11:30', startMinutes: 7 * 60 + 30, color: 'bg-amber-500' },
  Afternoon: { label: 'Ca chiều', time: '13:00 – 17:00', startMinutes: 13 * 60, color: 'bg-sky-600' },
  Evening: { label: 'Ca tối', time: '18:00 – 22:00', startMinutes: 18 * 60, color: 'bg-indigo-700' },
}

export default function LateArrivalPage() {
  const { authUser, isPreviewMode } = useAuth()
  const [shifts, setShifts] = useState<ShiftItem[]>([])
  const [selectedShift, setSelectedShift] = useState<ShiftItem | null>(null)
  const [arrivalTime, setArrivalTime] = useState('')
  const [reason, setReason] = useState('')
  const [requests, setRequests] = useState<any[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    if (!authUser) return
    const load = async () => {
      try {
        if (isPreviewMode) {
          setShifts(getPreviewSchedules()
            .filter((item) => item.employeeId === 'demo-user-001' && item.status === 'Approved')
            .map((item) => ({ id: item.id, date: new Date(item.date), shift: item.shift, status: item.status, note: item.note })))
          setRequests(mockLateRequests)
          return
        }
        const [scheduleData, requestData] = await Promise.all([
          getEmployeeSchedules(authUser.uid),
          getEmployeeLateRequests(authUser.uid),
        ])
        setShifts(scheduleData
          .filter((item) => item.status === 'Approved')
          .map((item) => ({
            id: item.id!,
            date: item.date instanceof Date ? item.date : item.date.toDate(),
            shift: item.shift,
            status: item.status,
            note: item.note,
          })))
        setRequests(requestData)
      } catch {
        setMessage('Chưa tải được lịch đã xác nhận.')
      }
    }
    load()
  }, [authUser, isPreviewMode])

  const openRequest = (shift: ShiftItem) => {
    setEditingId(null)
    const defaultMinutes = shiftMeta[shift.shift].startMinutes + 60
    setSelectedShift(shift)
    setArrivalTime(`${String(Math.floor(defaultMinutes / 60) % 24).padStart(2, '0')}:${String(defaultMinutes % 60).padStart(2, '0')}`)
    setReason('')
    setMessage('')
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!authUser || !selectedShift || !arrivalTime || !reason.trim()) return
    const [hour, minute] = arrivalTime.split(':').map(Number)
    const startMinutes = shiftMeta[selectedShift.shift].startMinutes
    let arrivalMinutes = hour * 60 + minute
    const lateMinutes = Math.max(1, arrivalMinutes - startMinutes)
    setSubmitting(true)
    try {
      let requestId = editingId || `local-${Date.now()}`
      if (!isPreviewMode) {
        if (editingId) {
          await reviseLateRequest(editingId, {
            workScheduleId: selectedShift.id,
            expectedArrival: arrivalTime,
            reason: reason.trim(),
          })
        } else requestId = await createLateRequest({
          employeeId: authUser.uid,
          workScheduleId: selectedShift.id,
          date: selectedShift.date,
          shift: selectedShift.shift,
          lateMinutes,
          expectedArrival: arrivalTime,
          reason: reason.trim(),
          status: 'Pending',
        })
      }
      const nextRequest = {
        id: requestId,
        workScheduleId: selectedShift.id,
        shift: selectedShift.shift,
        lateMinutes,
        expectedArrival: arrivalTime,
        reason: reason.trim(),
        status: 'Pending',
        date: selectedShift.date,
      }
      setRequests((prev) => editingId
        ? prev.map((item) => item.id === editingId ? { ...item, ...nextRequest, id: editingId } : item)
        : [nextRequest, ...prev])
      setSelectedShift(null)
      setEditingId(null)
      setMessage(editingId ? 'Đã gửi bản điều chỉnh cho quản lý.' : 'Đã gửi thông báo đi trễ cho quản lý.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể gửi yêu cầu. Vui lòng thử lại.')
    } finally {
      setSubmitting(false)
    }
  }

  const editRequest = (request: any) => {
    const shift = shifts.find((item) => item.id === request.workScheduleId)
    if (!shift) return setMessage('Không còn tìm thấy ca làm của yêu cầu này.')
    setEditingId(request.id)
    setSelectedShift(shift)
    setArrivalTime(request.expectedArrival || '')
    setReason(request.reason || '')
  }

  const cancelRequest = async (id: string) => {
    if (!window.confirm('Bạn muốn rút thông báo đi trễ này?')) return
    try {
      if (!isPreviewMode) await cancelLateRequest(id)
      setRequests((prev) => prev.map((item) => item.id === id ? { ...item, status: 'Cancelled' } : item))
      setMessage('Đã rút yêu cầu. Khoản phạt báo trễ đã phát sinh (nếu có) vẫn được giữ.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể hủy yêu cầu.')
    }
  }

  const hasPendingRequest = requests.some((item) => item.status === 'Pending')

  return (
    <main className="min-h-screen pb-8">
      <Header title="Xin đi trễ" subtitle="Chọn ca đã được quản lý xác nhận" />
      <PageContainer>
        <section className="mb-5 rounded-3xl bg-slate-950 p-5 text-white">
          <Clock3 className="h-7 w-7 text-indigo-300" />
          <h2 className="mt-4 text-2xl font-black">Lịch làm đã xác nhận</h2>
          <p className="mt-1 text-sm leading-6 text-slate-300">
            Chọn đúng ca bạn sẽ đi trễ, sau đó nhập giờ dự kiến có mặt.
          </p>
        </section>

        {message && <p className="mb-4 rounded-2xl bg-indigo-50 p-3 text-sm font-semibold text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200">{message}</p>}

        {!hasPendingRequest && <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-extrabold">Các ca làm của bạn</h2>
            <Badge variant="outline">{shifts.length} ca</Badge>
          </div>
          <div className="space-y-3">
            {shifts.map((shift) => {
              const meta = shiftMeta[shift.shift]
              return (
                <article key={shift.id} className="mobile-card p-4">
                  <div className="flex items-center gap-3">
                    <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white ${meta.color}`}>
                      <Clock3 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-extrabold">{meta.label}</h3>
                      <p className="text-xs text-muted-foreground">
                        {shift.date.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })} · {meta.time}
                      </p>
                    </div>
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                  </div>
                  <button type="button" onClick={() => openRequest(shift)} className="mt-3 min-h-11 w-full rounded-2xl bg-amber-50 text-sm font-extrabold text-amber-700 active:scale-[0.99] dark:bg-amber-500/10">
                    Báo đi trễ ca này
                  </button>
                </article>
              )
            })}
            {!shifts.length && (
              <div className="mobile-card p-8 text-center">
                <CalendarDays className="mx-auto h-9 w-9 text-slate-400" />
                <h3 className="mt-4 font-extrabold">Chưa có ca được xác nhận</h3>
                <p className="mt-1 text-sm text-muted-foreground">Bạn chỉ có thể báo đi trễ trên lịch đã được quản lý duyệt.</p>
              </div>
            )}
          </div>
        </section>}

        {!!requests.length && (
          <section className="mt-7">
            <h2 className="mb-3 text-lg font-extrabold">Lịch sử báo đi trễ</h2>
            <div className="space-y-3">
              {requests.slice(0, 4).map((request, index) => (
                <article key={request.id || index} className="mobile-card p-4">
                  <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-500/10"><Clock3 className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-bold">{shiftMeta[request.shift as ShiftName]?.label || 'Ca làm'} · trễ {request.lateMinutes} phút</h3>
                      <p className="truncate text-xs text-muted-foreground">{request.reason}</p>
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
              ))}
            </div>
          </section>
        )}
      </PageContainer>

      {selectedShift && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/45 backdrop-blur-sm" onClick={() => setSelectedShift(null)}>
          <form onSubmit={submit} onClick={(event) => event.stopPropagation()} className="w-full rounded-t-[2rem] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl dark:bg-slate-900">
            <div className="mx-auto max-w-lg">
              <div className="mb-5 flex items-start justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-amber-600">Báo đi trễ</p>
                  <h2 className="text-xl font-black">{shiftMeta[selectedShift.shift].label} · {selectedShift.date.toLocaleDateString('vi-VN')}</h2>
                </div>
                <button type="button" onClick={() => { setSelectedShift(null); setEditingId(null) }} className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 dark:bg-slate-800" aria-label="Đóng"><X className="h-5 w-5" /></button>
              </div>
              <label className="block text-sm font-bold">Giờ dự kiến có mặt
                <input type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} className="mobile-field mt-2" required />
              </label>
              <label className="mt-4 block text-sm font-bold">Lý do
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} className="mobile-field mt-2 min-h-24 py-3" placeholder="Ví dụ: xe hỏng trên đường..." required />
              </label>
              <button type="submit" disabled={submitting} className="mobile-primary-button mt-5">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {submitting ? 'Đang gửi...' : editingId ? 'Gửi điều chỉnh' : 'Gửi thông báo đi trễ'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
