'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarCheck, Check, UsersRound } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import type { Employee, WorkSchedule } from '@/lib/models/types'
import { getPreviewSchedules } from '@/lib/services/previewWorkflow'
import { subscribeToAllSchedules } from '@/lib/services/scheduleService'
import {
  getWeeklyScheduleTarget,
  updateWeeklyScheduleTarget,
} from '@/lib/services/managementSettingsService'

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function nextMondayKey() {
  const now = new Date()
  const monday = new Date(now)
  monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7))
  monday.setHours(0, 0, 0, 0)
  return localDateKey(monday)
}

function scheduleWeekKey(value: WorkSchedule['date']) {
  const date = value instanceof Date ? new Date(value) : value.toDate()
  const weekday = date.getDay() || 7
  date.setDate(date.getDate() - weekday + 1)
  date.setHours(0, 0, 0, 0)
  return localDateKey(date)
}

export function ManagementOverview({ employees }: { employees: Employee[] }) {
  const { authUser, isPreviewMode } = useAuth()
  const [schedules, setSchedules] = useState<WorkSchedule[]>([])
  const [expectedEmployees, setExpectedEmployees] = useState(0)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!authUser) return
    if (isPreviewMode) {
      setSchedules(getPreviewSchedules().map((item) => ({
        ...item,
        date: new Date(item.date),
        createdAt: new Date(),
        updatedAt: new Date(),
      })))
      return
    }
    const unsubscribe = subscribeToAllSchedules(setSchedules)
    void getWeeklyScheduleTarget(nextMondayKey())
      .then((result) => setExpectedEmployees(result.expectedEmployees))
      .catch(() => setMessage('Chưa tải được mục tiêu gửi lịch tuần này.'))
    return unsubscribe
  }, [authUser, isPreviewMode])

  const activeEmployees = employees.filter((item) => item.status === 'active')
  const nextWeekSchedules = useMemo(
    () => schedules.filter((item) =>
      item.status !== 'Cancelled' && scheduleWeekKey(item.date) === nextMondayKey()
    ),
    [schedules]
  )
  const pending = new Set(nextWeekSchedules
    .filter((item) => ['Pending', 'Registered'].includes(item.status))
    .map((item) => item.employeeId)).size
  const submitted = new Set(nextWeekSchedules.map((item) => item.employeeId)).size
  const target = expectedEmployees || activeEmployees.length

  const save = async () => {
    const value = Math.floor(expectedEmployees)
    if (value < 1) {
      setMessage('Số nhân viên cần gửi lịch phải từ 1 trở lên.')
      return
    }
    setSaving(true)
    try {
      if (!isPreviewMode) {
        const result = await updateWeeklyScheduleTarget(nextMondayKey(), value)
        setExpectedEmployees(result.expectedEmployees)
      }
      setMessage(`Đã lưu mục tiêu ${value} nhân viên.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể lưu mục tiêu tuần.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-label="Tổng quan quản lý">
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Đang hoạt động', value: activeEmployees.length, icon: UsersRound, color: 'bg-indigo-600' },
          { label: 'Bảng chờ', value: pending, icon: CalendarCheck, color: 'bg-amber-500' },
          { label: 'Đã gửi lịch', value: `${submitted}/${target}`, icon: Check, color: 'bg-emerald-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <article key={label} className="mobile-card p-3">
            <div className={`grid h-9 w-9 place-items-center rounded-xl text-white ${color}`}><Icon className="h-4 w-4" /></div>
            <p className="mt-3 text-xl font-black">{value}</p>
            <p className="truncate text-[11px] font-semibold text-muted-foreground">{label}</p>
          </article>
        ))}
      </div>
      <div className="mt-3 flex items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <label className="min-w-0 flex-1 text-xs font-bold text-muted-foreground">
          Số nhân viên cần gửi lịch tuần này
          <input
            type="number"
            min="1"
            inputMode="numeric"
            value={expectedEmployees || ''}
            onChange={(event) => setExpectedEmployees(Math.max(0, Number(event.target.value) || 0))}
            className="mobile-field mt-2"
            placeholder={String(activeEmployees.length)}
          />
        </label>
        <button type="button" disabled={saving} onClick={() => void save()} className="min-h-12 rounded-2xl bg-slate-950 px-5 text-sm font-bold text-white disabled:opacity-60 dark:bg-white dark:text-slate-950">
          {saving ? 'Đang lưu...' : 'Lưu'}
        </button>
      </div>
      {message && <p className="mt-2 rounded-2xl bg-indigo-50 p-3 text-xs font-semibold text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200">{message}</p>}
    </section>
  )
}
