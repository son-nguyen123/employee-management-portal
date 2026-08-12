'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarDays, CircleDollarSign, Loader2 } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { useAuth } from '@/lib/hooks/useAuth'
import { MonthNavigator } from '@/components/ui/month-navigator'
import { readPenaltyMonth } from '@/lib/services/monthDataService'
import type { Penalty } from '@/lib/models/types'
import { currentVietnamMonth } from '@/lib/archive/retention'

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
  const [month, setMonth] = useState(currentVietnamMonth(new Date()).key)

  useEffect(() => {
    if (!authUser) return
    if (isPreviewMode) {
      setPenalties(previewPenalties)
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    setMessage('')
    void readPenaltyMonth(month)
      .then((result) => { if (active) setPenalties(result.records) })
      .catch(() => { if (active) setMessage('Chưa thể tải các khoản phạt của tháng này.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [authUser, isPreviewMode, month])

  const penaltyAmount = (item: Penalty) => item.status === 'Cancelled' ? 0 : Number(item.amount || 0)
  const total = penalties.reduce((sum, item) => sum + penaltyAmount(item), 0)
  const activeCount = penalties.filter((item) => item.status !== 'Cancelled').length

  return (
    <main className="min-h-screen">
      <Header title="Khoản phạt" subtitle="Các khoản đã ghi nhận trong tháng" />
      <PageContainer>
        <MonthNavigator value={month} onChange={setMonth} loading={loading} />
        <section className="mb-4 rounded-3xl bg-gradient-to-r from-rose-600 to-fuchsia-700 p-4 text-white shadow-lg shadow-rose-950/10">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/15"><AlertTriangle className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-wider text-rose-100">Tổng khoản phạt</p>
              <p className="mt-0.5 text-xl font-black">{total.toLocaleString('vi-VN')}đ <span className="text-sm font-bold text-rose-100">· {activeCount} lần</span></p>
            </div>
          </div>
          <p className="mt-3 border-t border-white/20 pt-3 text-xs leading-5 text-rose-50">Lịch trễ 1.000đ; báo đi trễ muộn 500đ. Khoản đã hủy không bị trừ.</p>
        </section>

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
