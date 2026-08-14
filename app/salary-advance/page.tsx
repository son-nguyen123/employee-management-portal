'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Building2, CalendarClock, CheckCircle2, ChevronDown, CircleDollarSign, CreditCard, DollarSign, Landmark, Loader2, Pencil, RotateCcw, Trash2, UserRound, X } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import { cancelSalaryAdvance, createSalaryAdvance, reviseSalaryAdvance, subscribeToEmployeeSalaryAdvances } from '@/lib/services/salaryService'
import { updateEmployee } from '@/lib/services/employeeService'
import { mockSalaryAdvances } from '@/lib/services/mockData'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { StaffBanner } from '@/components/staff/staff-banner'
import { Card } from '@/components/ui/card'
import { RequestIdentityAvatar } from '@/components/admin/request-identity-avatar'
import { SkeletonLoader } from '@/components/ui/skeleton-loader'
import type { SalaryAdvance } from '@/lib/models/types'
import { getSalaryAdvancePolicy, type SalaryAdvancePolicy } from '@/lib/services/managementSettingsService'
import { MonthNavigator } from '@/components/ui/month-navigator'
import { readSalaryAdvanceMonth } from '@/lib/services/monthDataService'
import { currentVietnamMonth } from '@/lib/archive/retention'
import { belongsToVietnamMonth } from '@/lib/services/monthDataUtils'

function formatVietnameseCurrency(value: string | number): string {
  const digits = String(value).replace(/\D/g, '')
  if (!digits) return ''
  return Number(digits).toLocaleString('vi-VN')
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

function monthLabel(value: string) {
  const [year, month] = value.split('-')
  return `Tháng ${Number(month)}/${year}`
}

function SalaryAdvanceHistoryItem({
  advance,
  employeeName,
  employeeCode,
  photoURL,
  expanded,
  onToggle,
}: {
  advance: SalaryAdvance
  employeeName: string
  employeeCode: string
  photoURL?: string | null
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex min-h-20 w-full items-center gap-3 p-4 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60">
        <RequestIdentityAvatar name={employeeName} photoURL={photoURL || undefined} icon={CircleDollarSign} iconColor={avatarColor(advance.status)} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-black">{employeeName}</span>
          <span className="mt-0.5 block text-xs font-bold text-slate-500 dark:text-slate-400">Mã nhân viên · {employeeCode}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-right">
            <span className={`block rounded-full px-2.5 py-1 text-[11px] font-black ring-1 ${statusClasses(advance.status)}`}>{statusLabel(advance.status)}</span>
            <span className="mt-1 block text-xs font-black text-sky-700 dark:text-sky-300">{formatAmount(advance.amount)}</span>
          </span>
          <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {expanded && (
        <div className="border-t border-slate-100 p-4 dark:border-white/10">
          <div className="flex items-end justify-between gap-3">
            <p className="text-xl font-black">{formatAmount(advance.amount)}</p>
            <p className="text-right text-xs font-semibold text-slate-500">Gửi {formatDate(advance.createdAt)} · Xử lý {formatDate(advance.reviewedAt)}</p>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{advance.reason || 'Không có ghi chú.'}</p>
          {advance.reviewNote && <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-xs font-semibold leading-5 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><span className="font-black">Phản hồi quản lý:</span> {advance.reviewNote}</p>}
          {advance.status === 'Rejected' && <div className="mt-4 flex items-center gap-2 rounded-2xl bg-rose-50 p-3 text-xs font-bold text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"><RotateCcw className="h-4 w-4" /> Bạn có thể gửi một yêu cầu mới ở tháng hiện tại.</div>}
        </div>
      )}
    </article>
  )
}

type BankForm = {
  bankName: string
  bankAccountName: string
  bankAccountNumber: string
}

const BANK_OPTIONS = [
  'Vietcombank', 'VietinBank', 'BIDV', 'Agribank', 'Techcombank', 'MB Bank',
  'ACB', 'VPBank', 'TPBank', 'Sacombank', 'HDBank', 'VIB', 'MSB', 'OCB',
  'SeABank', 'SHB', 'Eximbank', 'LienVietPostBank', 'Nam A Bank', 'VietBank',
  'VietABank', 'Bac A Bank', 'BaoViet Bank', 'KienlongBank', 'PVcomBank',
  'NCB', 'PGBank', 'SaigonBank', 'GPBank', 'OceanBank', 'Shinhan Bank',
]

function hasCompleteBankInfo(values: BankForm): boolean {
  return Boolean(
    values.bankName.trim() &&
    values.bankAccountName.trim() &&
    /^\d{6,24}$/.test(values.bankAccountNumber.replace(/\s/g, '')),
  )
}

export default function SalaryAdvancePage() {
  const { authUser, employee, isLoading, isPreviewMode } = useAuth()
  const [loading, setLoading] = useState(true)
  const [previousAdvances, setPreviousAdvances] = useState<SalaryAdvance[]>([])
  const [liveAdvances, setLiveAdvances] = useState<SalaryAdvance[]>([])
  const [month, setMonth] = useState(currentVietnamMonth(new Date()).key)
  const [monthLoading, setMonthLoading] = useState(false)
  const [formData, setFormData] = useState({ amount: '', reason: '' })
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedProcessedId, setExpandedProcessedId] = useState<string | null>(null)
  const [bankModalOpen, setBankModalOpen] = useState(false)
  const [bankForm, setBankForm] = useState<BankForm>({ bankName: '', bankAccountName: '', bankAccountNumber: '' })
  const [savedBankInfo, setSavedBankInfo] = useState<BankForm | null>(null)
  const [bankError, setBankError] = useState('')
  const [savingBank, setSavingBank] = useState(false)
  const [salaryPolicy, setSalaryPolicy] = useState<SalaryAdvancePolicy>({ restrictionEnabled: false, canSubmit: true, vietnamDay: 1, allowedDays: [24, 25] })
  const [policyLoading, setPolicyLoading] = useState(true)

  useEffect(() => {
    if (!bankModalOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [bankModalOpen])

  useEffect(() => {
    if (!authUser) return

    if (isPreviewMode) {
      setPreviousAdvances(mockSalaryAdvances as SalaryAdvance[])
      setLoading(false)
      setPolicyLoading(false)
      return
    }

    void getSalaryAdvancePolicy()
      .then(setSalaryPolicy)
      .catch(() => setMessage({ type: 'error', text: 'Chưa tải được lịch mở ứng lương; hệ thống sẽ kiểm tra lại khi gửi.' }))
      .finally(() => setPolicyLoading(false))

    return subscribeToEmployeeSalaryAdvances(
      authUser.uid,
      (data) => {
        setLiveAdvances(data)
        setLoading(false)
      },
      (error) => {
        console.error('Error:', error)
        setLoading(false)
      }
    )
  }, [authUser, isPreviewMode])

  useEffect(() => {
    if (!authUser || isPreviewMode) return
    const currentMonth = currentVietnamMonth(new Date()).key
    if (month === currentMonth) {
      setPreviousAdvances(liveAdvances.filter((item) => belongsToVietnamMonth(item.createdAt, currentMonth)))
      return
    }
    let active = true
    setPreviousAdvances([])
    setExpandedProcessedId(null)
    setMonthLoading(true)
    void readSalaryAdvanceMonth(month)
      .then((result) => { if (active) setPreviousAdvances(result.records) })
      .catch((error) => { if (active) setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Chưa thể tải lịch sử ứng lương.' }) })
      .finally(() => { if (active) setMonthLoading(false) })
    return () => { active = false }
  }, [authUser, isPreviewMode, liveAdvances, month])

  const submitAdvanceRequest = async (amount: number, reason: string) => {
    if (!authUser) return
    const requestEditingId = editingId
    setSubmitting(true)
    setMessage(null)
    try {
      if (isPreviewMode) {
        const id = requestEditingId || `preview-salary-${Date.now()}`
        setPreviousAdvances((prev) => requestEditingId
          ? prev.map((item) => item.id === requestEditingId ? { ...item, amount, reason, status: 'Pending' } : item)
          : [{ id, employeeId: authUser.uid, amount, reason, status: 'Pending', createdAt: new Date(), updatedAt: new Date() }, ...prev])
        setMessage({ type: 'success', text: requestEditingId ? 'Đã gửi bản điều chỉnh trong chế độ xem thử.' : 'Đã gửi yêu cầu ứng lương trong chế độ xem thử.' })
        setEditingId(null)
        setFormData({ amount: '', reason: '' })
        return
      }

      const id = requestEditingId || await createSalaryAdvance({
        employeeId: authUser.uid,
        amount,
        reason,
        status: 'Pending',
      })
      if (requestEditingId) await reviseSalaryAdvance(requestEditingId, amount, reason)

      setPreviousAdvances((prev) => requestEditingId
        ? prev.map((item) => item.id === requestEditingId ? { ...item, amount, reason, status: 'Pending' } : item)
        : [{ id, employeeId: authUser.uid, amount, reason, status: 'Pending', createdAt: new Date(), updatedAt: new Date() }, ...prev])
      setMessage({ type: 'success', text: requestEditingId ? 'Đã gửi bản điều chỉnh cho quản lý.' : 'Đã gửi yêu cầu ứng lương!' })
      setEditingId(null)
      setFormData({ amount: '', reason: '' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Không thể gửi yêu cầu.' })
    } finally {
      setSubmitting(false)
    }
  }

  const openBankModal = () => {
    const currentBank = savedBankInfo || {
      bankName: employee?.bankName || '',
      bankAccountName: employee?.bankAccountName || employee?.fullName || authUser?.displayName || '',
      bankAccountNumber: employee?.bankAccountNumber || '',
    }
    setBankForm(currentBank)
    setBankError('')
    setBankModalOpen(true)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!authUser) return

    if (!salaryPolicy.canSubmit) {
      setMessage({ type: 'error', text: 'Ứng lương chỉ mở vào ngày 24 và 25 hằng tháng.' })
      return
    }

    if (!formData.amount) {
      setMessage({ type: 'error', text: 'Vui lòng nhập số tiền muốn ứng.' })
      return
    }

    const amount = Number(formData.amount.replace(/\D/g, ''))
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setMessage({ type: 'error', text: 'Số tiền chưa hợp lệ.' })
      return
    }

    const currentBank = savedBankInfo || {
      bankName: employee?.bankName || '',
      bankAccountName: employee?.bankAccountName || '',
      bankAccountNumber: employee?.bankAccountNumber || '',
    }
    if (!hasCompleteBankInfo(currentBank)) {
      openBankModal()
      return
    }

    await submitAdvanceRequest(amount, formData.reason.trim())
  }

  const saveBankAndSubmit = async () => {
    const normalizedBank: BankForm = {
      bankName: bankForm.bankName.trim(),
      bankAccountName: bankForm.bankAccountName.trim(),
      bankAccountNumber: bankForm.bankAccountNumber.replace(/\s/g, ''),
    }
    if (!normalizedBank.bankName || !normalizedBank.bankAccountName) {
      setBankError('Vui lòng nhập đủ ngân hàng và tên chủ tài khoản.')
      return
    }
    if (!/^\d{6,24}$/.test(normalizedBank.bankAccountNumber)) {
      setBankError('Số tài khoản phải gồm 6–24 chữ số.')
      return
    }

    const amount = Number(formData.amount.replace(/\D/g, ''))
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setBankModalOpen(false)
      setMessage({ type: 'error', text: 'Số tiền chưa hợp lệ.' })
      return
    }

    setSavingBank(true)
    setBankError('')
    try {
      if (!isPreviewMode) {
        await updateEmployee(authUser!.uid, normalizedBank)
      }
      setSavedBankInfo(normalizedBank)
      setBankModalOpen(false)
      await submitAdvanceRequest(amount, formData.reason.trim())
    } catch (error) {
      setBankError(error instanceof Error ? error.message : 'Chưa thể lưu thông tin ngân hàng.')
    } finally {
      setSavingBank(false)
    }
  }

  const editAdvance = (advance: SalaryAdvance) => {
    if (advance.status !== 'Pending' || !advance.id || !salaryPolicy.canSubmit) return
    setEditingId(advance.id)
    setFormData({ amount: formatVietnameseCurrency(advance.amount || ''), reason: advance.reason || '' })
    setMessage({ type: 'success', text: 'Bạn đang điều chỉnh yêu cầu đang chờ duyệt.' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cancelAdvance = async (id?: string) => {
    if (!id || !window.confirm('Bạn muốn rút yêu cầu ứng lương này?')) return
    try {
      if (!isPreviewMode) await cancelSalaryAdvance(id)
      setPreviousAdvances((prev) => prev.map((item) => item.id === id ? { ...item, status: 'Cancelled' } : item))
      setEditingId(null)
      setMessage({ type: 'success', text: 'Đã rút yêu cầu ứng lương.' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Chưa thể hủy yêu cầu.' })
    }
  }

  const pendingAdvances = useMemo(() => previousAdvances.filter((item) => item.status === 'Pending'), [previousAdvances])
  const processedAdvances = useMemo(() => previousAdvances.filter((item) => item.status !== 'Pending'), [previousAdvances])
  const hasPendingRequest = liveAdvances.some((item) => item.status === 'Pending')
  const isCurrentMonth = month === currentVietnamMonth(new Date()).key
  const employeeName = employee?.fullName || authUser?.displayName || 'Nhân viên'
  const employeeCode = employee?.employeeCode || 'Chưa có mã'

  const handleMonthChange = (nextMonth: string) => {
    const nextIsCurrentMonth = nextMonth === currentVietnamMonth(new Date()).key
    setMonth(nextMonth)
    setMonthLoading(!nextIsCurrentMonth)
    if (!nextIsCurrentMonth) setPreviousAdvances([])
    setEditingId(null)
    setExpandedProcessedId(null)
    setMessage(null)
  }

  if (isLoading || loading || policyLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header title="Ứng lương / yêu cầu" subtitle="Gửi đề nghị cho quản lý" />
        <PageContainer><SkeletonLoader variant="card" count={5} /></PageContainer>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50/70 pb-24 dark:bg-slate-950 md:pb-0">
      <Header title="Ứng lương / yêu cầu" subtitle="Gửi đề nghị cho quản lý" />
      <PageContainer>
        <MonthNavigator value={month} onChange={handleMonthChange} loading={monthLoading} />
        {isCurrentMonth && <StaffBanner icon={DollarSign} tone="sky" eyebrow="Ứng lương" title="Bạn cần hỗ trợ khoản nào?" description="Nhập số tiền muốn ứng và ghi chú ngắn để quản lý xem xét nhanh hơn." note="Bạn chỉ có thể điều chỉnh khi yêu cầu còn chờ duyệt. Sau khi quản lý xác nhận, yêu cầu sẽ được khóa để giữ đúng lịch sử." action={<Link href="/staff-note" className="rounded-xl bg-white/15 px-3 py-2 text-xs font-extrabold text-white backdrop-blur">Gửi yêu cầu khác</Link>} />}
        {isCurrentMonth && salaryPolicy.restrictionEnabled && (
          <div className={`mb-6 flex items-start gap-3 rounded-2xl border p-4 ${salaryPolicy.canSubmit ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'}`}>
            <CalendarClock className="mt-0.5 h-5 w-5 shrink-0" />
            <div><p className="text-sm font-black">{salaryPolicy.canSubmit ? 'Đang mở nhận ứng lương' : 'Chưa đến ngày nhận ứng lương'}</p><p className="mt-1 text-xs font-semibold leading-5">Chỉ gửi vào ngày 24–25 hằng tháng. Hôm nay là ngày {salaryPolicy.vietnamDay}.</p></div>
          </div>
        )}
        {message && <div className={`mb-6 flex items-start gap-2 rounded-2xl border p-4 ${message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300' : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300'}`}><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><p className="text-sm font-semibold">{message.text}</p></div>}

        {isCurrentMonth && (!hasPendingRequest || editingId) && <Card variant="elevated" className="mb-8 rounded-3xl border-sky-100 p-4 shadow-[0_14px_35px_-28px_rgba(14,116,144,0.8)] dark:border-sky-500/20 sm:p-6">
          <div className="mb-5 flex items-center gap-3"><RequestIdentityAvatar name={employeeName} photoURL={employee?.photoURL} icon={CircleDollarSign} iconColor="bg-sky-500" /><div><h2 className="text-xl font-black">Tạo yêu cầu ứng lương</h2><p className="text-xs font-semibold text-muted-foreground">Mã nhân viên · {employeeCode}</p></div></div>
          <form onSubmit={handleSubmit} className="space-y-5">
            <label className="block text-sm font-bold">Số tiền muốn ứng
              <div className="mt-2"><input type="text" inputMode="numeric" value={formData.amount} onChange={(event) => setFormData({ ...formData, amount: formatVietnameseCurrency(event.target.value) })} placeholder="Ví dụ: 2.000.000" className="mobile-field" disabled={submitting || !salaryPolicy.canSubmit} /></div>
            </label>
            <label className="block text-sm font-bold">Ghi chú <span className="font-normal text-muted-foreground">(không bắt buộc)</span>
              <textarea value={formData.reason} onChange={(event) => setFormData({ ...formData, reason: event.target.value })} placeholder="Bạn có thể ghi thêm để quản lý dễ xem xét..." rows={4} className="mobile-field mt-2 resize-none py-3" disabled={submitting || !salaryPolicy.canSubmit} />
            </label>
            <button type="submit" disabled={submitting || !salaryPolicy.canSubmit} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-sky-600 px-4 font-black text-white shadow-lg shadow-sky-500/20 transition active:scale-[0.99] disabled:opacity-50">{submitting && <Loader2 className="h-4 w-4 animate-spin" />}{submitting ? 'Đang gửi...' : !salaryPolicy.canSubmit ? 'Chỉ mở ngày 24–25' : editingId ? 'Gửi điều chỉnh' : 'Gửi yêu cầu'}</button>
          </form>
        </Card>}

        {!isCurrentMonth && (
          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Lịch sử ứng lương</p>
                <h2 className="mt-1 text-xl font-black text-slate-950 dark:text-white">{monthLabel(month)}</h2>
              </div>
              <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {monthLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : `${previousAdvances.length} yêu cầu`}
              </span>
            </div>
            <p className="mt-2 text-sm font-semibold leading-5 text-slate-500 dark:text-slate-400">Chỉ xem lịch sử; yêu cầu của tháng cũ không thể chỉnh sửa hoặc hủy.</p>
            <div className="mt-4 space-y-2.5">
              {monthLoading && <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm font-semibold text-slate-500 dark:border-slate-700">Đang tải dữ liệu tháng...</div>}
              {!monthLoading && previousAdvances.map((advance) => (
                <SalaryAdvanceHistoryItem
                  key={advance.id}
                  advance={advance}
                  employeeName={employeeName}
                  employeeCode={employeeCode}
                  photoURL={employee?.photoURL}
                  expanded={expandedProcessedId === advance.id}
                  onToggle={() => setExpandedProcessedId(expandedProcessedId === advance.id ? null : advance.id || null)}
                />
              ))}
              {!monthLoading && !previousAdvances.length && <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm font-semibold text-slate-500 dark:border-slate-700">Tháng này chưa có yêu cầu ứng lương.</div>}
            </div>
          </section>
        )}

        {isCurrentMonth && previousAdvances.length > 0 && <div>
          <div className="mb-3 flex items-center gap-3"><span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" /><span className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Lịch sử ứng lương</span><span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" /></div>
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-black text-sky-700 dark:text-sky-300">Chờ quản lý duyệt</h2><span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-black text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">{pendingAdvances.length}</span></div>
            {pendingAdvances.map((advance) => (
              <article key={advance.id} className="overflow-hidden rounded-3xl border border-sky-100 bg-white p-4 shadow-sm dark:border-sky-500/20 dark:bg-slate-900">
                <div className="flex items-start gap-3"><RequestIdentityAvatar name={employeeName} photoURL={employee?.photoURL} icon={CircleDollarSign} iconColor="bg-sky-500" /><div className="min-w-0 flex-1"><h3 className="truncate font-black">{employeeName}</h3><p className="text-xs font-bold text-slate-500 dark:text-slate-400">Mã nhân viên · {employeeCode}</p></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-black ring-1 ${statusClasses(advance.status)}`}>{statusLabel(advance.status)}</span></div>
                <div className="mt-4 rounded-2xl bg-sky-50/80 p-3 dark:bg-sky-500/10"><div className="flex items-end justify-between gap-3"><p className="text-2xl font-black text-sky-700 dark:text-sky-300">{formatAmount(advance.amount)}</p><p className="text-xs font-semibold text-slate-500">Gửi {formatDate(advance.createdAt)}</p></div><p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">{advance.reason || 'Không có ghi chú.'}</p></div>
                {isCurrentMonth && <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={!salaryPolicy.canSubmit} onClick={() => editAdvance(advance)} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-indigo-50 text-xs font-black text-indigo-700 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-indigo-500/10 dark:text-indigo-200"><Pencil className="h-4 w-4" /> Điều chỉnh</button><button type="button" onClick={() => void cancelAdvance(advance.id)} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-rose-50 text-xs font-black text-rose-700 dark:bg-rose-500/10 dark:text-rose-200"><Trash2 className="h-4 w-4" /> Hủy yêu cầu</button></div>}
              </article>
            ))}
            {!pendingAdvances.length && <div className="rounded-3xl border border-dashed border-slate-300 p-6 text-center text-sm font-semibold text-slate-500 dark:border-slate-700">Chưa có yêu cầu chờ duyệt.</div>}
          </section>

          <section className="mt-8"><div className="mb-3 flex items-center gap-3"><span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" /><span className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Đã xử lý · {processedAdvances.length}</span><span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" /></div><div className="space-y-2.5">
            {processedAdvances.map((advance) => {
              const expanded = expandedProcessedId === advance.id
              return <article key={advance.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"><button type="button" onClick={() => setExpandedProcessedId(expanded ? null : advance.id || null)} aria-expanded={expanded} className="flex min-h-20 w-full items-center gap-3 p-4 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60"><RequestIdentityAvatar name={employeeName} photoURL={employee?.photoURL} icon={CircleDollarSign} iconColor={avatarColor(advance.status)} /><span className="min-w-0 flex-1"><span className="block truncate font-black">{employeeName}</span><span className="mt-0.5 block text-xs font-bold text-slate-500 dark:text-slate-400">Mã nhân viên · {employeeCode}</span></span><span className="flex shrink-0 items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[11px] font-black ring-1 ${statusClasses(advance.status)}`}>{statusLabel(advance.status)}</span><ChevronDown className={`h-5 w-5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} /></span></button>{expanded && <div className="border-t border-slate-100 p-4 dark:border-white/10"><div className="flex items-end justify-between gap-3"><p className="text-xl font-black">{formatAmount(advance.amount)}</p><p className="text-xs font-semibold text-slate-500">Gửi {formatDate(advance.createdAt)} · Xử lý {formatDate(advance.reviewedAt)}</p></div><p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{advance.reason || 'Không có ghi chú.'}</p>{advance.reviewNote && <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-xs font-semibold leading-5 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><span className="font-black">Phản hồi quản lý:</span> {advance.reviewNote}</p>}{advance.status === 'Rejected' && <div className="mt-4 flex items-center gap-2 rounded-2xl bg-rose-50 p-3 text-xs font-bold text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"><RotateCcw className="h-4 w-4" /> Bạn có thể gửi một yêu cầu mới ở biểu mẫu phía trên.</div>}</div>}</article>
            })}
            {!processedAdvances.length && <div className="rounded-3xl border border-dashed border-slate-300 p-6 text-center text-sm font-semibold text-slate-500 dark:border-slate-700">Chưa có yêu cầu đã xử lý.</div>}
          </div></section>
        </div>}
      </PageContainer>

      {bankModalOpen && (
        <div
          className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
          role="presentation"
          onClick={() => !savingBank && setBankModalOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="salary-bank-modal-title"
            className="max-h-[min(700px,92dvh)] w-full max-w-md overflow-y-auto rounded-[2rem] border border-white/80 bg-white p-5 shadow-2xl shadow-slate-950/25 dark:border-white/10 dark:bg-slate-900 sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-lg shadow-sky-500/20">
                <Landmark className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-sky-600 dark:text-sky-300">Cần bổ sung trước khi gửi</p>
                <h2 id="salary-bank-modal-title" className="mt-1 text-xl font-black text-slate-950 dark:text-white">Tài khoản nhận tiền</h2>
                <p className="mt-1 text-sm leading-5 text-slate-500 dark:text-slate-400">Thông tin này sẽ được lưu vào hồ sơ cá nhân của bạn.</p>
              </div>
              <button type="button" onClick={() => setBankModalOpen(false)} disabled={savingBank} aria-label="Đóng" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300">
                <X className="h-5 w-5" />
              </button>
            </div>

            {bankError && <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-semibold leading-5 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">{bankError}</p>}

            <div className="mt-5 space-y-4">
              <label className="block text-sm font-black text-slate-950 dark:text-slate-100">
                Ngân hàng
                <div className="relative mt-2">
                  <Building2 className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-sky-600" />
                  <select value={bankForm.bankName} onChange={(event) => setBankForm((current) => ({ ...current, bankName: event.target.value }))} disabled={savingBank} className="mobile-field !rounded-2xl !border-sky-100 !bg-sky-50/40 !pl-12 !font-semibold focus:!border-sky-400 focus:!ring-sky-200 dark:!border-sky-500/20 dark:!bg-sky-500/5">
                    <option value="">Chọn ngân hàng</option>
                    {BANK_OPTIONS.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
                  </select>
                </div>
              </label>

              <label className="block text-sm font-black text-slate-950 dark:text-slate-100">
                Tên chủ tài khoản
                <div className="relative mt-2">
                  <UserRound className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-sky-600" />
                  <input value={bankForm.bankAccountName} onChange={(event) => setBankForm((current) => ({ ...current, bankAccountName: event.target.value }))} disabled={savingBank} autoCapitalize="characters" placeholder="NGUYỄN VĂN AN" className="mobile-field !rounded-2xl !border-sky-100 !bg-sky-50/40 !pl-12 !font-semibold uppercase focus:!border-sky-400 focus:!ring-sky-200 dark:!border-sky-500/20 dark:!bg-sky-500/5" />
                </div>
              </label>

              <label className="block text-sm font-black text-slate-950 dark:text-slate-100">
                Số tài khoản
                <div className="relative mt-2">
                  <CreditCard className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-sky-600" />
                  <input value={bankForm.bankAccountNumber} onChange={(event) => setBankForm((current) => ({ ...current, bankAccountNumber: event.target.value.replace(/[^\d\s]/g, '') }))} disabled={savingBank} inputMode="numeric" placeholder="Nhập 6–24 chữ số" className="mobile-field !rounded-2xl !border-sky-100 !bg-sky-50/40 !pl-12 !font-semibold tracking-wide focus:!border-sky-400 focus:!ring-sky-200 dark:!border-sky-500/20 dark:!bg-sky-500/5" />
                </div>
              </label>
            </div>

            <div className="mt-5 flex items-start gap-2 rounded-2xl bg-emerald-50 px-3 py-2.5 text-xs font-semibold leading-5 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Sau khi lưu, hệ thống sẽ tự gửi yêu cầu ứng lương đang chờ của bạn.</span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setBankModalOpen(false)} disabled={savingBank} className="min-h-12 rounded-2xl bg-slate-100 px-3 text-sm font-black text-slate-600 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300">Để sau</button>
              <button type="button" onClick={() => void saveBankAndSubmit()} disabled={savingBank || submitting || !salaryPolicy.canSubmit} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-sky-600 to-indigo-600 px-3 text-sm font-black text-white shadow-lg shadow-sky-500/20 transition hover:brightness-105 disabled:opacity-50">
                {savingBank ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {savingBank ? 'Đang lưu...' : 'Lưu và gửi'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
