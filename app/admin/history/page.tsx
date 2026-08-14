'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, History, Loader2, RotateCcw, X } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { useAuth, useUserRole } from '@/lib/hooks/useAuth'
import { subscribeToActiveEmployees } from '@/lib/services/employeeService'
import { updateLeaveStatus } from '@/lib/services/leaveService'
import { updateLateStatus } from '@/lib/services/lateService'
import { updateSalaryAdvanceStatus } from '@/lib/services/salaryService'
import { updateStaffRequestStatus } from '@/lib/services/staffRequestService'
import { restoreAdminCancelledWorkSchedules, reviewWorkScheduleBatch } from '@/lib/services/scheduleService'
import { subscribeToWeeklyDecisionHistory, type DecisionHistoryItem, type DecisionStatus } from '@/lib/services/decisionHistoryService'
import type { Employee } from '@/lib/models/types'

function startOfWeek(offset = 0): Date {
  const date = new Date()
  const day = date.getDay() || 7
  date.setDate(date.getDate() - day + 1 + offset * 7)
  date.setHours(0, 0, 0, 0)
  return date
}

function endOfWeek(start: Date): Date {
  const date = new Date(start)
  date.setDate(date.getDate() + 6)
  date.setHours(23, 59, 59, 999)
  return date
}

function shortDate(date: Date): string {
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
}

const previewEmployees: Employee[] = [
  {
    uid: 'demo-user-001', employeeCode: 'NV-001', fullName: 'Nguyễn Minh An', phone: '0901234567',
    email: 'demo@example.com', role: 'employee', status: 'active', joinDate: new Date(), createdAt: new Date(), updatedAt: new Date(),
  },
  {
    uid: 'preview-employee-2', employeeCode: 'NV-002', fullName: 'Trần Thu Hà', phone: '0907654321',
    email: 'ha@example.com', role: 'employee', status: 'active', joinDate: new Date(), createdAt: new Date(), updatedAt: new Date(),
  },
]

function previewHistory(): DecisionHistoryItem[] {
  const now = new Date()
  return [
    { key: 'leave-preview', id: 'leave-preview', ids: ['leave-preview'], resource: 'leave', employeeId: 'demo-user-001', title: 'Yêu cầu xin nghỉ', detail: '30/07/2026 · Việc gia đình', status: 'Approved', reviewNote: '', reviewedAt: now },
    { key: 'salary-preview', id: 'salary-preview', ids: ['salary-preview'], resource: 'salary', employeeId: 'demo-user-001', title: 'Yêu cầu ứng lương', detail: '500.000đ · Cần chi phí gấp', status: 'Rejected', reviewNote: 'Chưa đủ ngày công trong tháng.', reviewedAt: now },
    { key: 'schedule-preview', id: 'schedule-preview', ids: ['schedule-preview-1', 'schedule-preview-2'], resource: 'schedule', employeeId: 'preview-employee-2', title: 'Bảng đăng ký lịch', detail: '6 ca · 03/08–09/08', status: 'Approved', reviewNote: '', reviewedAt: now },
  ]
}

export default function DecisionHistoryPage() {
  const { authUser, isPreviewMode } = useAuth()
  const role = useUserRole()
  const [weekOffset, setWeekOffset] = useState(0)
  const [items, setItems] = useState<DecisionHistoryItem[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [openEmployees, setOpenEmployees] = useState<Set<string>>(new Set())
  const [openItem, setOpenItem] = useState('')
  const [change, setChange] = useState<{ item: DecisionHistoryItem; status: DecisionStatus } | null>(null)
  const [reason, setReason] = useState('')
  const [processing, setProcessing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const weekStart = useMemo(() => startOfWeek(weekOffset), [weekOffset])
  const weekEnd = useMemo(() => endOfWeek(weekStart), [weekStart])

  useEffect(() => {
    if (!authUser) return
    if (isPreviewMode) {
      setEmployees(previewEmployees)
      setItems(weekOffset === 0 ? previewHistory() : [])
      setLoading(false)
      return
    }

    setLoading(true)
    setMessage('')
    let employeesReady = false
    let historyReady = false
    const done = () => {
      if (employeesReady && historyReady) setLoading(false)
    }
    const handleError = () => {
      setMessage('Chưa tải được lịch sử xử lý. Hãy kiểm tra kết nối và quyền quản lý.')
      setLoading(false)
    }
    const unsubscribeEmployees = subscribeToActiveEmployees((next) => {
      setEmployees(next)
      employeesReady = true
      done()
    }, handleError)
    const unsubscribeHistory = subscribeToWeeklyDecisionHistory(weekStart, weekEnd, (next) => {
      setItems(next)
      historyReady = true
      done()
    }, handleError)
    return () => {
      unsubscribeEmployees()
      unsubscribeHistory()
    }
  }, [authUser, isPreviewMode, weekEnd, weekOffset, weekStart])

  const employeeMap = useMemo(() => new Map(employees.map((employee) => [employee.uid, employee])), [employees])
  const groups = useMemo(() => {
    const grouped = new Map<string, DecisionHistoryItem[]>()
    items.forEach((item) => {
      const current = grouped.get(item.employeeId)
      if (current) current.push(item)
      else grouped.set(item.employeeId, [item])
    })
    return Array.from(grouped.entries()).sort((left, right) => {
      const leftName = employeeMap.get(left[0])?.fullName || ''
      const rightName = employeeMap.get(right[0])?.fullName || ''
      return leftName.localeCompare(rightName, 'vi')
    })
  }, [employeeMap, items])

  const toggleEmployee = (employeeId: string) => {
    setOpenEmployees((current) => {
      const next = new Set(current)
      if (next.has(employeeId)) next.delete(employeeId)
      else next.add(employeeId)
      return next
    })
  }

  const openChange = (item: DecisionHistoryItem, status: DecisionStatus) => {
    if (weekOffset !== 0) {
      setMessage('Tuần trước đã khóa quyết định và chỉ còn để tra cứu.')
      return
    }
    if (item.status === 'Cancelled' && (role !== 'admin' || item.resource !== 'schedule')) {
      setMessage('Chỉ admin được khôi phục lịch đã điều chỉnh.')
      return
    }
    if (item.status === status) return
    setReason('')
    setChange({ item, status })
  }

  const applyChange = async () => {
    if (!change || !authUser || (change.status === 'Rejected' && !reason.trim())) return
    setProcessing(true)
    setMessage('')
    try {
      const nextStatus = change.status === 'Approved' || change.status === 'Rejected' ? change.status : null
      if (!nextStatus) return
      const restoringSchedule = change.item.resource === 'schedule' && change.item.status === 'Cancelled' && nextStatus === 'Approved'
      if (!isPreviewMode) {
        const note = nextStatus === 'Rejected' ? reason.trim() : ''
        if (change.item.resource === 'leave') await updateLeaveStatus(change.item.id, nextStatus, authUser.uid, note)
        if (change.item.resource === 'late') await updateLateStatus(change.item.id, nextStatus, authUser.uid, note)
        if (change.item.resource === 'salary') await updateSalaryAdvanceStatus(change.item.id, nextStatus, authUser.uid, note)
        if (change.item.resource === 'staff') await updateStaffRequestStatus(change.item.id, nextStatus, note)
        if (restoringSchedule) await restoreAdminCancelledWorkSchedules(change.item.ids)
        else if (change.item.resource === 'schedule') await reviewWorkScheduleBatch(change.item.ids, nextStatus, note)
      } else {
        setItems((current) => current.map((item) => item.key === change.item.key
          ? { ...item, status: nextStatus, reviewNote: nextStatus === 'Rejected' ? reason.trim() : '', reviewedAt: new Date() }
          : item))
      }
      setMessage(restoringSchedule
        ? 'Đã khôi phục các ca về trạng thái trước khi admin điều chỉnh và báo lại cho nhân viên.'
        : `Đã đổi quyết định thành ${nextStatus === 'Approved' ? 'Duyệt' : 'Từ chối'} và gửi thông báo mới cho nhân viên.`)
      setChange(null)
      setReason('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể đổi quyết định.')
    } finally {
      setProcessing(false)
    }
  }

  if ((!role || !['admin', 'manager', 'director'].includes(role)) && !isPreviewMode) {
    return <main className="min-h-screen"><Header title="Lịch sử xử lý" /><PageContainer><div className="mobile-card p-8 text-center font-bold">Tài khoản không có quyền xem lịch sử quản lý.</div></PageContainer></main>
  }

  return (
    <main className="min-h-screen pb-8">
      <Header title="Lịch sử xử lý" subtitle="Giữ tuần này và tuần trước" />
      <PageContainer>
        <section className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <button type="button" disabled={weekOffset <= -1} onClick={() => setWeekOffset(-1)} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-600 disabled:opacity-30 dark:bg-slate-800 dark:text-slate-200" aria-label="Tuần trước"><ChevronLeft className="h-5 w-5" /></button>
            <div className="min-w-0 flex-1 text-center">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-indigo-600">{weekOffset === 0 ? 'Tuần này · được sửa' : 'Tuần trước · chỉ xem'}</p>
              <p className="mt-0.5 text-sm font-extrabold">{shortDate(weekStart)} – {shortDate(weekEnd)}</p>
            </div>
            <button type="button" disabled={weekOffset >= 0} onClick={() => setWeekOffset((value) => Math.min(0, value + 1))} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-600 disabled:opacity-30 dark:bg-slate-800 dark:text-slate-200" aria-label="Tuần sau"><ChevronRight className="h-5 w-5" /></button>
          </div>
        </section>

        <div className="mt-4 flex items-start gap-2 rounded-2xl bg-indigo-50 p-3 text-xs leading-5 text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200">
          {weekOffset === 0 ? <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" /> : <History className="mt-0.5 h-4 w-4 shrink-0" />}
          {weekOffset === 0
            ? 'Chỉ quyết định trong tuần này được sửa; mỗi lần sửa sẽ báo lại cho nhân viên.'
            : 'Tuần trước đã khóa, chỉ dùng để đối chiếu. Bản lưu dài hạn nằm trên Google Drive.'}
        </div>

        {message && <p className="mt-3 rounded-2xl bg-slate-900 p-3 text-sm font-semibold text-white dark:bg-white dark:text-slate-900">{message}</p>}

        {loading ? (
          <div className="grid min-h-56 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>
        ) : groups.length ? (
          <section className="mt-4 space-y-3">
            {groups.map(([employeeId, employeeItems]) => {
              const employee = employeeMap.get(employeeId)
              const isOpen = openEmployees.has(employeeId)
              const approved = employeeItems.filter((item) => item.status === 'Approved').length
              const cancelled = employeeItems.filter((item) => item.status === 'Cancelled').length
              return (
                <article key={employeeId} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
                  <button type="button" onClick={() => toggleEmployee(employeeId)} className="flex w-full items-center gap-3 p-4 text-left" aria-expanded={isOpen}>
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-50 text-sm font-black text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
                      {(employee?.fullName || 'NV').split(' ').slice(-2).map((part) => part[0]).join('')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate font-extrabold">{employee?.fullName || 'Nhân viên'}</h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">{employee?.employeeCode || employeeId} · {employeeItems.length} yêu cầu</p>
                    </div>
                    <div className="text-right text-[10px] font-bold text-slate-500"><p>{approved} duyệt</p><p>{cancelled ? `${cancelled} đã hủy` : `${employeeItems.length - approved} từ chối`}</p></div>
                    <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {isOpen && (
                    <div className="space-y-2 border-t border-slate-100 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-slate-950/20">
                      {employeeItems.map((item) => {
                        const itemOpen = openItem === item.key
                        return (
                          <div key={item.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900">
                            <button type="button" onClick={() => setOpenItem(itemOpen ? '' : item.key)} className="flex w-full items-center gap-3 p-3 text-left" aria-expanded={itemOpen}>
                              <CalendarDays className="h-5 w-5 shrink-0 text-slate-400" />
                              <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{item.title}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{item.reviewedAt.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p></div>
                              <span className={`rounded-lg px-2 py-1 text-[10px] font-bold ${item.status === 'Approved' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : item.status === 'Cancelled' ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'}`}>{item.status === 'Approved' ? 'Đã duyệt' : item.status === 'Cancelled' ? 'Admin đã hủy' : 'Đã từ chối'}</span>
                              <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${itemOpen ? 'rotate-180' : ''}`} />
                            </button>
                            {itemOpen && (
                              <div className="border-t border-slate-100 p-3 dark:border-white/10">
                                <p className="text-sm leading-5 text-slate-600 dark:text-slate-300">{item.detail}</p>
                                {item.reviewNote && <p className="mt-2 rounded-xl bg-slate-50 p-2.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"><strong>Phản hồi:</strong> {item.reviewNote}</p>}
                                {weekOffset === 0 ? item.status === 'Cancelled' ? (
                                  <button type="button" disabled={role !== 'admin'} onClick={() => openChange(item, 'Approved')} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"><RotateCcw className="h-4 w-4" /> Khôi phục lịch</button>
                                ) : (
                                  <div className="mt-3 grid grid-cols-2 gap-2">
                                    <button type="button" disabled={item.status === 'Rejected'} onClick={() => openChange(item, 'Rejected')} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:text-slate-200 dark:disabled:bg-slate-800"><X className="h-4 w-4" /> Từ chối</button>
                                    <button type="button" disabled={item.status === 'Approved'} onClick={() => openChange(item, 'Approved')} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 text-xs font-bold text-white disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800"><Check className="h-4 w-4" /> Duyệt</button>
                                  </div>
                                ) : <p className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-center text-xs font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-300">Đã khóa chỉnh sửa</p>}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </article>
              )
            })}
          </section>
        ) : (
          <div className="mt-4 rounded-3xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
            <History className="mx-auto h-8 w-8 text-slate-400" />
            <h2 className="mt-3 font-extrabold">Chưa có quyết định trong tuần</h2>
            <p className="mt-1 text-sm text-muted-foreground">Các yêu cầu đã duyệt hoặc từ chối sẽ xuất hiện tại đây.</p>
          </div>
        )}
      </PageContainer>

      {change && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-sm" onClick={() => !processing && setChange(null)}>
          <section className="w-full max-w-md rounded-[2rem] bg-white p-5 shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-indigo-600">Xác nhận sửa quyết định</p>
            <h2 className="mt-1 text-xl font-black">{change.item.status === 'Cancelled' ? 'Khôi phục lịch này?' : change.status === 'Approved' ? 'Đổi thành Duyệt?' : 'Đổi thành Từ chối?'}</h2>
            <p className="mt-2 text-sm leading-5 text-muted-foreground">{change.item.status === 'Cancelled' ? 'Các ca sẽ được trả về trạng thái trước khi admin hủy và nhân viên sẽ nhận thông báo mới.' : `${change.item.title}. Thao tác này sẽ cập nhật trạng thái và gửi thông báo mới cho nhân viên.`}</p>
            {change.status === 'Rejected' && (
              <label className="mt-4 block text-sm font-bold">Lý do từ chối
                <textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} className="mobile-field mt-2 min-h-24 py-3" placeholder="Nhập lý do để nhân viên hiểu quyết định mới..." />
              </label>
            )}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" disabled={processing} onClick={() => setChange(null)} className="h-12 rounded-2xl border border-slate-200 text-sm font-bold dark:border-slate-700">Quay lại</button>
              <button type="button" disabled={processing || (change.item.status !== 'Cancelled' && change.status === 'Rejected' && !reason.trim())} onClick={() => void applyChange()} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-sm font-bold text-white disabled:opacity-50">
                {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} {change.item.status === 'Cancelled' ? 'Khôi phục' : 'Cập nhật'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
