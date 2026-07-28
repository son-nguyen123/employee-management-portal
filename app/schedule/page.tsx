'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'
import { createWorkSchedule, getEmployeeSchedules } from '@/lib/services/scheduleService'
import { mockSchedules } from '@/lib/services/mockData'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SkeletonLoader } from '@/components/ui/skeleton-loader'
import { EmptyState } from '@/components/ui/empty-state'
import { Calendar, Check, X, Clock } from 'lucide-react'

interface ScheduleDay {
  day: string
  date: Date
  shift: 'Morning' | 'Afternoon' | 'Evening' | ''
  isSelected: boolean
  status?: 'Approved' | 'Rejected' | 'Pending'
}

export default function SchedulePage() {
  const router = useRouter()
  const { authUser, isLoading, isPreviewMode } = useAuth()
  const [loading, setLoading] = useState(true)
  const [schedules, setSchedules] = useState<ScheduleDay[]>([])
  const [selectedDays, setSelectedDays] = useState<{ [key: string]: string }>({})
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Initialize week starting Monday
  useEffect(() => {
    const today = new Date()
    const monday = new Date(today)
    monday.setDate(today.getDate() - today.getDay() + 1)

    const weekDays: ScheduleDay[] = []
    for (let i = 0; i < 7; i++) {
      const date = new Date(monday)
      date.setDate(monday.getDate() + i)
      weekDays.push({
        day: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i],
        date,
        shift: '',
        isSelected: false,
      })
    }
    setSchedules(weekDays)
  }, [])

  // Load existing schedules from Firebase or mock data
  useEffect(() => {
    if (!authUser) return

    const loadSchedules = async () => {
      try {
        setLoading(true)
        let employeeSchedules = isPreviewMode ? mockSchedules : await getEmployeeSchedules(authUser.uid)

        // Map Firebase data to UI
        const scheduleMap: { [key: string]: ScheduleDay } = {}
        schedules.forEach((day) => {
          scheduleMap[day.day] = day
        })

        employeeSchedules.forEach((schedule: any) => {
          const scheduleDate = schedule.date instanceof Date ? schedule.date : schedule.date.toDate()
          const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
            scheduleDate.getDay()
          ]

          if (scheduleMap[dayName]) {
            scheduleMap[dayName].shift = schedule.shift
            scheduleMap[dayName].status = schedule.status
            scheduleMap[dayName].isSelected = true
            setSelectedDays((prev) => ({ ...prev, [dayName]: schedule.shift }))
          }
        })

        setSchedules(Object.values(scheduleMap))
      } catch (error) {
        console.error('Error loading schedules:', error)
        setMessage({ type: 'error', text: 'Failed to load schedules' })
      } finally {
        setLoading(false)
      }
    }

    loadSchedules()
  }, [authUser, isPreviewMode])

  const shifts = ['Morning', 'Afternoon', 'Evening'] as const

  const toggleShift = (day: string, shift: string) => {
    setSelectedDays((prev) => ({
      ...prev,
      [day]: prev[day] === shift ? '' : shift,
    }))
  }

  const handleSubmit = async () => {
    if (!authUser) return

    setSubmitting(true)
    setMessage(null)

    try {
      if (isPreviewMode) {
        setMessage({ type: 'success', text: 'Preview only: schedule simulated successfully.' })
        setTimeout(() => router.push('/'), 800)
        return
      }

      // Submit all selected shifts
      const promises = Object.entries(selectedDays).map(async ([dayName, shift]) => {
        if (shift) {
          const schedule = schedules.find((s) => s.day === dayName)
          if (schedule) {
            await createWorkSchedule({
              employeeId: authUser.uid,
              date: schedule.date,
              shift: shift as 'Morning' | 'Afternoon' | 'Evening',
              status: 'Registered',
              note: '',
            })
          }
        }
      })

      await Promise.all(promises)
      setMessage({ type: 'success', text: 'Schedule submitted successfully!' })

      setTimeout(() => router.push('/'), 1500)
    } catch (error) {
      console.error('Error submitting schedule:', error)
      setMessage({ type: 'error', text: 'Failed to submit schedule' })
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading || loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header title="Work Schedule" subtitle="Select your preferred shifts" />
        <PageContainer>
          <SkeletonLoader variant="card" count={7} />
        </PageContainer>
      </div>
    )
  }

  const hasSelected = Object.values(selectedDays).some((shift) => shift)

  return (
    <div className="min-h-screen bg-background pb-24 md:pb-0">
      <Header title="Work Schedule" subtitle="Select your preferred shifts" />

      <PageContainer>
        {/* Message */}
        {message && (
          <div
            className={`mb-6 p-4 rounded-lg border ${
              message.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-300'
                : 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Schedule Grid */}
        <div className="space-y-4">
          {schedules.map((schedule) => (
            <Card key={schedule.day} variant="elevated" className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-lg">{schedule.day}</h3>
                  <p className="text-sm text-muted-foreground">
                    {schedule.date.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                </div>
                {schedule.status && (
                  <Badge
                    variant={
                      schedule.status === 'Approved'
                        ? 'success'
                        : schedule.status === 'Rejected'
                          ? 'destructive'
                          : 'warning'
                    }
                    size="sm"
                  >
                    {schedule.status}
                  </Badge>
                )}
              </div>

              {/* Shift Buttons */}
              <div className="flex gap-2 flex-wrap">
                {shifts.map((shift) => (
                  <button
                    key={shift}
                    onClick={() => toggleShift(schedule.day, shift)}
                    disabled={schedule.status === 'Approved'}
                    className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                      selectedDays[schedule.day] === shift
                        ? 'bg-primary text-primary-foreground scale-105'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <Clock className="w-4 h-4 inline mr-2" />
                    {shift}
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </div>

        {/* Summary */}
        {hasSelected && (
          <Card variant="elevated" className="mt-8 p-6 bg-primary/5">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">
                  {Object.values(selectedDays).filter((s) => s).length} shifts selected
                </p>
                <p className="text-sm text-muted-foreground">Ready to submit your schedule</p>
              </div>
              <button
                onClick={handleSubmit}
                disabled={submitting || !hasSelected}
                className="px-6 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:shadow-lg hover:scale-105 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {submitting ? 'Submitting...' : 'Submit Schedule'}
              </button>
            </div>
          </Card>
        )}

        {!hasSelected && (
          <EmptyState
            icon="📅"
            title="No shifts selected"
            description="Select shifts for the days you want to work"
            className="mt-8"
          />
        )}
      </PageContainer>
    </div>
  )
}
