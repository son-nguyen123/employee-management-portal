'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, CircleDollarSign, Clock3, FileText, Loader2, X } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import { getPendingLeaveRequests, updateLeaveStatus } from '@/lib/services/leaveService'
import { getPendingLateRequests, updateLateStatus } from '@/lib/services/lateService'
import { getPendingSalaryAdvances, updateSalaryAdvanceStatus } from '@/lib/services/salaryService'
import { mockLateRequests, mockLeaveRequests, mockSalaryAdvances } from '@/lib/services/mockData'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { Badge } from '@/components/ui/badge'
import { getActiveEmployees } from '@/lib/services/employeeService'
import { createForgottenDutyPenalty } from '@/lib/services/penaltyService'
import type { Employee } from '@/lib/models/types'

type RequestType = 'leave' | 'late' | 'salary'
type RequestRow = {
  id: string
  type: RequestType
  employeeId: string
  employeeName: string
  title: string
  detail: string
  status: string
}

export default function AdminRequestsPage() {
  const { authUser, isPreviewMode } = useAuth()
  const [filter, setFilter] = useState<'all' | RequestType>('all')
  const [rows, setRows] = useState<RequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [penaltyEmployeeId, setPenaltyEmployeeId] = useState('')
  const [penaltyDate, setPenaltyDate] = useState(new Date().toISOString().slice(0, 10))
  const [penaltyNote, setPenaltyNote] = useState('')
  const [penaltySubmitting, setPenaltySubmitting] = useState(false)
  const [rejectingRow, setRejectingRow] = useState<RequestRow | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  useEffect(() => {
    if (!authUser) return
    const load = async () => {
      try {
        const [leaves, lates, salaries, activeEmployees] = isPreviewMode
          ? [mockLeaveRequests, mockLateRequests, mockSalaryAdvances, []]
          : await Promise.all([getPendingLeaveRequests(), getPendingLateRequests(), getPendingSalaryAdvances(), getActiveEmployees()])
        const employeeList = isPreviewMode ? [{
          uid: 'demo-user-001',
          employeeCode: 'NV-001',
          fullName: 'Nguyễn Minh An',
          phone: '0901234567',
          email: 'demo@example.com',
          role: 'employee',
          status: 'active',
          joinDate: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Employee] : activeEmployees as Employee[]
        const employeeNames = new Map(employeeList.map((employee) => [employee.uid, employee.fullName]))
        setEmployees(employeeList)
        setPenaltyEmployeeId((current) => current || employeeList[0]?.uid || '')
        setRows([
          ...leaves.map((item: any, index: number) => ({
            id: item.id || `leave-${index}`,
            type: 'leave' as const,
            employeeId: item.employeeId || 'demo-user-001',
            employeeName: employeeNames.get(item.employeeId) || (isPreviewMode ? 'Nguyễn Minh An' : 'Nhân viên'),
            title: 'Yêu cầu xin nghỉ',
            detail: `${item.reason || 'Nghỉ việc cá nhân'} · ${item.duration === 'long' ? 'Dài hạn' : 'Ngắn hạn'}`,
            status: item.status || 'Pending',
          })),
          ...lates.map((item: any, index: number) => ({
            id: item.id || `late-${index}`,
            type: 'late' as const,
            employeeId: item.employeeId || 'demo-user-001',
            employeeName: employeeNames.get(item.employeeId) || (isPreviewMode ? 'Nguyễn Minh An' : 'Nhân viên'),
            title: 'Yêu cầu đi trễ',
            detail: `${item.reason || 'Có việc đột xuất'} · ${item.lateMinutes || 15} phút`,
            status: item.status || 'Pending',
          })),
          ...salaries.map((item: any, index: number) => ({
            id: item.id || `salary-${index}`,
            type: 'salary' as const,
            employeeId: item.employeeId || 'demo-user-001',
            employeeName: employeeNames.get(item.employeeId) || (isPreviewMode ? 'Nguyễn Minh An' : 'Nhân viên'),
            title: 'Yêu cầu ứng lương',
            detail: `${Number(item.amount || 0).toLocaleString('vi-VN')} VND · ${item.reason || 'Chi phí cá nhân'}`,
            status: item.status || 'Pending',
          })),
        ].filter((item) => item.status === 'Pending'))
      } catch {
        setMessage('Chưa tải được danh sách yêu cầu.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [authUser, isPreviewMode])

  const process = async (row: RequestRow, status: 'Approved' | 'Rejected', suppliedNote = '') => {
    if (!authUser) return
    const reviewNote = status === 'Rejected' ? suppliedNote.trim() : ''
    if (status === 'Rejected' && !reviewNote) return
    try {
      if (!isPreviewMode) {
        if (row.type === 'leave') await updateLeaveStatus(row.id, status, authUser.uid, reviewNote)
        if (row.type === 'late') await updateLateStatus(row.id, status, authUser.uid, reviewNote)
        if (row.type === 'salary') await updateSalaryAdvanceStatus(row.id, status, authUser.uid, reviewNote)
      }
      setRows((prev) => prev.filter((item) => item.id !== row.id))
      setMessage(status === 'Approved' ? 'Đã duyệt yêu cầu.' : 'Đã từ chối yêu cầu.')
      setRejectingRow(null)
      setRejectReason('')
    } catch {
      setMessage('Không thể xử lý. Kiểm tra quyền admin của tài khoản.')
    }
  }

  const addForgottenDutyPenalty = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!penaltyEmployeeId || !penaltyDate) return
    setPenaltySubmitting(true)
    try {
      if (!isPreviewMode) await createForgottenDutyPenalty(penaltyEmployeeId, `${penaltyDate}T12:00:00`, penaltyNote)
      setPenaltyNote('')
      setMessage('Đã ghi nhận phạt quên trực: khấu trừ 1.000đ vào tiền công của 1 giờ làm.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể ghi nhận khoản phạt.')
    } finally {
      setPenaltySubmitting(false)
    }
  }

  const visibleRows = rows.filter((row) => filter === 'all' || row.type === filter)
  const meta = {
    leave: { icon: FileText, color: 'bg-emerald-600', label: 'Xin nghỉ' },
    late: { icon: Clock3, color: 'bg-amber-500', label: 'Đi trễ' },
    salary: { icon: CircleDollarSign, color: 'bg-sky-600', label: 'Ứng lương' },
  }

  return (
    <main className="min-h-screen pb-8">
      <Header title="Duyệt yêu cầu" subtitle="Xin nghỉ, đi trễ và ứng lương" />
      <PageContainer>
        <form onSubmit={addForgottenDutyPenalty} className="mb-5 overflow-hidden rounded-3xl border border-rose-200 bg-white shadow-sm dark:border-rose-500/20 dark:bg-slate-900">
          <div className="flex items-center gap-3 bg-gradient-to-r from-rose-600 to-fuchsia-600 p-4 text-white">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15"><AlertTriangle className="h-5 w-5" /></div>
            <div><p className="text-xs font-bold uppercase tracking-wider text-rose-100">Ghi phạt thủ công</p><h2 className="font-black">Quên trực · 1.000đ</h2></div>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <label className="text-sm font-bold">Nhân viên
              <select value={penaltyEmployeeId} onChange={(event) => setPenaltyEmployeeId(event.target.value)} className="mobile-field mt-2" required>
                <option value="">Chọn nhân viên</option>
                {employees.map((employee) => <option key={employee.uid} value={employee.uid}>{employee.fullName} · {employee.employeeCode}</option>)}
              </select>
            </label>
            <label className="text-sm font-bold">Ngày quên trực
              <input type="date" value={penaltyDate} onChange={(event) => setPenaltyDate(event.target.value)} className="mobile-field mt-2" required />
            </label>
            <label className="text-sm font-bold sm:col-span-2">Ghi chú <span className="font-normal text-muted-foreground">(không bắt buộc)</span>
              <textarea value={penaltyNote} onChange={(event) => setPenaltyNote(event.target.value)} className="mobile-field mt-2 min-h-20 py-3" placeholder="Ví dụ: Không có mặt trong ca trực chiều..." />
            </label>
            <button type="submit" disabled={penaltySubmitting || (!isPreviewMode && !employees.length)} className="mobile-primary-button bg-rose-600 sm:col-span-2">
              {penaltySubmitting && <Loader2 className="h-4 w-4 animate-spin" />} Ghi nhận phạt 1.000đ
            </button>
          </div>
        </form>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {[
            { value: 'all' as const, label: 'Tất cả' },
            { value: 'leave' as const, label: 'Xin nghỉ' },
            { value: 'late' as const, label: 'Đi trễ' },
            { value: 'salary' as const, label: 'Ứng lương' },
          ].map((item) => (
            <button key={item.value} onClick={() => setFilter(item.value)} className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-bold ${filter === item.value ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300'}`}>
              {item.label}
            </button>
          ))}
        </div>
        {message && <p className="mt-3 rounded-2xl bg-indigo-50 p-3 text-sm font-semibold text-indigo-800">{message}</p>}
        {loading ? (
          <div className="grid min-h-56 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>
        ) : (
          <div className="mt-4 space-y-3">
            {visibleRows.map((row) => {
              const itemMeta = meta[row.type]
              const Icon = itemMeta.icon
              return (
                <article key={`${row.type}-${row.id}`} className="mobile-card p-4">
                  <div className="flex items-start gap-3">
                    <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white ${itemMeta.color}`}><Icon className="h-5 w-5" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><h2 className="font-extrabold">{row.title}</h2><Badge variant="warning">Chờ duyệt</Badge></div>
                      <p className="mt-1 text-sm text-muted-foreground">{row.detail}</p>
                      <p className="mt-2 text-xs font-semibold text-indigo-600">{row.employeeName}</p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button onClick={() => setRejectingRow(row)} className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-rose-200 text-sm font-bold text-rose-600"><X className="h-4 w-4" /> Từ chối</button>
                    <button onClick={() => process(row, 'Approved')} className="flex min-h-11 items-center justify-center gap-1 rounded-xl bg-emerald-600 text-sm font-bold text-white"><Check className="h-4 w-4" /> Duyệt</button>
                  </div>
                </article>
              )
            })}
            {!visibleRows.length && <div className="mobile-card p-8 text-center"><Check className="mx-auto h-8 w-8 text-emerald-600" /><h2 className="mt-3 font-extrabold">Không còn yêu cầu</h2><p className="text-sm text-muted-foreground">Danh sách đã được xử lý hết.</p></div>}
          </div>
        )}
      </PageContainer>
      {rejectingRow && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/50 p-3 backdrop-blur-sm sm:items-center sm:justify-center" onClick={() => setRejectingRow(null)}>
          <div className="w-full max-w-md rounded-[2rem] bg-white p-5 shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
            <p className="text-xs font-bold uppercase tracking-wider text-rose-600">Từ chối yêu cầu</p>
            <h2 className="mt-1 text-xl font-black">{rejectingRow.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Lý do này sẽ được gửi trực tiếp cho nhân viên.</p>
            <textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} className="mobile-field mt-4 min-h-28 py-3" placeholder="Nhập lý do từ chối..." autoFocus />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setRejectingRow(null)} className="min-h-12 rounded-2xl border font-bold">Quay lại</button>
              <button type="button" disabled={!rejectReason.trim()} onClick={() => process(rejectingRow, 'Rejected', rejectReason)} className="min-h-12 rounded-2xl bg-rose-600 font-bold text-white disabled:opacity-50">Xác nhận từ chối</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
