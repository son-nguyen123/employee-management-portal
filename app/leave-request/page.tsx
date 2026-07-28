'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'
import { createLeaveRequest, getEmployeeLeaves } from '@/lib/services/leaveService'
import { mockLeaveRequests } from '@/lib/services/mockData'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SkeletonLoader } from '@/components/ui/skeleton-loader'
import { EmptyState } from '@/components/ui/empty-state'
import { Calendar, AlertCircle, Loader2 } from 'lucide-react'

type LeaveType = 'sick' | 'casual' | 'earned' | 'personal'

interface LeaveRequestData {
  type: LeaveType
  startDate: string
  endDate: string
  reason: string
}

const LEAVE_TYPES: { value: LeaveType; label: string; color: string }[] = [
  { value: 'sick', label: 'Sick Leave', color: 'from-red-500 to-red-600' },
  { value: 'casual', label: 'Casual Leave', color: 'from-blue-500 to-blue-600' },
  { value: 'earned', label: 'Earned Leave', color: 'from-green-500 to-green-600' },
  { value: 'personal', label: 'Personal Leave', color: 'from-purple-500 to-purple-600' },
]

export default function LeaveRequestPage() {
  const router = useRouter()
  const { authUser, isLoading, isPreviewMode } = useAuth()
  const [loading, setLoading] = useState(true)
  const [previousRequests, setPreviousRequests] = useState<any[]>([])
  const [formData, setFormData] = useState<LeaveRequestData>({
    type: 'casual',
    startDate: '',
    endDate: '',
    reason: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Load previous leave requests
  useEffect(() => {
    if (!authUser) return

    const loadRequests = async () => {
      try {
        const requests = isPreviewMode ? mockLeaveRequests : await getEmployeeLeaves(authUser.uid)
        setPreviousRequests(requests.slice(0, 5)) // Show last 5
      } catch (error) {
        console.error('Error loading requests:', error)
      } finally {
        setLoading(false)
      }
    }

    loadRequests()
  }, [authUser, isPreviewMode])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!authUser) return

    // Validation
    if (!formData.type || !formData.startDate || !formData.endDate || !formData.reason) {
      setMessage({ type: 'error', text: 'Please fill in all fields' })
      return
    }

    if (new Date(formData.startDate) > new Date(formData.endDate)) {
      setMessage({ type: 'error', text: 'End date must be after start date' })
      return
    }

    setSubmitting(true)
    setMessage(null)

    try {
      if (isPreviewMode) {
        setMessage({ type: 'success', text: 'Preview only: leave request simulated successfully.' })
        setFormData({ type: 'casual', startDate: '', endDate: '', reason: '' })
        return
      }

      await createLeaveRequest({
        employeeId: authUser.uid,
        leaveDate: new Date(formData.startDate),
        leaveType: formData.type,
        reason: formData.reason,
        status: 'Pending',
      })

      setMessage({ type: 'success', text: 'Leave request submitted successfully!' })
      setFormData({ type: 'casual', startDate: '', endDate: '', reason: '' })

      setTimeout(() => router.push('/'), 1500)
    } catch (error) {
      console.error('Error submitting request:', error)
      setMessage({ type: 'error', text: 'Failed to submit request' })
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading || loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header title="Leave Request" subtitle="Submit a leave application" />
        <PageContainer>
          <SkeletonLoader variant="card" count={5} />
        </PageContainer>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background pb-24 md:pb-0">
      <Header title="Leave Request" subtitle="Submit a leave application" />

      <PageContainer>
        {/* Message */}
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

        {/* Form */}
        <Card variant="elevated" className="p-6 mb-8">
          <h2 className="text-xl font-bold mb-6">Submit New Leave Request</h2>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Leave Type */}
            <div>
              <label className="text-sm font-medium mb-3 block">Type of Leave</label>
              <div className="grid grid-cols-2 gap-2">
                {LEAVE_TYPES.map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, type: type.value })}
                    className={`p-3 rounded-lg border-2 transition-all duration-200 text-sm font-medium ${
                      formData.type === type.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-primary/50 text-muted-foreground'
                    }`}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="startDate" className="text-sm font-medium mb-2 block">
                  Start Date
                </label>
                <input
                  id="startDate"
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-border bg-background hover:border-border/80 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                  required
                  disabled={submitting}
                />
              </div>
              <div>
                <label htmlFor="endDate" className="text-sm font-medium mb-2 block">
                  End Date
                </label>
                <input
                  id="endDate"
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-border bg-background hover:border-border/80 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                  required
                  disabled={submitting}
                />
              </div>
            </div>

            {/* Reason */}
            <div>
              <label htmlFor="reason" className="text-sm font-medium mb-2 block">
                Reason for Leave
              </label>
              <textarea
                id="reason"
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                placeholder="Please provide a reason for your leave request..."
                rows={4}
                className="w-full px-4 py-2 rounded-lg border border-border bg-background hover:border-border/80 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors resize-none"
                required
                disabled={submitting}
              />
            </div>

            {/* Submit Button */}
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

        {/* Previous Requests */}
        {previousRequests.length > 0 && (
          <div>
            <h2 className="text-xl font-bold mb-4">Recent Requests</h2>
            <div className="space-y-3">
              {previousRequests.map((request: any, idx: number) => (
                <Card key={idx} variant="default" className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{request.type?.toUpperCase() || 'Leave'}</p>
                      <p className="text-xs text-muted-foreground">
                        {request.startDate instanceof Date
                          ? request.startDate.toLocaleDateString()
                          : new Date(request.startDate).toLocaleDateString()}{' '}
                        -{' '}
                        {request.endDate instanceof Date
                          ? request.endDate.toLocaleDateString()
                          : new Date(request.endDate).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge
                      variant={
                        request.status === 'Approved'
                          ? 'success'
                          : request.status === 'Rejected'
                            ? 'destructive'
                            : 'warning'
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

        {previousRequests.length === 0 && !message && (
          <EmptyState
            icon="📋"
            title="No previous requests"
            description="Your leave request history will appear here"
            className="mt-8"
          />
        )}
      </PageContainer>
    </div>
  )
}
