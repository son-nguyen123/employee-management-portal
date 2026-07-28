'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'
import { createSalaryAdvance, getEmployeeSalaryAdvances } from '@/lib/services/salaryService'
import { mockSalaryAdvances } from '@/lib/services/mockData'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SkeletonLoader } from '@/components/ui/skeleton-loader'
import { AlertCircle, Loader2, DollarSign } from 'lucide-react'

export default function SalaryAdvancePage() {
  const router = useRouter()
  const { authUser, isLoading, isPreviewMode } = useAuth()
  const [loading, setLoading] = useState(true)
  const [previousAdvances, setPreviousAdvances] = useState<any[]>([])
  const [formData, setFormData] = useState({
    amount: '',
    reason: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!authUser) return

    const load = async () => {
      try {
        const data = isPreviewMode ? mockSalaryAdvances : await getEmployeeSalaryAdvances(authUser.uid)
        setPreviousAdvances(data.slice(0, 5))
      } catch (error) {
        console.error('Error:', error)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [authUser, isPreviewMode])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!authUser) return

    if (!formData.amount) {
      setMessage({ type: 'error', text: 'Vui lòng nhập số tiền muốn ứng' })
      return
    }

    const amount = parseFloat(formData.amount)
    if (isNaN(amount) || amount <= 0) {
      setMessage({ type: 'error', text: 'Số tiền chưa hợp lệ' })
      return
    }

    setSubmitting(true)
    setMessage(null)

    try {
      if (isPreviewMode) {
        setMessage({ type: 'success', text: 'Đã gửi yêu cầu ứng lương trong chế độ xem thử.' })
        setFormData({ amount: '', reason: '' })
        return
      }

      await createSalaryAdvance({
        employeeId: authUser.uid,
        amount,
        reason: formData.reason.trim(),
        status: 'Pending',
      })

      setMessage({ type: 'success', text: 'Đã gửi yêu cầu ứng lương!' })
      setFormData({ amount: '', reason: '' })
      setTimeout(() => router.push('/'), 1500)
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Không thể gửi yêu cầu',
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading || loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header title="Ứng lương" subtitle="Gửi yêu cầu trong tháng hiện tại" />
        <PageContainer>
          <SkeletonLoader variant="card" count={5} />
        </PageContainer>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background pb-24 md:pb-0">
      <Header title="Ứng lương" subtitle="Gửi yêu cầu trong tháng hiện tại" />

      <PageContainer>
        {message && (
          <div
            className={`mb-6 p-4 rounded-lg border flex items-gap-2 ${
              message.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-300'
                : 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300'
            }`}
          >
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <p className="text-sm">{message.text}</p>
          </div>
        )}

        <Card variant="elevated" className="mb-8 rounded-3xl p-4 sm:p-6">
          <h2 className="text-xl font-bold mb-6">Tạo yêu cầu ứng lương</h2>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="text-sm font-medium mb-2 block">Số tiền muốn ứng</label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-2.5 w-5 h-5 text-muted-foreground" />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  placeholder="Ví dụ: 2.000.000"
                  className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                  disabled={submitting}
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">
                Ghi chú <span className="font-normal text-muted-foreground">(không bắt buộc)</span>
              </label>
              <textarea
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                placeholder="Bạn có thể ghi thêm để quản lý dễ xem xét..."
                rows={4}
                className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors resize-none"
                disabled={submitting}
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2 px-4 rounded-lg bg-primary text-primary-foreground font-medium transition-all duration-200 hover:shadow-lg hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? 'Đang gửi...' : 'Gửi yêu cầu'}
            </button>
          </form>
        </Card>

        {previousAdvances.length > 0 && (
          <div>
            <h2 className="text-xl font-bold mb-4">Yêu cầu trước đây</h2>
            <div className="space-y-3">
              {previousAdvances.map((advance: any, idx: number) => (
                <Card key={idx} variant="default" className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{Number(advance.amount || 0).toLocaleString('vi-VN')} VND</p>
                      <p className="text-xs text-muted-foreground">{advance.reason || 'Không có ghi chú'}</p>
                    </div>
                    <Badge
                      variant={
                        advance.status === 'Approved'
                          ? 'success'
                          : advance.status === 'Rejected'
                            ? 'destructive'
                            : 'warning'
                      }
                      size="sm"
                    >
                      {advance.status === 'Approved' ? 'Đã duyệt' : advance.status === 'Rejected' ? 'Từ chối' : 'Chờ duyệt'}
                    </Badge>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </PageContainer>
    </div>
  )
}
