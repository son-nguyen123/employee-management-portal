'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, Check, ChevronRight, CircleDollarSign, Clock3, FileText, Loader2, MessageSquareText, RotateCcw, UserRound, X } from 'lucide-react'
import { useAuth, useUserRole } from '@/lib/hooks/useAuth'
import type { Employee } from '@/lib/models/types'
import { updateLateStatus } from '@/lib/services/lateService'
import { updateLeaveStatus } from '@/lib/services/leaveService'
import { subscribeToManagementPendingItems, type ManagementPendingItem, type ManagementShift } from '@/lib/services/notificationService'
import { updateSalaryAdvanceStatus } from '@/lib/services/salaryService'
import { updateStaffRequestStatus } from '@/lib/services/staffRequestService'
import { subscribeToWeeklyDecisionHistory, type DecisionHistoryItem } from '@/lib/services/decisionHistoryService'
import { RequestIdentityAvatar } from '@/components/admin/request-identity-avatar'

type RequestRow =
  | { kind: 'pending'; pending: ManagementPendingItem; sortAt: Date; status: 'Pending' }
  | { kind: 'decision'; decision: DecisionHistoryItem; sortAt: Date; status: 'Approved' | 'Rejected' }

type PenaltyDialogState = {
  item: ManagementPendingItem
  status: 'Approved' | 'Rejected'
  suggested: number
  allowCustom: boolean
  amount: string
}

const meta = {
  account: { icon: UserRound, color: 'bg-fuchsia-600', gradient: 'from-fuchsia-500 to-rose-500' },
  leave: { icon: FileText, color: 'bg-emerald-600', gradient: 'from-emerald-500 to-teal-700' },
  late: { icon: Clock3, color: 'bg-amber-500', gradient: 'from-amber-400 to-orange-600' },
  salary: { icon: CircleDollarSign, color: 'bg-sky-600', gradient: 'from-sky-500 to-indigo-600' },
  staff: { icon: MessageSquareText, color: 'bg-violet-600', gradient: 'from-violet-500 to-fuchsia-600' },
} as const

const shiftLabel = { Morning: 'sáng', Afternoon: 'chiều', Evening: 'tối' }

function currentWeekWindow() {
  const start = new Date()
  const weekday = start.getDay() || 7
  start.setDate(start.getDate() - weekday + 1)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(start.getDate() + 7)
  return { start, end }
}

function ShiftRows({ title, rows }: { title: string; rows?: ManagementShift[] }) {
  if (!rows?.length) return null
  return <section><p className="mb-1 text-xs font-black uppercase tracking-wider text-muted-foreground">{title}</p><div className="divide-y divide-slate-100 dark:divide-white/10">{rows.map((row, index) => <div key={`${row.date.toISOString()}-${row.shift}-${index}`} className="grid grid-cols-[1fr_.8fr] gap-3 py-3 text-sm"><strong className="capitalize">{row.date.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })}</strong><span className="text-muted-foreground">{shiftLabel[row.shift]}</span></div>)}</div></section>
}

export function OtherRequestWorkspace({ employees }: { employees: Employee[] }) {
  const { authUser, isPreviewMode } = useAuth()
  const role = useUserRole()
  const [pending, setPending] = useState<ManagementPendingItem[]>([])
  const [decisions, setDecisions] = useState<DecisionHistoryItem[]>([])
  const [selected, setSelected] = useState<RequestRow | null>(null)
  const [note, setNote] = useState('')
  const [processing, setProcessing] = useState(false)
  const [message, setMessage] = useState('')
  const [penaltyDialog, setPenaltyDialog] = useState<PenaltyDialogState | null>(null)

  useEffect(() => {
    if (!authUser) return
    if (isPreviewMode) {
      const now = new Date()
      const timeout = window.setTimeout(() => {
        setPending([{
          id: 'preview-leave-pending', type: 'leave', employeeId: 'demo-user-001', employeeName: 'Nguyễn Minh An', employeeCode: 'NV-001',
          title: 'Yêu cầu xin nghỉ', detail: 'Ngày mai · việc gia đình', reason: 'Em cần nghỉ để giải quyết việc gia đình.', createdAt: now, referenceDate: now,
          targetIds: ['preview-leave-pending'],
        }])
        setDecisions([{
          key: 'preview-salary-approved', id: 'preview-salary-approved', ids: ['preview-salary-approved'], resource: 'salary',
          employeeId: 'preview-employee-2', title: 'Yêu cầu ứng lương', detail: '500.000đ · việc cá nhân',
          status: 'Approved', reviewNote: '', reviewedAt: new Date(now.getTime() - 60_000), reason: 'Việc cá nhân',
        }, {
          key: 'preview-late-rejected', id: 'preview-late-rejected', ids: ['preview-late-rejected'], resource: 'late',
          employeeId: 'demo-user-001', title: 'Yêu cầu đi trễ', detail: '20 phút · xe hư',
          status: 'Rejected', reviewNote: 'Báo quá sát giờ.', reviewedAt: new Date(now.getTime() - 120_000), reason: 'Xe hư',
        }])
      }, 0)
      return () => window.clearTimeout(timeout)
    }
    const weekWindow = currentWeekWindow()
    const unsubscribePending = subscribeToManagementPendingItems(
      (items) => setPending(items.filter((item) => item.type !== 'schedule' && item.type !== 'account')),
      () => setMessage('Chưa thể tải các yêu cầu khác.')
    )
    const unsubscribeHistory = subscribeToWeeklyDecisionHistory(
      weekWindow.start,
      new Date(weekWindow.end.getTime() - 1),
      (items) => setDecisions(items.filter((item) => item.resource !== 'schedule')),
      () => setMessage('Chưa thể tải lịch sử xử lý trong tuần.')
    )
    return () => { unsubscribePending(); unsubscribeHistory() }
  }, [authUser, isPreviewMode, role])

  const employeeMap = useMemo(() => new Map(employees.map((employee) => [employee.uid, employee])), [employees])
  const rows = useMemo<RequestRow[]>(() => [
    ...decisions.map((decision): RequestRow => ({ kind: 'decision', decision, status: decision.status, sortAt: decision.reviewedAt })),
    ...pending.map((item): RequestRow => ({ kind: 'pending', pending: item, status: 'Pending', sortAt: item.createdAt })),
  ].sort((left, right) => {
    const rank = { Pending: 0, Rejected: 1, Approved: 2 }
    return rank[left.status] - rank[right.status] || right.sortAt.getTime() - left.sortAt.getTime()
  }), [decisions, pending])

  const processPending = async (
    item: ManagementPendingItem,
    status: 'Approved' | 'Rejected',
    options: { skipPenaltyDialog?: boolean; penaltyAmount?: number } = {}
  ) => {
    if (!authUser || processing) return
    if (status === 'Rejected' && !note.trim()) { setMessage('Vui lòng nhập lý do từ chối.'); return }
    if (!options.skipPenaltyDialog && (item.type === 'leave' || item.type === 'late')) {
      const suggested = status === 'Approved' ? item.penaltyIfApproved || 0 : item.penaltyIfRejected || 0
      setPenaltyDialog({
        item,
        status,
        suggested,
        allowCustom: item.type === 'leave' && item.underMinimumWarning === true,
        amount: String(suggested),
      })
      return
    }
    const penaltyAmount = options.penaltyAmount
    setProcessing(true)
    setMessage('')
    try {
      if (!isPreviewMode) {
        if (item.type === 'leave') await updateLeaveStatus(item.targetIds[0], status, authUser.uid, note.trim(), penaltyAmount)
        if (item.type === 'late') await updateLateStatus(item.targetIds[0], status, authUser.uid, note.trim(), penaltyAmount)
        if (item.type === 'salary') await updateSalaryAdvanceStatus(item.targetIds[0], status, authUser.uid, note.trim())
        if (item.type === 'staff') await updateStaffRequestStatus(item.targetIds[0], status, note.trim())
      }
      setPending((current) => current.filter((row) => row.id !== item.id))
      setSelected(null)
      setNote('')
      setMessage(status === 'Approved' ? 'Đã duyệt yêu cầu.' : 'Đã từ chối yêu cầu.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể xử lý yêu cầu.')
    } finally { setProcessing(false) }
  }

  const confirmPenaltyDecision = async () => {
    if (!penaltyDialog) return
    const amount = Number(penaltyDialog.amount.replace(/[^0-9]/g, ''))
    if (!Number.isFinite(amount) || amount < 0) {
      setMessage('Mức trừ không hợp lệ.')
      return
    }
    const { item, status, allowCustom } = penaltyDialog
    setPenaltyDialog(null)
    await processPending(item, status, {
      skipPenaltyDialog: true,
      penaltyAmount: allowCustom ? amount : undefined,
    })
  }

  const changeDecision = async (item: DecisionHistoryItem) => {
    if (!authUser || processing) return
    const next = item.status === 'Approved' ? 'Rejected' : 'Approved'
    if (next === 'Rejected' && !note.trim()) { setMessage('Vui lòng nhập lý do hoàn tác.'); return }
    setProcessing(true)
    setMessage('')
    try {
      if (!isPreviewMode) {
        if (item.resource === 'leave') await updateLeaveStatus(item.id, next, authUser.uid, note.trim())
        if (item.resource === 'late') await updateLateStatus(item.id, next, authUser.uid, note.trim())
        if (item.resource === 'salary') await updateSalaryAdvanceStatus(item.id, next, authUser.uid, note.trim())
        if (item.resource === 'staff') await updateStaffRequestStatus(item.id, next, note.trim())
      }
      setDecisions((current) => current.map((row) => row.key === item.key ? { ...row, status: next, reviewNote: note.trim(), reviewedAt: new Date() } : row))
      setSelected((current) => current?.kind === 'decision' ? { ...current, status: next, decision: { ...current.decision, status: next, reviewNote: note.trim(), reviewedAt: new Date() } } : current)
      setNote('')
      setMessage(`Đã chuyển quyết định thành ${next === 'Approved' ? 'Duyệt' : 'Từ chối'}.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể hoàn tác quyết định.')
    } finally { setProcessing(false) }
  }

  return <section className="mt-5">
    {message && <p className="mb-3 rounded-2xl bg-indigo-50 p-3 text-sm font-semibold text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-100">{message}</p>}
    <div className="space-y-2">{rows.map((row, index) => {
      const type = row.kind === 'pending' ? row.pending.type : row.decision.resource
      const itemMeta = meta[type as keyof typeof meta]
      const Icon = itemMeta.icon
      const employeeId = row.kind === 'pending' ? row.pending.employeeId : row.decision.employeeId
      const employee = employeeMap.get(employeeId)
      const name = row.kind === 'pending' ? row.pending.employeeName : employee?.fullName || employeeId
      const code = row.kind === 'pending' ? row.pending.employeeCode : employee?.employeeCode || ''
      const photoURL = row.kind === 'pending' ? row.pending.employeePhotoURL || employee?.photoURL : employee?.photoURL
      const borderClass = row.status === 'Approved'
        ? 'border-l-emerald-500'
        : row.status === 'Pending'
          ? 'border-l-amber-400'
          : 'border-l-rose-500'
      const textClass = row.status === 'Approved' ? 'text-emerald-600' : row.status === 'Pending' ? 'text-amber-600' : 'text-rose-600'
      const rowKey = row.kind === 'pending' ? row.pending.id : row.decision.key
      const showProcessedDivider = index > 0 && row.status !== 'Pending' && rows[index - 1].status === 'Pending'
      return <Fragment key={rowKey}>{showProcessedDivider && <div className="flex items-center gap-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400"><span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" /><span>Đã xử lý</span><span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" /></div>}<button type="button" onClick={() => { setSelected(row); setNote(''); setMessage('') }} className={`mobile-card flex min-h-20 w-full items-center gap-3 border-l-4 p-3 text-left ${borderClass}`}>
        <RequestIdentityAvatar name={name} photoURL={photoURL} icon={Icon} iconColor={itemMeta.color} />
        <div className="min-w-0 flex-1"><h3 className="truncate text-base font-extrabold">{name}</h3>{code && <p className="truncate text-sm font-semibold text-muted-foreground">{code}</p>}</div>
        <div className="text-right"><span className={`text-xs font-black ${textClass}`}>{row.status === 'Approved' ? 'Đã duyệt' : row.status === 'Pending' ? 'Chờ duyệt' : 'Từ chối'}</span><ChevronRight className="ml-auto mt-1 h-4 w-4 text-slate-400" /></div>
      </button></Fragment>
    })}{!rows.length && <div className="mobile-card p-8 text-center"><Check className="mx-auto h-8 w-8 text-emerald-600" /><p className="mt-3 font-bold">Không có yêu cầu khác trong tuần này.</p></div>}</div>

    {selected && (() => {
      const type = selected.kind === 'pending' ? selected.pending.type : selected.decision.resource
      const itemMeta = meta[type as keyof typeof meta]
      const employeeId = selected.kind === 'pending' ? selected.pending.employeeId : selected.decision.employeeId
      const employee = employeeMap.get(employeeId)
      const name = selected.kind === 'pending' ? selected.pending.employeeName : employee?.fullName || employeeId
      const title = selected.kind === 'pending' ? selected.pending.title : selected.decision.title
      const detail = selected.kind === 'pending' ? selected.pending.detail : selected.decision.detail
      const reason = selected.kind === 'pending' ? selected.pending.reason : selected.decision.reason
      const shifts = selected.kind === 'pending' ? selected.pending.shifts : selected.decision.shifts
      const removed = selected.kind === 'pending' ? selected.pending.removedShifts : selected.decision.removedShifts
      const next = selected.kind === 'decision' ? selected.decision.status === 'Approved' ? 'Rejected' : 'Approved' : null
      return <div className="fixed inset-0 z-[75] overflow-y-auto bg-slate-100 dark:bg-slate-950"><header className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95"><div className="mx-auto flex min-h-20 max-w-lg items-center gap-3 px-4 pt-[env(safe-area-inset-top)]"><button type="button" onClick={() => setSelected(null)} className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 dark:bg-slate-800" aria-label="Quay lại"><ArrowLeft className="h-5 w-5" /></button><div><h2 className="font-black">Chi tiết yêu cầu</h2><p className="text-sm text-muted-foreground">Xem, xử lý hoặc hoàn tác</p></div></div></header><main className="mx-auto max-w-lg p-3"><article className="overflow-hidden rounded-[2rem] bg-white shadow-xl dark:bg-slate-900"><section className={`bg-gradient-to-r ${itemMeta.gradient} p-5 text-white`}><h2 className="text-xl font-black">{title}</h2><p className="mt-2 font-extrabold">{name}</p><p className="mt-1 text-sm text-white/85">{detail}</p><span className="mt-3 inline-flex rounded-full bg-white/20 px-3 py-1 text-xs font-black">{selected.status === 'Approved' ? 'Đã duyệt' : selected.status === 'Pending' ? 'Cần xử lý' : 'Đã từ chối'}</span></section><section className="space-y-4 p-4">{reason && <p className="rounded-2xl bg-slate-50 p-3 text-sm leading-6 dark:bg-slate-800"><strong>Ghi chú:</strong> {reason}</p>}<ShiftRows title="Ca mới / ca thêm" rows={shifts} /><ShiftRows title="Ca muốn hủy" rows={removed} />{selected.kind === 'decision' && selected.decision.reviewNote && <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900"><strong>Phản hồi cũ:</strong> {selected.decision.reviewNote}</p>}<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder={selected.kind === 'pending' ? 'Lý do từ chối (nếu từ chối)...' : next === 'Rejected' ? 'Nhập lý do hoàn tác...' : 'Ghi chú mới (không bắt buộc)...'} className="w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-base leading-6 dark:border-slate-700 dark:bg-slate-900" />{selected.kind === 'pending' ? <div className="grid grid-cols-2 gap-2"><button type="button" disabled={processing || !note.trim()} onClick={() => void processPending(selected.pending, 'Rejected')} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-rose-200 font-extrabold text-rose-600 disabled:opacity-50"><X className="h-4 w-4" /> Từ chối</button><button type="button" disabled={processing} onClick={() => void processPending(selected.pending, 'Approved')} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 font-extrabold text-white disabled:opacity-50">{processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Duyệt</button></div> : <button type="button" disabled={processing || (next === 'Rejected' && !note.trim())} onClick={() => void changeDecision(selected.decision)} className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl font-extrabold text-white disabled:opacity-50 ${next === 'Rejected' ? 'bg-rose-600' : 'bg-emerald-600'}`}><RotateCcw className="h-4 w-4" /> Hoàn tác thành {next === 'Rejected' ? 'Từ chối' : 'Duyệt'}</button>}</section></article></main></div>
    })()}

    {penaltyDialog && (
      <div className="fixed inset-0 z-[95] flex items-end justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:items-center" onClick={() => !processing && setPenaltyDialog(null)}>
        <section role="dialog" aria-modal="true" aria-labelledby="penalty-dialog-title" className="w-full max-w-md overflow-hidden rounded-[2rem] bg-white shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
          <div className={`p-5 text-white ${penaltyDialog.item.type === 'late' ? 'bg-gradient-to-r from-amber-500 to-orange-600' : 'bg-gradient-to-r from-emerald-500 to-teal-700'}`}>
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/20"><AlertTriangle className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1"><p className="text-xs font-black uppercase tracking-wider text-white/75">Xác nhận khoản trừ</p><h2 id="penalty-dialog-title" className="mt-1 text-xl font-black">{penaltyDialog.item.employeeName}</h2><p className="mt-1 text-sm text-white/85">{penaltyDialog.status === 'Approved' ? 'Duyệt yêu cầu' : 'Từ chối yêu cầu'} · {penaltyDialog.item.type === 'late' ? 'báo đi trễ' : 'xin nghỉ'}</p></div>
              <button type="button" onClick={() => setPenaltyDialog(null)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15" aria-label="Đóng"><X className="h-5 w-5" /></button>
            </div>
          </div>
          <div className="space-y-4 p-5">
            {penaltyDialog.item.type === 'late' ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                <p className="text-sm font-black">Khoản trừ được tính tự động</p>
                <p className="mt-2 text-2xl font-black">{penaltyDialog.suggested.toLocaleString('vi-VN')}đ</p>
                <p className="mt-2 text-xs leading-5">{penaltyDialog.item.warning || 'Mức trừ được tính theo thời điểm báo và quy định đi trễ.'}</p>
              </div>
            ) : penaltyDialog.allowCustom ? (
              <>
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-950 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
                  <p className="text-sm font-black">Tuần này xuống dưới mức tối thiểu</p>
                  <p className="mt-1 text-xs leading-5">Chỉ trường hợp này mới cho phép quản lý chọn mức trừ riêng khi duyệt yêu cầu nghỉ.</p>
                </div>
                <label className="block text-sm font-extrabold">Mức trừ áp dụng
                  <div className="relative mt-2"><input inputMode="numeric" value={penaltyDialog.amount} onChange={(event) => setPenaltyDialog((current) => current ? { ...current, amount: event.target.value.replace(/[^0-9]/g, '') } : current)} className="mobile-field pr-12 text-lg font-black" aria-label="Mức trừ áp dụng" /><span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-bold text-muted-foreground">đ</span></div>
                  <span className="mt-2 block text-xs font-medium text-muted-foreground">Mức hệ thống đề xuất: {penaltyDialog.suggested.toLocaleString('vi-VN')}đ</span>
                </label>
              </>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
                <p className="text-sm font-black">Mức trừ theo quy định</p>
                <p className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{penaltyDialog.suggested.toLocaleString('vi-VN')}đ</p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">Không có lựa chọn nhập mức trừ riêng vì yêu cầu này chưa làm nhân viên xuống dưới mức ca tối thiểu.</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={processing} onClick={() => setPenaltyDialog(null)} className="min-h-12 rounded-2xl border border-slate-200 font-bold dark:border-slate-700">Quay lại</button>
              <button type="button" disabled={processing} onClick={() => void confirmPenaltyDecision()} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-slate-950 font-extrabold text-white shadow-lg dark:bg-white dark:text-slate-950"><Check className="h-4 w-4" /> Xác nhận xử lý</button>
            </div>
          </div>
        </section>
      </div>
    )}
  </section>
}
