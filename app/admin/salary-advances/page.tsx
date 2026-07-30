'use client'

import { useEffect, useMemo, useState } from 'react'
import { CircleDollarSign, CreditCard, Landmark, Loader2, UserRound } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { Badge } from '@/components/ui/badge'
import { useAuth, useUserRole } from '@/lib/hooks/useAuth'
import type { Employee, SalaryAdvance } from '@/lib/models/types'
import { subscribeToAllEmployees } from '@/lib/services/employeeService'
import { subscribeToAllSalaryAdvances } from '@/lib/services/salaryService'

export default function AdminSalaryAdvancesPage() {
  const { authUser, isPreviewMode } = useAuth()
  const role = useUserRole()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [requests, setRequests] = useState<SalaryAdvance[]>([])
  const [ready, setReady] = useState({ employees: false, requests: false })
  const [filter, setFilter] = useState<'all' | 'Pending' | 'Approved' | 'Rejected'>('all')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!authUser) return
    if (isPreviewMode) {
      setReady({ employees: true, requests: true })
      return
    }
    const fail = () => setMessage('Chưa tải được danh sách ứng lương.')
    const unsubscribeEmployees = subscribeToAllEmployees((items) => {
      setEmployees(items)
      setReady((current) => ({ ...current, employees: true }))
    }, fail)
    const unsubscribeRequests = subscribeToAllSalaryAdvances((items) => {
      setRequests(items)
      setReady((current) => ({ ...current, requests: true }))
    }, fail)
    return () => {
      unsubscribeEmployees()
      unsubscribeRequests()
    }
  }, [authUser, isPreviewMode])

  const rows = useMemo(
    () => requests.filter((request) => filter === 'all' || request.status === filter),
    [filter, requests]
  )
  const pendingTotal = useMemo(() => requests
    .filter((request) => request.status === 'Pending')
    .reduce((sum, request) => sum + Number(request.amount || 0), 0), [requests])

  if ((!role || !['admin', 'manager'].includes(role)) && !isPreviewMode) return null

  return (
    <main className="min-h-screen pb-8">
      <Header title="Danh sách ứng lương" subtitle="Yêu cầu và tài khoản nhận tiền của nhân viên" />
      <PageContainer maxWidth="2xl">
        <section className="mb-4 grid grid-cols-2 gap-3">
          <div className="rounded-3xl bg-sky-600 p-4 text-white">
            <CircleDollarSign className="h-5 w-5 text-sky-100" />
            <p className="mt-5 text-xs font-semibold text-sky-100">Đang chờ duyệt</p>
            <p className="mt-1 text-xl font-black">{requests.filter((item) => item.status === 'Pending').length} yêu cầu</p>
          </div>
          <div className="mobile-card p-4">
            <CreditCard className="h-5 w-5 text-indigo-600" />
            <p className="mt-5 text-xs font-semibold text-muted-foreground">Tổng tiền đang chờ</p>
            <p className="mt-1 text-xl font-black">{pendingTotal.toLocaleString('vi-VN')}đ</p>
          </div>
        </section>

        <div className="mb-4 flex gap-2 overflow-x-auto rounded-2xl bg-slate-100 p-1 [scrollbar-width:none]">
          {([
            ['all', 'Tất cả'],
            ['Pending', 'Chờ duyệt'],
            ['Approved', 'Đã duyệt'],
            ['Rejected', 'Từ chối'],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setFilter(value)} className={`min-h-10 shrink-0 rounded-xl px-4 text-xs font-bold ${filter === value ? 'bg-white text-sky-700 shadow-sm' : 'text-muted-foreground'}`}>{label}</button>
          ))}
        </div>

        {message && <p className="mb-4 rounded-2xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{message}</p>}
        {!ready.employees || !ready.requests ? (
          <div className="grid min-h-56 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-sky-600" /></div>
        ) : (
          <section className="space-y-3">
            {rows.map((request) => {
              const employee = employees.find((item) => item.uid === request.employeeId)
              return (
                <article key={request.id} className="mobile-card p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky-50 text-sky-600"><UserRound className="h-5 w-5" /></div>
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate font-extrabold">{employee?.fullName || 'Nhân viên'}</h2>
                      <p className="text-xs text-muted-foreground">{employee?.employeeCode || request.employeeId} · {employee?.phone || 'Chưa có SĐT'}</p>
                    </div>
                    <Badge variant={request.status === 'Approved' ? 'success' : request.status === 'Rejected' ? 'destructive' : request.status === 'Cancelled' ? 'outline' : 'warning'}>
                      {request.status === 'Approved' ? 'Đã duyệt' : request.status === 'Rejected' ? 'Từ chối' : request.status === 'Cancelled' ? 'Đã hủy' : 'Chờ duyệt'}
                    </Badge>
                  </div>
                  <p className="mt-4 text-2xl font-black text-sky-700">{Number(request.amount || 0).toLocaleString('vi-VN')}đ</p>
                  {request.reason && <p className="mt-1 text-sm text-muted-foreground">{request.reason}</p>}
                  <div className="mt-4 rounded-2xl bg-slate-50 p-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-500"><Landmark className="h-4 w-4" /> Tài khoản nhận tiền</div>
                    {employee?.bankName && employee?.bankAccountNumber ? (
                      <>
                        <p className="mt-2 font-extrabold">{employee.bankName} · {employee.bankAccountNumber}</p>
                        <p className="mt-1 text-xs uppercase text-muted-foreground">{employee.bankAccountName}</p>
                      </>
                    ) : <p className="mt-2 text-sm font-semibold text-amber-700">Nhân viên chưa cập nhật tài khoản ngân hàng.</p>}
                  </div>
                </article>
              )
            })}
            {!rows.length && <div className="mobile-card p-8 text-center text-sm font-semibold text-muted-foreground">Chưa có yêu cầu ứng lương trong nhóm này.</div>}
          </section>
        )}
      </PageContainer>
    </main>
  )
}
