'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'
import { createLateRequest, getEmployeeLateRequests } from '@/lib/services/lateService'
import { mockLateRequests } from '@/lib/services/mockData'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AlertCircle, Loader2 } from 'lucide-react'

const SHIFTS = [
  { value: 'Morning', label: 'Morning (6:00 AM - 2:00 PM)' },
  { value: 'Afternoon', label: 'Afternoon (2:00 PM - 10:00 PM)' },
  { value: 'Evening', label: 'Evening (10:00 PM - 6:00 AM)' },
]

export default function LateArrivalPage() {
  const router = useRouter()
  const { authUser, isPreviewMode } = useAuth()
  const [previousRequests, setPreviousRequests] = useState<any[]>([])
  const [formData, setFormData] = useState({
    shift: 'Morning',
    minutes: '15',
    reason: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!authUser) return
    const load = async () => {
      try {
        const data = isPreviewMode ? mockLateRequests : await getEmployeeLateRequests(authUser.uid)
        setPreviousRequests(data.slice(0, 3))
      } catch (error) {
        console.error('Error:', error)
      }
    }
    load()
  }, [authUser, isPreviewMode])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!authUser) return

    if (!formData.shift || !formData.minutes || !formData.reason) {
      setMessage({ type: 'error', text: 'Please fill in all fields' })
      return
    }

    setSubmitting(true)
    setMessage(null)

    try {
      if (isPreviewMode) {
        setMessage({ type: 'success', text: 'Preview only: late arrival request simulated successfully.' })
        return
      }

      await createLateRequest({
        employeeId: authUser.uid,
        workScheduleId: 'temp-id',
        date: new Date(),
        shift: formData.shift as 'Morning' | 'Afternoon' | 'Evening',
        lateMinutes: parseInt(formData.minutes),
        reason: formData.reason,
        status: 'Pending',
      })

      setMessage({ type: 'success', text: 'Late arrival request submitted!' })
      setTimeout(() => router.push('/'), 1500)
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to submit request' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background pb-24 md:pb-0">
      <Header title="Late Arrival Request" subtitle="Request to arrive late" />

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

        <Card variant="elevated" className="p-6">
          <h2 className="text-xl font-bold mb-6">Request to Arrive Late</h2>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="text-sm font-medium mb-3 block">Select Your Shift</label>
              <select
                value={formData.shift}
                onChange={(e) => setFormData({ ...formData, shift: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                disabled={submitting}
              >
                {SHIFTS.map((shift) => (
                  <option key={shift.value} value={shift.value}>
                    {shift.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium mb-3 block">Late by (minutes)</label>
              <input
                type="number"
                min="5"
                max="120"
                step="5"
                value={formData.minutes}
                onChange={(e) => setFormData({ ...formData, minutes: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                disabled={submitting}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Reason</label>
              <textarea
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                placeholder="Explain why you need to arrive late..."
                rows={3}
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
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </form>
        </Card>

        {previousRequests.length > 0 && (
          <div className="mt-8">
            <h2 className="text-xl font-bold mb-4">Recent Requests</h2>
            <div className="space-y-3">
              {previousRequests.map((request: any, idx: number) => (
                <Card key={idx} variant="default" className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{request.shift} - {request.lateMinutes} minutes</p>
                      <p className="text-xs text-muted-foreground">{request.reason}</p>
                    </div>
                    <Badge
                      variant={
                        request.status === 'Approved'
                          ? 'success'
                          : request.status === 'Pending'
                            ? 'warning'
                            : 'destructive'
                      }
                      size="sm"
                    >
                      {request.status || 'Pending'}
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
