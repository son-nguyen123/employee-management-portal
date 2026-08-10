'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarDays, CircleDollarSign, Info, Loader2 } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { StaffBanner } from '@/components/staff/staff-banner'
import { useAuth } from '@/lib/hooks/useAuth'
import { subscribeToEmployeePenalties } from '@/lib/services/penaltyService'
import type { Penalty } from '@/lib/models/types'

const previewPenalties: Penalty[] = [
  {
    id: 'preview-1',
    employeeId: 'demo-user-001',
    title: 'Báo đi trễ dưới 1 giờ trước ca',
    description: 'Thông báo đi trễ được gửi dưới 60 phút trước giờ bắt đầu ca.',
    category: 'Late',
    amount: 1000,
    penaltyDate: new Date(),
    createdBy: 'system',
    createdAt: new Date(),
    sourceType: 'lateRequest',
  },
]

export default function PenaltiesPage() {
  const { authUser, isPreviewMode } = useAuth()
  const [penalties, setPenalties] = useState<Penalty[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!authUser) return
    if (isPreviewMode) {
      setPenalties(previewPenalties)
      setLoading(false)
      return
    }
    return subscribeToEmployeePenalties(
      authUser.uid,
      (items) => {
        setPenalties(items)
        setLoading(false)
      },
      () => {
        setMessage('Chưa thể tải các khoản phạt.')
        setLoading(false)
      }
    )
  }, [authUser, isPreviewMode])

  const penaltyAmount = (item: Penalty) => item.status === 'Cancelled' ? 0 : Number(item.amount || 0)
  const total = penalties.reduce((sum, item) => sum + penaltyAmount(item), 0)
  const activeCount = penalties.filter((item) => item.status !== 'Cancelled').length

  return (
    <main className="min-h-screen">
      <Header title="Khoản phạt của tôi" subtitle="Theo dõi lý do và nguồn phát sinh" />
      <PageContainer>
        <StaffBanner icon={AlertTriangle} tone="rose" eyebrow="Khoản phạt" title="Theo dõi rõ từng khoản trừ" description="Kiểm tra lý do, thời điểm và trạng thái của từng khoản phạt trong lịch sử làm việc." note="Khoản đã hủy sẽ không bị khấu trừ. Nếu thấy chưa đúng, hãy liên hệ quản lý để được kiểm tra." />
        <section className="mb-4 grid grid-cols-2 gap-3">
          <div className="rounded-3xl bg-rose-600 p-3 text-white">
            <CircleDollarSign className="h-5 w-5 text-rose-200" />
            <p className="mt-3 text-xs font-semibold text-rose-100">Tổng khấu trừ</p>
            <p className="mt-1 text-lg font-black">{total.toLocaleString('vi-VN')}đ</p>
          </div>
          <div className="mobile-card p-3">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <p className="mt-3 text-xs font-semibold text-muted-foreground">Số lần phát sinh</p>
            <p className="mt-1 text-lg font-black">{activeCount} lần</p>
          </div>
        </section>

        <details className="group mb-4 overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/80 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-bold"><span>Xem quy tắc khấu trừ</span><Info className="h-4 w-4" /></summary>
          <p className="border-t border-amber-200/70 px-4 py-3 text-xs leading-5 dark:border-amber-500/20">Mỗi vi phạm được khấu trừ một khoản cố định vào tiền công của 1 giờ làm: đăng ký lịch trễ 1.000đ, báo đi trễ muộn 500đ.</p>
        </details>

        {message && <p className="mb-4 rounded-2xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{message}</p>}
        {loading ? (
          <div className="grid min-h-48 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>
        ) : (
          <section className="space-y-3">
            {penalties.map((penalty) => {
              const rawDate = penalty.penaltyDate instanceof Date
                ? penalty.penaltyDate
                : penalty.penaltyDate.toDate()
              return (
                <article key={penalty.id} className={`mobile-card p-4 ${penalty.status === 'Cancelled' ? 'opacity-65' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-extrabold">{penalty.title}</h2>
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">{penalty.description}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${penalty.status === 'Cancelled' ? 'bg-slate-100 text-slate-500' : 'bg-rose-50 text-rose-600 dark:bg-rose-500/15'}`}>
                      {penalty.status === 'Cancelled' ? 'Đã hủy' : `${penaltyAmount(penalty).toLocaleString('vi-VN')}đ`}
                    </span>
                  </div>
                  {penalty.adjustmentReason && penalty.status !== 'Cancelled' && (
                    <p className="mt-3 rounded-xl bg-indigo-50 p-3 text-xs font-semibold text-indigo-800">Điều chỉnh: {penalty.adjustmentReason}</p>
                  )}
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs dark:border-white/10">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <CalendarDays className="h-3.5 w-3.5" /> {rawDate.toLocaleDateString('vi-VN')}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold dark:bg-slate-800">
                      {penalty.createdBy === 'system' ? 'Tự động' : 'Quản lý'}
                    </span>
                    <span className={`ml-auto font-semibold ${penalty.status === 'Cancelled' ? 'text-slate-500' : 'text-emerald-600'}`}>
                      {penalty.status === 'Cancelled' ? 'Không khấu trừ' : 'Đã ghi nhận'}
                    </span>
                  </div>
                </article>
              )
            })}
            {!penalties.length && (
              <div className="mobile-card p-8 text-center">
                <CircleDollarSign className="mx-auto h-8 w-8 text-emerald-600" />
                <p className="mt-3 font-bold">Chưa có khoản phạt nào.</p>
              </div>
            )}
          </section>
        )}
      </PageContainer>
    </main>
  )
}
