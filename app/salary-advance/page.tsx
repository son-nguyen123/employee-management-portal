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

    if (!formData.amount || !formData.reason) {
      setMessage({ type: 'error', text: 'Please fill in all fields' })
      return
    }

    const amount = parseFloat(formData.amount)
    if (isNaN(amount) || amount <= 0) {
      setMessage({ type: 'error', text: 'Please enter a valid amount' })
      return
    }

    setSubmitting(true)
    setMessage(null)

    try {
      if (isPreviewMode) {
        setMessage({ type: 'success', text: 'Preview only: salary advance simulated successfully.' })
        setFormData({ amount: '', reason: '' })
        return
      }

      await createSalaryAdvance({
        employeeId: authUser.uid,
        amount,
        reason: formData.reason,
        status: 'Pending',
      })

      setMessage({ type: 'success', text: 'Salary advance request submitted!' })
      setFormData({ amount: '', reason: '' })
      setTimeout(() => router.push('/'), 1500)
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to submit request' })
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading || loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header title="Salary Advance" subtitle="Request a salary advance" />
        <PageContainer>
          <SkeletonLoader variant="card" count={5} />
        </PageContainer>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background pb-24 md:pb-0">
      <Header title="Salary Advance" subtitle="Request a salary advance" />

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

        <Card variant="elevated" className="p-6 mb-8">
          <h2 className="text-xl font-bold mb-6">Request Salary Advance</h2>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="text-sm font-medium mb-2 block">Amount</label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-2.5 w-5 h-5 text-muted-foreground" />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  placeholder="0.00"
                  className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                  disabled={submitting}
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Reason</label>
              <textarea
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                placeholder="Explain why you need this salary advance..."
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
              {submitting ? 'Submitting...' : 'Request Advance'}
            </button>
          </form>
        </Card>

        {previousAdvances.length > 0 && (
          <div>
            <h2 className="text-xl font-bold mb-4">Previous Requests</h2>
            <div className="space-y-3">
              {previousAdvances.map((advance: any, idx: number) => (
                <Card key={idx} variant="default" className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">${advance.amount?.toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground">{advance.reason}</p>
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
                      {advance.status || 'Pending'}
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
