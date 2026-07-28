'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarDays, CircleDollarSign, Info, Loader2 } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { useAuth } from '@/lib/hooks/useAuth'
import { getEmployeePenalties } from '@/lib/services/penaltyService'
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
    void (async () => {
      try {
        setPenalties(isPreviewMode ? previewPenalties : await getEmployeePenalties(authUser.uid))
      } catch {
        setMessage('Chưa thể tải các khoản phạt.')
      } finally {
        setLoading(false)
      }
    })()
  }, [authUser, isPreviewMode])

  const total = penalties.reduce((sum, item) => sum + item.amount, 0)

  return (
    <main className="min-h-screen">
      <Header title="Khoản phạt của tôi" subtitle="Theo dõi lý do và nguồn phát sinh" />
      <PageContainer>
        <section className="mb-4 grid grid-cols-2 gap-3">
          <div className="rounded-3xl bg-rose-600 p-4 text-white">
            <CircleDollarSign className="h-5 w-5 text-rose-200" />
            <p className="mt-5 text-xs font-semibold text-rose-100">Tổng khoản phạt</p>
            <p className="mt-1 text-xl font-black">{total.toLocaleString('vi-VN')} VND</p>
          </div>
          <div className="mobile-card p-4">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <p className="mt-5 text-xs font-semibold text-muted-foreground">Số lần phát sinh</p>
            <p className="mt-1 text-xl font-black">{penalties.length} lần</p>
          </div>
        </section>

        <div className="mb-4 flex gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          Khoản phạt được backend tính theo thời điểm gửi và không thể sửa từ trình duyệt.
        </div>

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
                <article key={penalty.id} className="mobile-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-extrabold">{penalty.title}</h2>
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">{penalty.description}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-rose-50 px-3 py-1 text-xs font-black text-rose-600 dark:bg-rose-500/15">
                      {penalty.amount.toLocaleString('vi-VN')}đ
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs dark:border-white/10">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <CalendarDays className="h-3.5 w-3.5" /> {rawDate.toLocaleDateString('vi-VN')}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold dark:bg-slate-800">
                      {penalty.createdBy === 'system' ? 'Tự động' : 'Quản lý'}
                    </span>
                    <span className="ml-auto font-semibold text-emerald-600">Đã ghi nhận</span>
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
