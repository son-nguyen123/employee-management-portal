'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Check, CheckCircle2, ChevronRight, Loader2, Palmtree, Pencil, Send, Trash2, X } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import { cancelLeaveRequest, createLeaveRequest, normalizeLeaveRequests, respondToLeavePenalty, reviseLeaveRequest, subscribeToEmployeeLeaves } from '@/lib/services/leaveService'
import { mockLeaveRequests } from '@/lib/services/mockData'
import { subscribeToEmployeeSchedules } from '@/lib/services/scheduleService'
import { getPreviewSchedules } from '@/lib/services/previewWorkflow'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { StaffBanner } from '@/components/staff/staff-banner'
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
  const [selectedScheduleIds, setSelectedScheduleIds] = useState<string[]>([])
  const [requests, setRequests] = useState<any[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [schedulePickerOpen, setSchedulePickerOpen] = useState(false)
  const [draftScheduleIds, setDraftScheduleIds] = useState<string[]>([])

  useEffect(() => {
    if (!authUser) return
    const updateApprovedShifts = (scheduleData: any[]) => {
        setApprovedShifts(scheduleData
          .filter((item) => {
            const date = item.date instanceof Date ? item.date : typeof item.date === 'string' ? new Date(item.date) : item.date.toDate()
            return item.status === 'Approved' && !item.note?.includes('[DUTY_ONLY]') && date >= new Date(new Date().setHours(0, 0, 0, 0))
          })
          .map((item) => ({
            id: item.id!,
            date: item.date instanceof Date ? item.date : typeof item.date === 'string' ? new Date(item.date) : item.date.toDate(),
            shift: item.shift,
          })))
    }

    if (isPreviewMode) {
      setRequests(mockLeaveRequests)
      updateApprovedShifts(getPreviewSchedules().filter((item) => item.employeeId === authUser.uid))
      return
    }

    void normalizeLeaveRequests().catch(() => undefined)

    const handleError = () => setRequests([])
    const unsubscribeLeaves = subscribeToEmployeeLeaves(
      authUser.uid,
      setRequests,
      handleError
    )
    const unsubscribeSchedules = subscribeToEmployeeSchedules(
      authUser.uid,
      updateApprovedShifts,
      handleError
    )
    return () => {
      unsubscribeLeaves()
      unsubscribeSchedules()
    }
  }, [authUser, isPreviewMode])

  const groupedApprovedShifts = useMemo(() => {
    const groups = new Map<string, ApprovedShift[]>()
    approvedShifts.forEach((shift) => {
      const key = `${shift.date.getFullYear()}-${String(shift.date.getMonth() + 1).padStart(2, '0')}-${String(shift.date.getDate()).padStart(2, '0')}`
      groups.set(key, [...(groups.get(key) || []), shift])
    })
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
  }, [approvedShifts])

  const selectedShortShifts = approvedShifts.filter((shift) => selectedScheduleIds.includes(shift.id))
  const selectedShortDayCount = new Set(
    selectedShortShifts.map((item) => item.date.toLocaleDateString('vi-VN'))
  ).size

  const requestedScheduleIds = useMemo(() => {
    const ids = new Set<string>()
    requests
      .filter((request) => request.id !== editingId && ['Pending', 'AwaitingEmployeeConsent', 'Approved'].includes(request.status))
      .forEach((request) => {
        const storedIds = request.workScheduleIds || (request.workScheduleId ? [request.workScheduleId] : [])
        storedIds.forEach((id: string) => ids.add(id))
        if (request.duration !== 'long') return
        const start = request.leaveDate?.toDate?.() || request.leaveDate
        const end = request.endDate?.toDate?.() || request.endDate || start
        if (!start || !end) return
        const startKey = new Date(start).toISOString().slice(0, 10)
        const endKey = new Date(end).toISOString().slice(0, 10)
        approvedShifts.forEach((shift) => {
          const key = shift.date.toISOString().slice(0, 10)
          if (key >= startKey && key <= endKey) ids.add(shift.id)
        })
      })
    return ids
  }, [approvedShifts, editingId, requests])

  const openSchedulePicker = () => {
    setDraftScheduleIds(selectedScheduleIds)
    setSchedulePickerOpen(true)
  }

  const toggleDraftShift = (shift: ApprovedShift) => {
    if (requestedScheduleIds.has(shift.id)) return
    setDraftScheduleIds((current) => {
      if (current.includes(shift.id)) return current.filter((id) => id !== shift.id)
      return [...current, shift.id]
    })
  }

  const confirmSchedulePicker = () => {
    const selected = approvedShifts.filter((item) => draftScheduleIds.includes(item.id))
    if (!selected.length) return
    const dates = selected.map((item) => item.date).sort((left, right) => left.getTime() - right.getTime())
    const firstDate = dates[0]
    const lastDate = dates[dates.length - 1]
    setStartDate(`${firstDate.getFullYear()}-${String(firstDate.getMonth() + 1).padStart(2, '0')}-${String(firstDate.getDate()).padStart(2, '0')}`)
    setEndDate(`${lastDate.getFullYear()}-${String(lastDate.getMonth() + 1).padStart(2, '0')}-${String(lastDate.getDate()).padStart(2, '0')}`)
    setSelectedScheduleIds(draftScheduleIds)
    setSchedulePickerOpen(false)
  }

  const longLeaveShifts = useMemo(() => {
    if (duration !== 'long' || !startDate || !endDate) return []
    return approvedShifts.filter((item) => {
      const key = item.date.toISOString().slice(0, 10)
      return key >= startDate && key <= endDate
    })
  }, [approvedShifts, duration, endDate, startDate])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!authUser || !startDate || !reason.trim() || (duration === 'short' && !selectedScheduleIds.length) || (duration === 'long' && !endDate)) {
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
      endDate: new Date(`${endDate || startDate}T12:00:00`),
      duration,
      leaveType: 'personal' as const,
      reason: reason.trim(),
      status: 'Pending' as const,
      workScheduleId: duration === 'short' ? selectedScheduleIds[0] : longLeaveShifts[0]?.id,
      workScheduleIds: duration === 'short' ? selectedScheduleIds : longLeaveShifts.map((item) => item.id),
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
      setSelectedScheduleIds([])
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
    setSelectedScheduleIds(request.workScheduleIds || (request.workScheduleId ? [request.workScheduleId] : []))
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

  const respondPenalty = async (id: string, accepted: boolean) => {
    const action = accepted ? 'đồng ý' : 'từ chối'
    if (!window.confirm(`Bạn chắc chắn muốn ${action} mức trừ này?`)) return
    try {
      if (!isPreviewMode) await respondToLeavePenalty(id, accepted)
      setRequests((current) => current.map((item) => item.id === id ? {
        ...item,
        status: accepted ? 'Approved' : 'ConsentDeclined',
        penaltyConsentStatus: accepted ? 'Accepted' : 'Declined',
      } : item))
      setMessage(accepted ? 'Đã đồng ý mức trừ; yêu cầu nghỉ được xác nhận.' : 'Đã từ chối mức trừ; yêu cầu nghỉ chưa được chấp thuận.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể gửi lựa chọn.')
    }
  }

  const hasPendingRequest = requests.some((item) => ['Pending', 'AwaitingEmployeeConsent'].includes(item.status))

  return (
    <main className="min-h-screen pb-8">
      <Header title="Xin nghỉ" subtitle="Chọn hình thức nghỉ phù hợp" />
      <PageContainer>
        <StaffBanner icon={Palmtree} tone="emerald" eyebrow="Xin nghỉ" title="Bạn cần nghỉ khi nào?" description="Nghỉ ngắn hạn chọn các ca cụ thể trong một hoặc nhiều ngày. Nghỉ dài hạn chọn một khoảng ngày liên tục." note="Ghi lý do chính tại đây; hình ảnh hoặc giấy tờ làm bằng chứng gửi riêng cho quản lý qua Messenger." />

        {(!hasPendingRequest || editingId) && <form onSubmit={submit} className="mobile-card min-w-0 overflow-hidden p-4 sm:p-6">
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
            {[
              { value: 'short' as const, label: 'Nghỉ ngắn hạn', note: 'Chọn ca' },
              { value: 'long' as const, label: 'Nghỉ dài hạn', note: 'Nhiều ngày' },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => { setDuration(item.value); setStartDate(''); setEndDate(''); setSelectedScheduleIds([]) }}
                className={`min-h-14 rounded-xl px-2 text-sm transition ${duration === item.value ? 'bg-white font-extrabold text-indigo-600 shadow-sm dark:bg-slate-950' : 'text-muted-foreground'}`}
              >
                <span className="block">{item.label}</span>
                <span className="text-[11px] font-medium">{item.note}</span>
              </button>
            ))}
          </div>

          {duration === 'short' && (
            <div className="mt-5">
              <p className="text-sm font-bold">Ca muốn xin nghỉ</p>
              <button type="button" onClick={openSchedulePicker} className="mt-2 flex min-h-16 w-full items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left dark:border-slate-700 dark:bg-slate-800">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white text-emerald-600 shadow-sm dark:bg-slate-900"><CalendarDays className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold">{selectedShortShifts.length ? `${selectedShortShifts.length} ca đã chọn` : 'Chọn từ lịch đã đăng ký'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedShortShifts.length
                      ? `${selectedShortDayCount} ngày · ${selectedShortShifts.map((item) => shiftLabels[item.shift]).join(', ')}`
                      : 'Hiển thị các ca đã được quản lý duyệt'}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
              </button>
            </div>
          )}

          {duration === 'long' ? (
            <>
              <div className="mt-5 grid min-w-0 grid-cols-1 gap-3 overflow-hidden sm:grid-cols-2">
                <label className="block min-w-0 max-w-full overflow-hidden text-sm font-bold">
                  Từ ngày
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mobile-field mt-2 block min-w-0 max-w-full overflow-hidden !px-3" required />
                </label>
              <label className="block min-w-0 max-w-full overflow-hidden text-sm font-bold">
                Đến ngày
                <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className="mobile-field mt-2 block min-w-0 max-w-full overflow-hidden !px-3" required />
              </label>
              </div>
              {!!longLeaveShifts.length && (
                <div className="mt-3 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
                  <strong>{longLeaveShifts.length} ca bị ảnh hưởng</strong>
                  <p className="mt-1 text-xs">Các ca đã duyệt trong khoảng nghỉ sẽ được gửi kèm để quản lý xem xét.</p>
                </div>
              )}
            </>
          ) : null}

          <label className="mt-5 block text-sm font-bold">
            Lý do xin nghỉ
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} className="mobile-field mt-2 min-h-28 py-3" placeholder="Nhập lý do để quản lý xem xét..." required />
          </label>

          {startDate && (
            <div className="mt-4 flex gap-2 rounded-2xl bg-indigo-50 p-3 text-xs leading-5 text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200">
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" />
              {duration === 'short'
                ? `Bạn đang chọn ${selectedShortShifts.length} ca trong ${selectedShortDayCount} ngày${endDate && endDate !== startDate ? `, từ ${new Date(`${startDate}T12:00:00`).toLocaleDateString('vi-VN')} đến ${new Date(`${endDate}T12:00:00`).toLocaleDateString('vi-VN')}` : ` ${new Date(`${startDate}T12:00:00`).toLocaleDateString('vi-VN')}`}.`
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
            {requests.slice(0, 5).map((request, index) => {
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
                      {request.status === 'Approved' ? 'Đã duyệt' : request.status === 'Rejected' || request.status === 'ConsentDeclined' ? 'Từ chối' : request.status === 'Cancelled' ? 'Đã hủy' : request.status === 'AwaitingEmployeeConsent' ? 'Chờ bạn xác nhận' : 'Chờ duyệt'}
                    </Badge>
                  </div>
                  {request.status === 'Pending' && (
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => editRequest(request)} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-indigo-50 text-sm font-bold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-200"><Pencil className="h-4 w-4" /> Điều chỉnh</button>
                      <button type="button" onClick={() => cancelRequest(request.id)} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-rose-50 text-sm font-bold text-rose-700 dark:bg-rose-500/10 dark:text-rose-200"><Trash2 className="h-4 w-4" /> Hủy yêu cầu</button>
                    </div>
                  )}
                  {request.status === 'AwaitingEmployeeConsent' && (
                    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                      <p className="text-sm font-bold text-amber-900 dark:text-amber-100">Quản lý đồng ý cho nghỉ với mức trừ {Number(request.proposedPenaltyAmount || 0).toLocaleString('vi-VN')}đ. Bạn có chấp nhận không?</p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => void respondPenalty(request.id, false)} className="min-h-11 rounded-xl border border-rose-200 bg-white text-sm font-bold text-rose-600 dark:bg-slate-900">Không đồng ý</button>
                        <button type="button" onClick={() => void respondPenalty(request.id, true)} className="min-h-11 rounded-xl bg-emerald-600 text-sm font-bold text-white">Đồng ý</button>
                      </div>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        </section>
      </PageContainer>
      {schedulePickerOpen && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setSchedulePickerOpen(false)}>
          <section role="dialog" aria-modal="true" aria-labelledby="leave-shift-picker-title" className="flex max-h-[min(82vh,42rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-[2rem] bg-white shadow-2xl dark:bg-slate-900 sm:rounded-[2rem]" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-center gap-3 border-b border-slate-100 p-4 dark:border-white/10">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10"><CalendarDays className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-wider text-emerald-600">Lịch đã được duyệt</p><h2 id="leave-shift-picker-title" className="text-xl font-black">Chọn ca muốn nghỉ</h2></div>
              <button type="button" onClick={() => setSchedulePickerOpen(false)} aria-label="Đóng bảng chọn ca" className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 dark:bg-slate-800"><X className="h-5 w-5" /></button>
            </header>
            <div className="overflow-y-auto p-4">
              <p className="mb-3 text-xs leading-5 text-muted-foreground">Bạn có thể chọn một hoặc nhiều ca ở nhiều ngày khác nhau trong cùng yêu cầu.</p>
              <div className="space-y-3">
                {groupedApprovedShifts.map(([dateKey, shifts]) => (
                  <section key={dateKey} className="rounded-2xl border border-slate-200 p-3 dark:border-slate-700">
                    <p className="font-extrabold capitalize">{shifts[0].date.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</p>
                    <div className="mt-2 grid gap-2">
                      {shifts.map((shift) => {
                        const active = draftScheduleIds.includes(shift.id)
                        const alreadyRequested = requestedScheduleIds.has(shift.id)
                        return (
                          <button key={shift.id} type="button" disabled={alreadyRequested} onClick={() => toggleDraftShift(shift)} className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 text-left ${alreadyRequested ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200' : active ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-transparent bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>
                            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg ${alreadyRequested ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-200' : active ? 'bg-white/20' : 'bg-white dark:bg-slate-900'}`}>{(active || alreadyRequested) && <Check className="h-4 w-4" />}</span>
                            <span className="min-w-0 flex-1 font-bold">{shiftLabels[shift.shift]}</span>
                            {alreadyRequested && <span className="shrink-0 rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-black text-rose-700 dark:bg-rose-500/20 dark:text-rose-100">Đã xin nghỉ</span>}
                          </button>
                        )
                      })}
                    </div>
                  </section>
                ))}
                {!groupedApprovedShifts.length && <div className="rounded-2xl bg-amber-50 p-5 text-center text-sm font-semibold text-amber-800">Hiện chưa có ca nào đã được quản lý duyệt để xin nghỉ.</div>}
              </div>
            </div>
            <footer className="border-t border-slate-100 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-white/10 dark:bg-slate-900">
              <button type="button" onClick={confirmSchedulePicker} disabled={!draftScheduleIds.length} className="mobile-primary-button bg-emerald-600 disabled:opacity-50">Xác nhận {draftScheduleIds.length ? `${draftScheduleIds.length} ca` : ''}</button>
            </footer>
          </section>
        </div>
      )}
    </main>
  )
}
