'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, CircleDollarSign, Copy, Download, Landmark, Loader2, MessageCircle, Phone, RotateCcw, X } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { RequestIdentityAvatar } from '@/components/admin/request-identity-avatar'
import { useAuth, useUserRole } from '@/lib/hooks/useAuth'
import type { Employee, SalaryAdvance } from '@/lib/models/types'
import { subscribeToAllEmployees } from '@/lib/services/employeeService'
import { reopenSalaryAdvance, subscribeToAllSalaryAdvances, updateSalaryAdvanceStatus } from '@/lib/services/salaryService'
import { DEMO_EMPLOYEE } from '@/lib/config/demo'
import { mockSalaryAdvances } from '@/lib/services/mockData'
import { auth } from '@/lib/firebase'
import { employeeFactoryId } from '@/lib/models/factory'
import { MonthNavigator } from '@/components/ui/month-navigator'
import { readSalaryAdvanceMonth } from '@/lib/services/monthDataService'
import { currentVietnamMonth } from '@/lib/archive/retention'

type SalaryFilter = 'all' | 'Pending' | 'Approved' | 'Rejected' | 'Cancelled'

type DirectorSalaryAdvance = {
  id: string
  employeeId: string
  employeeName: string
  employeeCode: string
  photoURL?: string
  phone?: string
  facebookUrl?: string
  amount: number
  reason: string
  bankName: string
  bankAccountName: string
  bankAccountNumber: string
  approvedAt: string | null
}

function formatAmount(value: number) {
  return `${Number(value || 0).toLocaleString('vi-VN')}đ`
}

function formatDate(value: SalaryAdvance['createdAt'] | SalaryAdvance['reviewedAt']) {
  if (!value) return 'Chưa cập nhật'
  const date = value instanceof Date ? value : value.toDate()
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function statusLabel(status: SalaryAdvance['status']) {
  if (status === 'Approved') return 'Đã duyệt'
  if (status === 'Rejected') return 'Từ chối'
  if (status === 'Cancelled') return 'Đã hủy'
  return 'Chờ xử lý'
}

function statusClasses(status: SalaryAdvance['status']) {
  if (status === 'Approved') return 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20'
  if (status === 'Rejected') return 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/20'
  if (status === 'Cancelled') return 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700'
  return 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20'
}

function avatarColor(status: SalaryAdvance['status']) {
  if (status === 'Approved') return 'bg-emerald-500'
  if (status === 'Rejected') return 'bg-rose-500'
  if (status === 'Cancelled') return 'bg-slate-500'
  return 'bg-sky-500'
}

function directorDate(value: string | null) {
  if (!value) return 'Chưa cập nhật'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Chưa cập nhật' : date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function DirectorSalaryAdvancesPanel({ isPreviewMode }: { isPreviewMode: boolean }) {
  const { authUser } = useAuth()
  const [items, setItems] = useState<DirectorSalaryAdvance[]>([])
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState('')
  const [exporting, setExporting] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [month, setMonth] = useState(currentVietnamMonth(new Date()).key)

  useEffect(() => {
    if (!authUser) return
    if (isPreviewMode) {
      const demoEmployee = DEMO_EMPLOYEE as Employee
      setItems((mockSalaryAdvances as SalaryAdvance[])
        .filter((item) => item.status === 'Approved')
        .map((item) => ({
          id: item.id || 'demo-approved-advance',
          employeeId: demoEmployee.uid,
          employeeName: demoEmployee.fullName,
          employeeCode: demoEmployee.employeeCode,
          photoURL: demoEmployee.photoURL,
          phone: demoEmployee.phone,
          facebookUrl: demoEmployee.facebookUrl,
          amount: Number(item.amount || 0),
          reason: item.reason || '',
          bankName: demoEmployee.bankName || '',
          bankAccountName: demoEmployee.bankAccountName || '',
          bankAccountNumber: demoEmployee.bankAccountNumber || '',
          approvedAt: null,
        })))
      setReady(true)
      return
    }

    let active = true
    setReady(false)
    void (async () => {
      try {
        const result = await readSalaryAdvanceMonth(month)
        const employeeById = new Map(result.employees.map((employee) => [employee.uid || (employee as Employee & { id?: string }).id, employee]))
        const nextItems = result.records.filter((item) => {
          const employee = employeeById.get(item.employeeId)
          return item.status === 'Approved' && (result.source === 'drive' || employee?.status === 'active')
        }).map((item) => {
          const employee = employeeById.get(item.employeeId)
          return {
            id: item.id || `${item.employeeId}-${String(item.createdAt)}`,
            employeeId: item.employeeId,
            employeeName: employee?.fullName || 'Nhân viên',
            employeeCode: employee?.employeeCode || item.employeeId,
            photoURL: employee?.photoURL,
            phone: employee?.phone,
            facebookUrl: employee?.facebookUrl,
            amount: Number(item.amount || 0),
            reason: item.reason || '',
            bankName: employee?.bankName || '',
            bankAccountName: employee?.bankAccountName || '',
            bankAccountNumber: employee?.bankAccountNumber || '',
            approvedAt: item.reviewedAt instanceof Date ? item.reviewedAt.toISOString() : null,
          }
        })
        if (active) setItems(nextItems)
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : 'Chưa thể tải danh sách ứng lương đã duyệt.')
      } finally {
        if (active) setReady(true)
      }
    })()
    return () => { active = false }
  }, [authUser, isPreviewMode, month])

  const copyAccountNumber = async (item: DirectorSalaryAdvance) => {
    if (!item.bankAccountNumber) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(item.bankAccountNumber)
      } else {
        const input = document.createElement('textarea')
        input.value = item.bankAccountNumber
        input.style.position = 'fixed'
        input.style.opacity = '0'
        document.body.appendChild(input)
        input.select()
        document.execCommand('copy')
        input.remove()
      }
      setCopiedId(item.id)
      window.setTimeout(() => setCopiedId((current) => current === item.id ? null : current), 1800)
    } catch {
      setMessage('Chưa thể copy số tài khoản. Hãy thử lại.')
    }
  }

  const exportExcel = async () => {
    if (isPreviewMode) {
      setMessage('Chế độ xem thử không tạo file Excel.')
      return
    }
    setExporting(true)
    setMessage('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) throw new Error('Bạn cần đăng nhập lại.')
      const response = await fetch(`/api/exports/salary-advances?month=${encodeURIComponent(month)}`, { headers: { authorization: `Bearer ${token}` } })
      if (!response.ok) throw new Error('Chưa thể xuất file Excel ứng lương.')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `danh-sach-ung-luong-da-duyet-${month}.xlsx`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể xuất file Excel.')
    } finally {
      setExporting(false)
    }
  }

  const total = items.reduce((sum, item) => sum + item.amount, 0)

  return (
    <main className="min-h-screen bg-[#f3f7fb] pb-28 dark:bg-slate-950 md:pb-32">
      <Header title="Danh sách ứng lương" subtitle="Danh sách đã duyệt · sẵn sàng chuyển khoản" />
      <PageContainer maxWidth="2xl">
        <MonthNavigator value={month} onChange={setMonth} loading={!ready} />
        <section className="mb-5 overflow-hidden rounded-3xl bg-gradient-to-br from-sky-600 via-blue-600 to-indigo-700 p-4 text-white shadow-lg shadow-blue-900/15 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15">
                <CircleDollarSign className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[10px] font-black uppercase tracking-[0.13em] text-blue-100">Đã duyệt · sẵn sàng chuyển khoản</p>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <p className="text-2xl font-black tracking-tight">{items.length} yêu cầu</p>
                  <p className="text-base font-extrabold text-blue-100">{formatAmount(total)}</p>
                </div>
                <p className="mt-0.5 truncate text-[11px] font-semibold text-blue-100">Danh sách admin đã duyệt</p>
              </div>
            </div>
            <button type="button" onClick={() => void exportExcel()} disabled={exporting} className="flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 text-xs font-black text-blue-700 shadow-md transition hover:bg-blue-50 active:scale-[0.98] disabled:opacity-60">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {exporting ? 'Đang tạo Excel...' : 'Xuất Excel'}
            </button>
          </div>
        </section>

        {message && <p className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">{message}</p>}
        {!ready ? <div className="grid min-h-56 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div> : !items.length ? (
          <div className="rounded-[2rem] border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10"><CircleDollarSign className="h-7 w-7" /></div>
            <h2 className="mt-4 text-xl font-black text-slate-950 dark:text-white">Chưa có khoản ứng lương đã duyệt</h2>
            <p className="mt-2 text-sm text-slate-500">Danh sách sẽ tự cập nhật sau khi admin duyệt yêu cầu.</p>
          </div>
        ) : (
          <section className="grid gap-4 md:grid-cols-2">
            {items.map((item) => (
              <article key={item.id} className="overflow-hidden rounded-3xl border border-slate-200/90 bg-white p-3 shadow-[0_14px_35px_-28px_rgba(30,64,175,.45)] transition hover:-translate-y-0.5 hover:shadow-xl dark:border-slate-800 dark:bg-slate-900 sm:p-4">
                <div className="flex items-start gap-3">
                  <RequestIdentityAvatar name={item.employeeName} photoURL={item.photoURL} icon={CircleDollarSign} iconColor="bg-sky-600" compact />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-black tracking-tight text-slate-950 dark:text-white">{item.employeeName}</p>
                    <p className="mt-0.5 truncate text-xs font-bold text-slate-500 dark:text-slate-400">{item.employeeCode} · Đã duyệt {directorDate(item.approvedAt)}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">Đã duyệt</span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-white/10">
                  <div className="min-w-0">
                    <p className="text-2xl font-black tracking-tight text-sky-700 dark:text-sky-300">{formatAmount(item.amount)}</p>
                    <p className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">{item.reason || 'Không có ghi chú.'}</p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <a
                      href={item.phone ? `tel:${item.phone}` : undefined}
                      aria-disabled={!item.phone}
                      aria-label="Gọi điện"
                      className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2 text-[10px] font-black text-slate-600 transition active:scale-[0.98] aria-disabled:pointer-events-none aria-disabled:opacity-45 dark:border-slate-700 dark:text-slate-300"
                    >
                      <Phone className="h-3 w-3" /> Gọi
                    </a>
                    <a
                      href={item.facebookUrl || undefined}
                      target={item.facebookUrl ? '_blank' : undefined}
                      rel={item.facebookUrl ? 'noreferrer' : undefined}
                      aria-disabled={!item.facebookUrl}
                      aria-label="Mở Facebook"
                      className="flex h-8 items-center gap-1 rounded-lg bg-blue-600 px-2 text-[10px] font-black text-white transition active:scale-[0.98] aria-disabled:pointer-events-none aria-disabled:opacity-45"
                    >
                      <MessageCircle className="h-3 w-3" /> FB
                    </a>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 rounded-2xl bg-gradient-to-br from-slate-50 to-indigo-50/80 px-3 py-2.5 dark:from-slate-800 dark:to-indigo-950/40">
                  <Landmark className="h-4 w-4 shrink-0 text-indigo-600" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-black text-slate-950 dark:text-white">{item.bankName || 'Chưa cập nhật ngân hàng'} · {item.bankAccountName || 'Chưa có chủ tài khoản'}</p>
                    <p className="truncate text-sm font-black tracking-[0.08em] text-slate-700 dark:text-slate-100">{item.bankAccountNumber || 'Chưa có số tài khoản'}</p>
                  </div>
                  <button type="button" onClick={() => void copyAccountNumber(item)} disabled={!item.bankAccountNumber} aria-label="Copy số tài khoản" className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-sky-300 bg-white px-2 text-xs font-black text-sky-700 transition hover:bg-sky-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 dark:border-sky-500/40 dark:bg-slate-900 dark:text-sky-300">
                    {copiedId === item.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedId === item.id ? 'Đã copy' : 'Copy'}
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}
      </PageContainer>
    </main>
  )
}

export default function AdminSalaryAdvancesPage() {
  const { authUser, employee: currentEmployee, isPreviewMode } = useAuth()
  const role = useUserRole()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [requests, setRequests] = useState<SalaryAdvance[]>([])
  const [liveRequests, setLiveRequests] = useState<SalaryAdvance[]>([])
  const [month, setMonth] = useState(currentVietnamMonth(new Date()).key)
  const [monthLoading, setMonthLoading] = useState(false)
  const [ready, setReady] = useState({ employees: false, requests: false })
  const [filter, setFilter] = useState<SalaryFilter>('all')
  const [message, setMessage] = useState('')
  const [exporting, setExporting] = useState(false)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [expandedProcessedId, setExpandedProcessedId] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<SalaryAdvance | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const exportExcel = async () => {
    if (isPreviewMode) {
      setMessage('Chế độ xem thử không tạo file Excel.')
      return
    }
    setExporting(true)
    setMessage('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) throw new Error('Bạn cần đăng nhập lại.')
      const response = await fetch(`/api/exports/salary-advances?month=${encodeURIComponent(month)}`, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('Chưa thể xuất file Excel ứng lương.')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `lich-su-ung-luong-${new Date().toISOString().slice(0, 10)}.xlsx`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể xuất file Excel.')
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => {
    if (!authUser) return
    if (isPreviewMode) {
      setEmployees([{ ...DEMO_EMPLOYEE, uid: 'demo-user-001' } as Employee])
      setRequests(mockSalaryAdvances as SalaryAdvance[])
      setReady({ employees: true, requests: true })
      return
    }
    if (role === 'director') {
      setReady({ employees: true, requests: true })
      return
    }
    const fail = () => setMessage('Chưa tải được danh sách ứng lương.')
    const unsubscribeEmployees = subscribeToAllEmployees((items) => {
      setEmployees(items)
      setReady((current) => ({ ...current, employees: true }))
    }, fail, employeeFactoryId(currentEmployee))
    const unsubscribeRequests = subscribeToAllSalaryAdvances((items) => {
      setLiveRequests(items)
      setReady((current) => ({ ...current, requests: true }))
    }, fail)
    return () => {
      unsubscribeEmployees()
      unsubscribeRequests()
    }
  }, [authUser, currentEmployee, isPreviewMode, role])

  useEffect(() => {
    if (!authUser || isPreviewMode || role === 'director') return
    const currentMonth = currentVietnamMonth(new Date()).key
    if (month === currentMonth) {
      setRequests(liveRequests)
      return
    }
    let active = true
    setMonthLoading(true)
    void readSalaryAdvanceMonth(month)
      .then((result) => {
        if (!active) return
        setRequests(result.records)
        setEmployees((current) => {
          const byId = new Map(current.map((employee) => [employee.uid, employee]))
          result.employees.forEach((employee) => byId.set(employee.uid || (employee as Employee & { id?: string }).id || '', employee))
          return Array.from(byId.values()).filter((employee) => employee.uid)
        })
      })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : 'Chưa thể tải lịch sử ứng lương.') })
      .finally(() => { if (active) setMonthLoading(false) })
    return () => { active = false }
  }, [authUser, isPreviewMode, liveRequests, month, role])

  const activeEmployeeIds = useMemo(
    () => new Set(employees.filter((employee) => month === currentVietnamMonth(new Date()).key ? employee.status === 'active' : true).map((employee) => employee.uid)),
    [employees, month]
  )
  const operationalRequests = useMemo(
    () => requests.filter((request) => activeEmployeeIds.has(request.employeeId)),
    [activeEmployeeIds, requests]
  )
  const filteredRequests = useMemo(
    () => operationalRequests.filter((request) => filter === 'all' || request.status === filter),
    [filter, operationalRequests]
  )
  const pendingRequests = filteredRequests.filter((request) => request.status === 'Pending')
  const processedRequests = filteredRequests.filter((request) => request.status !== 'Pending')
  const pendingCount = operationalRequests.filter((request) => request.status === 'Pending').length
  const approvedCount = operationalRequests.filter((request) => request.status === 'Approved').length
  const pendingTotal = operationalRequests
    .filter((request) => request.status === 'Pending')
    .reduce((sum, request) => sum + Number(request.amount || 0), 0)
  const approvedTotal = operationalRequests
    .filter((request) => request.status === 'Approved')
    .reduce((sum, request) => sum + Number(request.amount || 0), 0)

  const employeeFor = (request: SalaryAdvance) => employees.find((item) => item.uid === request.employeeId)

  const handleReview = async (request: SalaryAdvance, status: 'Approved' | 'Rejected', note = '') => {
    if (!request.id || !authUser) return
    setProcessingId(request.id)
    setMessage('')
    try {
      if (!isPreviewMode) await updateSalaryAdvanceStatus(request.id, status, authUser.uid, note)
      setRequests((current) => current.map((item) => item.id === request.id
        ? { ...item, status, reviewNote: note, reviewedBy: authUser.uid, reviewedAt: new Date(), approvedBy: authUser.uid }
        : item))
      setRejectTarget(null)
      setRejectReason('')
      setExpandedProcessedId(null)
      setMessage(status === 'Approved' ? 'Đã duyệt yêu cầu ứng lương.' : 'Đã từ chối yêu cầu ứng lương.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể cập nhật yêu cầu.')
    } finally {
      setProcessingId(null)
    }
  }

  const handleReopen = async (request: SalaryAdvance) => {
    if (!request.id) return
    setProcessingId(request.id)
    setMessage('')
    try {
      if (!isPreviewMode) await reopenSalaryAdvance(request.id, 'Quản lý mở lại để nhân viên điều chỉnh hoặc gửi lại.')
      setRequests((current) => current.map((item) => item.id === request.id
        ? { ...item, status: 'Pending', reviewNote: 'Quản lý mở lại để nhân viên điều chỉnh hoặc gửi lại.', reviewedAt: undefined, reviewedBy: undefined }
        : item))
      setExpandedProcessedId(null)
      setMessage('Đã mở lại yêu cầu và chuyển về mục chờ xử lý.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể mở lại yêu cầu.')
    } finally {
      setProcessingId(null)
    }
  }

  const openRejectDialog = (request: SalaryAdvance) => {
    setRejectTarget(request)
    setRejectReason('')
  }

  if ((!role || !['admin', 'manager', 'director'].includes(role)) && !isPreviewMode) return null
  if (role === 'director') return <DirectorSalaryAdvancesPanel isPreviewMode={isPreviewMode} />

  return (
    <main className="min-h-screen bg-slate-50/70 pb-28 dark:bg-slate-950 md:pb-32">
      <Header title="Quản lý ứng lương" subtitle="Duyệt nhanh, theo dõi rõ và gửi đúng danh sách đã duyệt" />
      <PageContainer maxWidth="2xl">
        <MonthNavigator value={month} onChange={setMonth} loading={monthLoading} />
        <div className="mb-4 rounded-2xl border border-sky-500/20 bg-gradient-to-r from-sky-600 to-blue-700 p-3 text-white shadow-md shadow-sky-950/10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15 text-white"><CircleDollarSign className="h-5 w-5" /></span>
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-sky-100">Tổng quan ứng lương</p>
                <p className="text-sm font-black">Chờ {pendingCount} · Đã duyệt {approvedCount}</p>
                <p className="break-words text-[11px] font-semibold leading-5 text-sky-100">{formatAmount(pendingTotal)} đang chờ · {formatAmount(approvedTotal)} đã duyệt</p>
              </div>
            </div>
            <button type="button" onClick={() => void exportExcel()} disabled={exporting} className="flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-black text-sky-700 transition active:scale-[0.98] disabled:opacity-60 sm:w-auto sm:min-w-48">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span>{exporting ? 'Đang tạo Excel...' : 'Xuất Excel đã duyệt'}</span>
            </button>
          </div>
        </div>

        <div className="mb-5 flex gap-2 overflow-x-auto rounded-2xl border border-sky-100 bg-sky-50 p-1 [scrollbar-width:none] dark:border-sky-500/20 dark:bg-sky-500/10">
          {([
            ['all', 'Tất cả'],
            ['Pending', 'Chờ xử lý'],
            ['Approved', 'Đã duyệt'],
            ['Rejected', 'Từ chối'],
            ['Cancelled', 'Đã hủy'],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setFilter(value)} className={`min-h-10 shrink-0 rounded-xl px-4 text-xs font-bold ${filter === value ? 'bg-sky-600 text-white shadow-sm dark:bg-sky-500' : 'text-slate-600 dark:text-slate-300'}`}>{label}</button>
          ))}
        </div>

        {message && <p className="mb-4 rounded-2xl border border-sky-100 bg-sky-50 p-3 text-sm font-semibold text-sky-800 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-200">{message}</p>}
        {!ready.employees || !ready.requests ? (
          <div className="grid min-h-56 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-sky-600" /></div>
        ) : (
          <>
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-xs font-bold uppercase tracking-wider text-sky-600">Cần quản lý quyết định</p><h2 className="text-xl font-black text-slate-900 dark:text-white">Chưa xử lý</h2></div>
                <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-black text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">{pendingRequests.length}</span>
              </div>
              {pendingRequests.map((request) => {
                const employee = employeeFor(request)
                const employeeName = employee?.fullName || 'Nhân viên'
                const busy = processingId === request.id
                return (
                  <article key={request.id} className="overflow-hidden rounded-3xl border border-sky-100 bg-white p-4 shadow-[0_12px_30px_-24px_rgba(14,116,144,0.65)] dark:border-sky-500/20 dark:bg-slate-900 sm:p-5">
                    <div className="flex items-start gap-3">
                      <RequestIdentityAvatar name={employeeName} photoURL={employee?.photoURL} icon={CircleDollarSign} iconColor={avatarColor(request.status)} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-sky-600">Ứng lương mới</p>
                        <h3 className="mt-1 truncate text-base font-black text-slate-900 dark:text-white">{employeeName}</h3>
                        <p className="mt-0.5 text-xs font-bold text-slate-500 dark:text-slate-400">Mã nhân viên · {employee?.employeeCode || request.employeeId}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-black ring-1 ${statusClasses(request.status)}`}>{statusLabel(request.status)}</span>
                    </div>
                    <div className="mt-4 rounded-2xl bg-sky-50/80 p-3 dark:bg-sky-500/10">
                      <div className="flex items-end justify-between gap-3"><p className="text-2xl font-black text-sky-700 dark:text-sky-300">{formatAmount(request.amount)}</p><p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Gửi ngày {formatDate(request.createdAt)}</p></div>
                      <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">{request.reason || 'Không có ghi chú.'}</p>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <a href={`tel:${employee?.phone || ''}`} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-xs font-bold text-slate-700 transition active:scale-[0.98] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"><Phone className="h-4 w-4" /> Gọi điện</a>
                      <a href={employee?.facebookUrl || 'https://facebook.com/'} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-xs font-bold text-slate-700 transition active:scale-[0.98] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"><MessageCircle className="h-4 w-4" /> Facebook</a>
                    </div>
                    {month === currentVietnamMonth(new Date()).key && <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 dark:border-white/10">
                      <button type="button" onClick={() => openRejectDialog(request)} disabled={busy} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-rose-200 text-xs font-black text-rose-700 transition active:scale-[0.98] disabled:opacity-50 dark:border-rose-500/30 dark:text-rose-300"><X className="h-4 w-4" /> Từ chối</button>
                      <button type="button" onClick={() => void handleReview(request, 'Approved')} disabled={busy} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-xs font-black text-white transition active:scale-[0.98] disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Duyệt</button>
                    </div>}
                  </article>
                )
              })}
              {!pendingRequests.length && <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-7 text-center text-sm font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">Không có yêu cầu đang chờ trong bộ lọc này.</div>}
            </section>

            <section className="mt-8">
              <div className="mb-3 flex items-center gap-3"><span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" /><span className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Đã xử lý · {processedRequests.length}</span><span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" /></div>
              <div className="space-y-2.5">
                {processedRequests.map((request) => {
                  const employee = employeeFor(request)
                  const employeeName = employee?.fullName || 'Nhân viên'
                  const expanded = expandedProcessedId === request.id
                  const busy = processingId === request.id
                  return (
                    <article key={request.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                      <button type="button" onClick={() => setExpandedProcessedId(expanded ? null : request.id || null)} aria-expanded={expanded} className="flex min-h-20 w-full items-center gap-3 p-4 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60">
                        <RequestIdentityAvatar name={employeeName} photoURL={employee?.photoURL} icon={CircleDollarSign} iconColor={avatarColor(request.status)} />
                        <span className="min-w-0 flex-1"><span className="block truncate font-black text-slate-900 dark:text-white">{employeeName}</span><span className="mt-0.5 block text-xs font-bold text-slate-500 dark:text-slate-400">Mã nhân viên · {employee?.employeeCode || request.employeeId}</span></span>
                        <span className="flex shrink-0 items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[11px] font-black ring-1 ${statusClasses(request.status)}`}>{statusLabel(request.status)}</span><ChevronDown className={`h-5 w-5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} /></span>
                      </button>
                      {expanded && (
                        <div className="border-t border-slate-100 p-4 dark:border-white/10">
                          <div className="flex items-end justify-between gap-3"><p className="text-xl font-black text-slate-900 dark:text-white">{formatAmount(request.amount)}</p><p className="text-xs font-semibold text-slate-500">Gửi {formatDate(request.createdAt)} · Xử lý {formatDate(request.reviewedAt)}</p></div>
                          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{request.reason || 'Không có ghi chú.'}</p>
                          {request.reviewNote && <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-xs font-semibold leading-5 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><span className="font-black">Phản hồi:</span> {request.reviewNote}</p>}
                          {month === currentVietnamMonth(new Date()).key && <div className="mt-4 grid gap-2 sm:grid-cols-2">
                            {request.status === 'Approved' && <button type="button" onClick={() => openRejectDialog(request)} disabled={busy} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-rose-200 text-xs font-black text-rose-700 disabled:opacity-50 dark:border-rose-500/30 dark:text-rose-300"><X className="h-4 w-4" /> Đổi sang từ chối</button>}
                            {request.status === 'Rejected' && <button type="button" onClick={() => void handleReview(request, 'Approved')} disabled={busy} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-xs font-black text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Duyệt lại</button>}
                            <button type="button" onClick={() => void handleReopen(request)} disabled={busy} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-sky-50 text-xs font-black text-sky-700 disabled:opacity-50 dark:bg-sky-500/10 dark:text-sky-300">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Mở lại chờ xử lý</button>
                          </div>}
                        </div>
                      )}
                    </article>
                  )
                })}
                {!processedRequests.length && <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-7 text-center text-sm font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">Chưa có yêu cầu đã xử lý.</div>}
              </div>
            </section>
          </>
        )}
      </PageContainer>

      {rejectTarget && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm" onClick={() => setRejectTarget(null)}>
          <div className="w-full max-w-md rounded-[2rem] bg-white p-5 shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wider text-rose-600">Từ chối yêu cầu</p><h2 className="mt-1 text-xl font-black text-slate-900 dark:text-white">{formatAmount(rejectTarget.amount)} · {employeeFor(rejectTarget)?.fullName || 'Nhân viên'}</h2></div><button type="button" onClick={() => setRejectTarget(null)} aria-label="Đóng lớp từ chối" className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800"><X className="h-4 w-4" /></button></div>
            <p className="mt-2 text-sm text-muted-foreground">Nhập lý do để nhân viên biết và có thể gửi yêu cầu khác khi cần.</p>
            <textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} className="mobile-field mt-4 min-h-28 py-3" placeholder="Ví dụ: Chưa đủ thông tin hoặc chưa thể duyệt trong kỳ này..." autoFocus />
            <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => setRejectTarget(null)} className="min-h-12 rounded-2xl border border-slate-200 font-bold dark:border-slate-700">Quay lại</button><button type="button" disabled={!rejectReason.trim() || !!processingId} onClick={() => void handleReview(rejectTarget, 'Rejected', rejectReason.trim())} className="min-h-12 rounded-2xl bg-rose-600 font-bold text-white disabled:opacity-50">{processingId ? 'Đang lưu...' : 'Xác nhận từ chối'}</button></div>
          </div>
        </div>
      )}
    </main>
  )
}
