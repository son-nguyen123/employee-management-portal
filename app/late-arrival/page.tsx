'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckCircle2, Clock3, Loader2, Pencil, Send, Trash2, X } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import { cancelLateRequest, createLateRequest, reviseLateRequest, subscribeToEmployeeLateRequests } from '@/lib/services/lateService'
import { subscribeToEmployeeSchedules } from '@/lib/services/scheduleService'
import { getPreviewSchedules } from '@/lib/services/previewWorkflow'
import { mockLateRequests } from '@/lib/services/mockData'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { StaffBanner } from '@/components/staff/staff-banner'
import { Badge } from '@/components/ui/badge'

type ShiftName = 'Morning' | 'Afternoon' | 'Evening'
type ShiftItem = { id: string; date: Date; shift: ShiftName; status: string; note?: string }

function scheduleDate(value: any): Date {
  return value instanceof Date ? value : typeof value === 'string' ? new Date(value) : value.toDate()
}

function vietnamDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

const shiftMeta: Record<ShiftName, { label: string; time: string; startMinutes: number; color: string }> = {
  Morning: { label: 'Ca sáng', time: '07:30 – 11:30', startMinutes: 7 * 60 + 30, color: 'bg-amber-500' },
  Afternoon: { label: 'Ca chiều', time: '13:00 – 17:00', startMinutes: 13 * 60, color: 'bg-sky-600' },
  Evening: { label: 'Ca tối', time: '18:00 – 22:00', startMinutes: 18 * 60, color: 'bg-indigo-700' },
}

export default function LateArrivalPage() {
  const { authUser, isPreviewMode } = useAuth()
  const [shifts, setShifts] = useState<ShiftItem[]>([])
  const [selectedShift, setSelectedShift] = useState<ShiftItem | null>(null)
  const [selectedShiftIds, setSelectedShiftIds] = useState<string[]>([])
  const [arrivalTime, setArrivalTime] = useState('')
  const [reason, setReason] = useState('')
  const [managerMessageStatus, setManagerMessageStatus] = useState<'messagedTri' | 'notMessaged' | 'messagedOtherManager'>('messagedTri')
  const [requests, setRequests] = useState<any[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [submitConfirmationOpen, setSubmitConfirmationOpen] = useState(false)

  useEffect(() => {
    if (!authUser) return
    const updateShifts = (scheduleData: any[]) => {
      const today = vietnamDateKey(new Date())
      setShifts(scheduleData
        .filter((item) => {
          const date = scheduleDate(item.date)
          return item.status === 'Approved'
            && !item.note?.includes('[DUTY_ONLY]')
            && vietnamDateKey(date) >= today
        })
        .map((item) => ({
          id: item.id!,
          date: scheduleDate(item.date),
          shift: item.shift,
          status: item.status,
          note: item.note,
        })))
    }

    if (isPreviewMode) {
      updateShifts(getPreviewSchedules().filter((item) => item.employeeId === 'demo-user-001'))
      setRequests(mockLateRequests)
      return
    }

    const handleError = () => setMessage('Chưa tải được lịch đã xác nhận.')
    const unsubscribeSchedules = subscribeToEmployeeSchedules(authUser.uid, updateShifts, handleError)
    const unsubscribeRequests = subscribeToEmployeeLateRequests(authUser.uid, setRequests, handleError)
    return () => {
      unsubscribeSchedules()
      unsubscribeRequests()
    }
  }, [authUser, isPreviewMode])

  const openRequest = (shift: ShiftItem) => {
    setEditingId(null)
    const defaultMinutes = shiftMeta[shift.shift].startMinutes + 60
    setSelectedShift(shift)
    setSelectedShiftIds([shift.id])
    setArrivalTime(`${String(Math.floor(defaultMinutes / 60) % 24).padStart(2, '0')}:${String(defaultMinutes % 60).padStart(2, '0')}`)
    setReason('')
    setMessage('')
  }

  const selectedShifts = useMemo(
    () => shifts.filter((shift) => selectedShiftIds.includes(shift.id)),
    [shifts, selectedShiftIds]
  )

  const toggleShift = (shift: ShiftItem) => {
    setEditingId(null)
    setSelectedShiftIds((current) => current.includes(shift.id)
      ? current.filter((id) => id !== shift.id)
      : [...current, shift.id])
    setMessage('')
  }

  const openSelectedRequest = () => {
    if (!selectedShifts.length) return
    const first = selectedShifts[0]
    setSelectedShift(first)
    const defaultMinutes = shiftMeta[first.shift].startMinutes + 60
    setArrivalTime(`${String(Math.floor(defaultMinutes / 60) % 24).padStart(2, '0')}:${String(defaultMinutes % 60).padStart(2, '0')}`)
    setReason('')
    setMessage('')
  }

  const requestSubmitConfirmation = (event: React.FormEvent) => {
    event.preventDefault()
    if (!authUser || !selectedShifts.length || !arrivalTime || !reason.trim()) return
    setSubmitConfirmationOpen(true)
  }

  const submit = async () => {
    if (!authUser || !selectedShifts.length || !arrivalTime || !reason.trim()) return
    setSubmitConfirmationOpen(false)
    const [hour, minute] = arrivalTime.split(':').map(Number)
    const startMinutes = shiftMeta[selectedShifts[0].shift].startMinutes
    const arrivalMinutes = hour * 60 + minute
    const lateMinutes = Math.max(1, arrivalMinutes - startMinutes)
    setSubmitting(true)
    try {
      let requestId = editingId || `local-${Date.now()}`
      if (!isPreviewMode) {
        if (editingId) {
          await reviseLateRequest(editingId, {
            workScheduleId: selectedShifts[0].id,
            workScheduleIds: selectedShifts.map((shift) => shift.id),
            expectedArrival: arrivalTime,
            reason: reason.trim(),
          })
        } else requestId = await createLateRequest({
          employeeId: authUser.uid,
          workScheduleId: selectedShifts[0].id,
          workScheduleIds: selectedShifts.map((shift) => shift.id),
          date: selectedShifts[0].date,
          shift: selectedShifts[0].shift,
          lateMinutes,
          expectedArrival: arrivalTime,
          reason: reason.trim(),
          managerMessageStatus,
          status: 'Pending',
        })
      }
      const nextRequest = {
        id: requestId,
        workScheduleId: selectedShifts[0].id,
        workScheduleIds: selectedShifts.map((shift) => shift.id),
        shift: selectedShifts[0].shift,
        lateEntries: selectedShifts.map((shift) => ({ workScheduleId: shift.id, date: shift.date, shift: shift.shift, lateMinutes })),
        lateMinutes,
        expectedArrival: arrivalTime,
        reason: reason.trim(),
        managerMessageStatus,
        status: 'Pending',
        date: selectedShifts[0].date,
      }
      setRequests((prev) => editingId
        ? prev.map((item) => item.id === editingId ? { ...item, ...nextRequest, id: editingId } : item)
        : [nextRequest, ...prev])
      setSelectedShift(null)
      setSelectedShiftIds([])
      setEditingId(null)
      setMessage(editingId ? 'Đã gửi bản điều chỉnh cho quản lý.' : 'Đã gửi thông báo đi trễ cho quản lý.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể gửi yêu cầu. Vui lòng thử lại.')
    } finally {
      setSubmitting(false)
    }
  }

  const editRequest = (request: any) => {
    const ids = request.workScheduleIds || (request.workScheduleId ? [request.workScheduleId] : [])
    const matching = shifts.filter((item) => ids.includes(item.id))
    const shift = matching[0]
    if (!shift) return setMessage('Không còn tìm thấy ca làm của yêu cầu này.')
    setEditingId(request.id)
    setSelectedShift(shift)
    setSelectedShiftIds(matching.length ? matching.map((item) => item.id) : [shift.id])
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
        <StaffBanner icon={Clock3} tone="amber" eyebrow="Xin đi trễ" title="Lịch làm đã xác nhận" description="Chọn một hoặc nhiều ca, sau đó nhập giờ dự kiến có mặt cho các ca đã chọn." note="Một ca: gửi trước giờ vào ca ít nhất 1 giờ. Nhiều ca: gửi trước 00:00 ngày bắt đầu sớm nhất; gửi trễ hạn sẽ được cảnh báo khoản trừ." />

        {message && <p className="mb-4 rounded-2xl bg-indigo-50 p-3 text-sm font-semibold text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200">{message}</p>}

        {!hasPendingRequest && <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-extrabold">Các ca làm của bạn</h2>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{shifts.length} ca</Badge>
              {selectedShifts.length > 0 && <button type="button" onClick={openSelectedRequest} className="rounded-xl bg-amber-500 px-3 py-2 text-xs font-extrabold text-white shadow-sm">Báo {selectedShifts.length} ca</button>}
            </div>
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
                  <button type="button" onClick={() => toggleShift(shift)} className={`mt-3 min-h-11 w-full rounded-2xl text-sm font-extrabold active:scale-[0.99] ${selectedShiftIds.includes(shift.id) ? 'bg-indigo-600 text-white' : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10'}`}>
                    {selectedShiftIds.includes(shift.id) ? 'Đã chọn ca này' : 'Chọn ca này'}
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
                      <h3 className="font-bold">{request.workScheduleIds?.length > 1 ? `${request.workScheduleIds.length} ca đã chọn` : (shiftMeta[request.shift as ShiftName]?.label || 'Ca làm')} · trễ {request.lateMinutes} phút</h3>
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
        <div className="fixed inset-0 z-[70] flex items-end bg-slate-950/45 backdrop-blur-sm" onClick={() => { setSelectedShift(null); setSelectedShiftIds([]); setEditingId(null); setSubmitConfirmationOpen(false) }}>
          <form onSubmit={requestSubmitConfirmation} onClick={(event) => event.stopPropagation()} className="max-h-[calc(100dvh-0.75rem)] w-full overflow-y-auto overscroll-contain rounded-t-[2rem] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl dark:bg-slate-900">
            <div className="mx-auto max-w-lg">
              <div className="mb-5 flex items-start justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-amber-600">Báo đi trễ</p>
                  <h2 className="text-xl font-black">{selectedShifts.length > 1 ? `${selectedShifts.length} ca đã chọn` : `${shiftMeta[selectedShift.shift].label} · ${selectedShift.date.toLocaleDateString('vi-VN')}`}</h2>
                  {selectedShifts.length > 1 && <p className="mt-1 text-xs text-muted-foreground">{selectedShifts.map((shift) => `${shiftMeta[shift.shift].label} ${shift.date.toLocaleDateString('vi-VN')}`).join(' · ')}</p>}
                </div>
                <button type="button" onClick={() => { setSelectedShift(null); setSelectedShiftIds([]); setEditingId(null); setSubmitConfirmationOpen(false) }} className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 dark:bg-slate-800" aria-label="Đóng"><X className="h-5 w-5" /></button>
              </div>
              <label className="block text-sm font-bold">Giờ dự kiến có mặt
                <input type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} className="mobile-field mt-2" required />
              </label>
              <label className="mt-4 block text-sm font-bold">Lý do
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} className="mobile-field mt-2 min-h-24 py-3" placeholder="Ví dụ: xe hỏng trên đường..." required />
              </label>
              <fieldset className="mt-4">
                <legend className="text-sm font-bold">Bạn đã nhắn riêng cho ai?</legend>
                <div className="mt-2 grid gap-2">
                  {([
                    ['messagedTri', 'Đã nhắn anh Trí'],
                    ['notMessaged', 'Chưa nhắn riêng (có thể trừ 500đ)'],
                    ['messagedOtherManager', 'Đã nhắn chị Thảo/người khác (có thể trừ 1.000đ)'],
                  ] as const).map(([value, label]) => (
                    <label key={value} className={`flex min-h-12 items-center gap-3 rounded-2xl border px-3 text-sm font-semibold ${managerMessageStatus === value ? 'border-indigo-500 bg-indigo-50 text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-100' : 'border-slate-200 dark:border-slate-700'}`}>
                      <input type="radio" name="manager-message" value={value} checked={managerMessageStatus === value} onChange={() => setManagerMessageStatus(value)} className="accent-indigo-600" />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <button type="submit" disabled={submitting} className="mobile-primary-button mt-5">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {submitting ? 'Đang gửi...' : editingId ? 'Gửi điều chỉnh' : 'Gửi thông báo đi trễ'}
              </button>
            </div>
          </form>
          {submitConfirmationOpen && (
            <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:items-center" onClick={() => setSubmitConfirmationOpen(false)}>
              <section role="dialog" aria-modal="true" aria-labelledby="late-confirmation-title" className="w-full max-w-md rounded-[2rem] bg-white p-5 shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
                <div className="flex items-start gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-200"><Clock3 className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1"><p className="text-xs font-black uppercase tracking-wider text-amber-600">Báo đi trễ</p><h2 id="late-confirmation-title" className="mt-1 text-xl font-black">Xác nhận gửi thông báo?</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">Quản lý sẽ nhận được thông báo này ngay sau khi bạn xác nhận.</p></div>
                </div>
                <div className="mt-4 space-y-3 rounded-2xl bg-slate-50 p-4 text-sm dark:bg-slate-800">
                  <p><span className="font-bold text-muted-foreground">Ca báo trễ:</span> <span className="font-extrabold">{selectedShifts.map((shift) => `${shiftMeta[shift.shift].label} ${shift.date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}`).join(' · ')}</span></p>
                  <p><span className="font-bold text-muted-foreground">Có mặt dự kiến:</span> <span className="font-extrabold">{arrivalTime}</span></p>
                  <p><span className="font-bold text-muted-foreground">Lý do:</span> <span className="font-semibold">{reason.trim()}</span></p>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setSubmitConfirmationOpen(false)} disabled={submitting} className="min-h-12 rounded-2xl border border-slate-200 font-bold dark:border-slate-700">Quay lại</button>
                  <button type="button" onClick={() => void submit()} disabled={submitting} className="mobile-primary-button disabled:opacity-60">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{submitting ? 'Đang gửi...' : 'Xác nhận gửi'}</button>
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </main>
  )
}
