'use client'

import { useEffect, useState } from 'react'
import { Check, CircleDollarSign, Clock3, FileText, Loader2, X } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import { getPendingLeaveRequests, updateLeaveStatus } from '@/lib/services/leaveService'
import { getPendingLateRequests, updateLateStatus } from '@/lib/services/lateService'
import { getPendingSalaryAdvances, updateSalaryAdvanceStatus } from '@/lib/services/salaryService'
import { mockLateRequests, mockLeaveRequests, mockSalaryAdvances } from '@/lib/services/mockData'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { Badge } from '@/components/ui/badge'

type RequestType = 'leave' | 'late' | 'salary'
type RequestRow = {
  id: string
  type: RequestType
  employeeId: string
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

  useEffect(() => {
    if (!authUser) return
    const load = async () => {
      try {
        const [leaves, lates, salaries] = isPreviewMode
          ? [mockLeaveRequests, mockLateRequests, mockSalaryAdvances]
          : await Promise.all([getPendingLeaveRequests(), getPendingLateRequests(), getPendingSalaryAdvances()])
        setRows([
          ...leaves.map((item: any, index: number) => ({
            id: item.id || `leave-${index}`,
            type: 'leave' as const,
            employeeId: item.employeeId || 'demo-user-001',
            title: 'Yêu cầu xin nghỉ',
            detail: `${item.reason || 'Nghỉ việc cá nhân'} · ${item.duration === 'long' ? 'Dài hạn' : 'Ngắn hạn'}`,
            status: item.status || 'Pending',
          })),
          ...lates.map((item: any, index: number) => ({
            id: item.id || `late-${index}`,
            type: 'late' as const,
            employeeId: item.employeeId || 'demo-user-001',
            title: 'Yêu cầu đi trễ',
            detail: `${item.reason || 'Có việc đột xuất'} · ${item.lateMinutes || 15} phút`,
            status: item.status || 'Pending',
          })),
          ...salaries.map((item: any, index: number) => ({
            id: item.id || `salary-${index}`,
            type: 'salary' as const,
            employeeId: item.employeeId || 'demo-user-001',
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

  const process = async (row: RequestRow, status: 'Approved' | 'Rejected') => {
    if (!authUser) return
    const reviewNote = status === 'Rejected'
      ? window.prompt('Nhập lý do từ chối để gửi cho nhân viên:')?.trim() || ''
      : ''
    if (status === 'Rejected' && !reviewNote) return
    try {
      if (!isPreviewMode) {
        if (row.type === 'leave') await updateLeaveStatus(row.id, status, authUser.uid, reviewNote)
        if (row.type === 'late') await updateLateStatus(row.id, status, authUser.uid, reviewNote)
        if (row.type === 'salary') await updateSalaryAdvanceStatus(row.id, status, authUser.uid, reviewNote)
      }
      setRows((prev) => prev.filter((item) => item.id !== row.id))
      setMessage(status === 'Approved' ? 'Đã duyệt yêu cầu.' : 'Đã từ chối yêu cầu.')
    } catch {
      setMessage('Không thể xử lý. Kiểm tra quyền admin của tài khoản.')
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
                      <p className="mt-2 text-xs font-semibold text-indigo-600">Nhân viên: {row.employeeId}</p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button onClick={() => process(row, 'Rejected')} className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-rose-200 text-sm font-bold text-rose-600"><X className="h-4 w-4" /> Từ chối</button>
                    <button onClick={() => process(row, 'Approved')} className="flex min-h-11 items-center justify-center gap-1 rounded-xl bg-emerald-600 text-sm font-bold text-white"><Check className="h-4 w-4" /> Duyệt</button>
                  </div>
                </article>
              )
            })}
            {!visibleRows.length && <div className="mobile-card p-8 text-center"><Check className="mx-auto h-8 w-8 text-emerald-600" /><h2 className="mt-3 font-extrabold">Không còn yêu cầu</h2><p className="text-sm text-muted-foreground">Danh sách đã được xử lý hết.</p></div>}
          </div>
        )}
      </PageContainer>
    </main>
  )
}
