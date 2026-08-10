'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ChevronDown, CircleDollarSign, DollarSign, Loader2, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import { cancelSalaryAdvance, createSalaryAdvance, reviseSalaryAdvance, subscribeToEmployeeSalaryAdvances } from '@/lib/services/salaryService'
import { mockSalaryAdvances } from '@/lib/services/mockData'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { StaffBanner } from '@/components/staff/staff-banner'
import { Card } from '@/components/ui/card'
import { RequestIdentityAvatar } from '@/components/admin/request-identity-avatar'
import { SkeletonLoader } from '@/components/ui/skeleton-loader'
import type { SalaryAdvance } from '@/lib/models/types'

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

export default function SalaryAdvancePage() {
  const { authUser, employee, isLoading, isPreviewMode } = useAuth()
  const [loading, setLoading] = useState(true)
  const [previousAdvances, setPreviousAdvances] = useState<SalaryAdvance[]>([])
  const [formData, setFormData] = useState({ amount: '', reason: '' })
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedProcessedId, setExpandedProcessedId] = useState<string | null>(null)

  useEffect(() => {
    if (!authUser) return

    if (isPreviewMode) {
      setPreviousAdvances(mockSalaryAdvances as SalaryAdvance[])
      setLoading(false)
      return
    }

    return subscribeToEmployeeSalaryAdvances(
      authUser.uid,
      (data) => {
        setPreviousAdvances(data)
        setLoading(false)
      },
      (error) => {
        console.error('Error:', error)
        setLoading(false)
      }
    )
  }, [authUser, isPreviewMode])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!authUser) return

    if (!formData.amount) {
      setMessage({ type: 'error', text: 'Vui lòng nhập số tiền muốn ứng.' })
      return
    }

    const amount = Number(formData.amount.replace(/\D/g, ''))
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setMessage({ type: 'error', text: 'Số tiền chưa hợp lệ.' })
      return
    }

    setSubmitting(true)
    setMessage(null)

    try {
      if (isPreviewMode) {
        const id = editingId || `preview-salary-${Date.now()}`
        setPreviousAdvances((prev) => editingId
          ? prev.map((item) => item.id === editingId ? { ...item, amount, reason: formData.reason.trim(), status: 'Pending' } : item)
          : [{ id, employeeId: authUser.uid, amount, reason: formData.reason.trim(), status: 'Pending', createdAt: new Date(), updatedAt: new Date() }, ...prev])
        setMessage({ type: 'success', text: editingId ? 'Đã gửi bản điều chỉnh trong chế độ xem thử.' : 'Đã gửi yêu cầu ứng lương trong chế độ xem thử.' })
        setEditingId(null)
        setFormData({ amount: '', reason: '' })
        return
      }

      const id = editingId || await createSalaryAdvance({
        employeeId: authUser.uid,
        amount,
        reason: formData.reason.trim(),
        status: 'Pending',
      })
      if (editingId) await reviseSalaryAdvance(editingId, amount, formData.reason.trim())

      setPreviousAdvances((prev) => editingId
        ? prev.map((item) => item.id === editingId ? { ...item, amount, reason: formData.reason.trim(), status: 'Pending' } : item)
        : [{ id, employeeId: authUser.uid, amount, reason: formData.reason.trim(), status: 'Pending', createdAt: new Date(), updatedAt: new Date() }, ...prev])
      setMessage({ type: 'success', text: editingId ? 'Đã gửi bản điều chỉnh cho quản lý.' : 'Đã gửi yêu cầu ứng lương!' })
      setEditingId(null)
      setFormData({ amount: '', reason: '' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Không thể gửi yêu cầu.' })
    } finally {
      setSubmitting(false)
    }
  }

  const editAdvance = (advance: SalaryAdvance) => {
    if (advance.status !== 'Pending' || !advance.id) return
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
  const hasPendingRequest = pendingAdvances.length > 0
  const employeeName = employee?.fullName || authUser?.displayName || 'Nhân viên'
  const employeeCode = employee?.employeeCode || 'Chưa có mã'

  if (isLoading || loading) {
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
        <StaffBanner icon={DollarSign} tone="sky" eyebrow="Ứng lương" title="Bạn cần hỗ trợ khoản nào?" description="Nhập số tiền muốn ứng và ghi chú ngắn để quản lý xem xét nhanh hơn." note="Bạn chỉ có thể điều chỉnh khi yêu cầu còn chờ duyệt. Sau khi quản lý xác nhận, yêu cầu sẽ được khóa để giữ đúng lịch sử." action={<Link href="/staff-note" className="rounded-xl bg-white/15 px-3 py-2 text-xs font-extrabold text-white backdrop-blur">Gửi yêu cầu khác</Link>} />
        {message && <div className={`mb-6 flex items-start gap-2 rounded-2xl border p-4 ${message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300' : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300'}`}><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><p className="text-sm font-semibold">{message.text}</p></div>}

        {(!hasPendingRequest || editingId) && <Card variant="elevated" className="mb-8 rounded-3xl border-sky-100 p-4 shadow-[0_14px_35px_-28px_rgba(14,116,144,0.8)] dark:border-sky-500/20 sm:p-6">
          <div className="mb-5 flex items-center gap-3"><RequestIdentityAvatar name={employeeName} photoURL={employee?.photoURL} icon={CircleDollarSign} iconColor="bg-sky-500" /><div><p className="text-xs font-black uppercase tracking-wider text-sky-600">Yêu cầu mới</p><h2 className="text-xl font-black">Tạo yêu cầu ứng lương</h2><p className="text-xs font-semibold text-muted-foreground">Mã nhân viên · {employeeCode}</p></div></div>
          <form onSubmit={handleSubmit} className="space-y-5">
            <label className="block text-sm font-bold">Số tiền muốn ứng
              <div className="relative mt-2"><DollarSign className="absolute left-4 top-4 h-5 w-5 text-sky-500" /><input type="text" inputMode="numeric" value={formData.amount} onChange={(event) => setFormData({ ...formData, amount: formatVietnameseCurrency(event.target.value) })} placeholder="Ví dụ: 2.000.000" className="mobile-field pl-11" disabled={submitting} /></div>
            </label>
            <label className="block text-sm font-bold">Ghi chú <span className="font-normal text-muted-foreground">(không bắt buộc)</span>
              <textarea value={formData.reason} onChange={(event) => setFormData({ ...formData, reason: event.target.value })} placeholder="Bạn có thể ghi thêm để quản lý dễ xem xét..." rows={4} className="mobile-field mt-2 resize-none py-3" disabled={submitting} />
            </label>
            <button type="submit" disabled={submitting} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-sky-600 px-4 font-black text-white shadow-lg shadow-sky-500/20 transition active:scale-[0.99] disabled:opacity-50">{submitting && <Loader2 className="h-4 w-4 animate-spin" />}{submitting ? 'Đang gửi...' : editingId ? 'Gửi điều chỉnh' : 'Gửi yêu cầu'}</button>
          </form>
        </Card>}

        {previousAdvances.length > 0 && <div>
          <div className="mb-3 flex items-center gap-3"><span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" /><span className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Lịch sử ứng lương</span><span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" /></div>
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wider text-sky-600">Cần chờ quản lý</p><h2 className="text-xl font-black">Chưa xử lý</h2></div><span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-black text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">{pendingAdvances.length}</span></div>
            {pendingAdvances.map((advance) => (
              <article key={advance.id} className="overflow-hidden rounded-3xl border border-sky-100 bg-white p-4 shadow-sm dark:border-sky-500/20 dark:bg-slate-900">
                <div className="flex items-start gap-3"><RequestIdentityAvatar name={employeeName} photoURL={employee?.photoURL} icon={CircleDollarSign} iconColor="bg-sky-500" /><div className="min-w-0 flex-1"><h3 className="truncate font-black">{employeeName}</h3><p className="text-xs font-bold text-slate-500 dark:text-slate-400">Mã nhân viên · {employeeCode}</p></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-black ring-1 ${statusClasses(advance.status)}`}>{statusLabel(advance.status)}</span></div>
                <div className="mt-4 rounded-2xl bg-sky-50/80 p-3 dark:bg-sky-500/10"><div className="flex items-end justify-between gap-3"><p className="text-2xl font-black text-sky-700 dark:text-sky-300">{formatAmount(advance.amount)}</p><p className="text-xs font-semibold text-slate-500">Gửi {formatDate(advance.createdAt)}</p></div><p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">{advance.reason || 'Không có ghi chú.'}</p></div>
                <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => editAdvance(advance)} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-indigo-50 text-xs font-black text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-200"><Pencil className="h-4 w-4" /> Điều chỉnh</button><button type="button" onClick={() => void cancelAdvance(advance.id)} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-rose-50 text-xs font-black text-rose-700 dark:bg-rose-500/10 dark:text-rose-200"><Trash2 className="h-4 w-4" /> Hủy yêu cầu</button></div>
              </article>
            ))}
            {!pendingAdvances.length && <div className="rounded-3xl border border-dashed border-slate-300 p-6 text-center text-sm font-semibold text-slate-500 dark:border-slate-700">Không có yêu cầu đang chờ.</div>}
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
    </div>
  )
}
