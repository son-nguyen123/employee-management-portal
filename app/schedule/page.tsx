'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, Check, Clock3, Loader2, Save, Send, SlidersHorizontal, X } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import { submitWorkSchedules } from '@/lib/services/scheduleService'
import { addPreviewSchedules } from '@/lib/services/previewWorkflow'
import { Header } from '@/components/layout/header'
import { Badge } from '@/components/ui/badge'

type Shift = 'Morning' | 'Afternoon' | 'Evening' | 'Custom'
type DayItem = { key: string; name: string; shortName: string; date: Date }
type CustomShift = { start: string; end: string; note: string; request: string }

const shiftOptions: { value: Shift; label: string; time: string }[] = [
  { value: 'Morning', label: 'Ca sáng', time: '06:00–14:00' },
  { value: 'Afternoon', label: 'Ca chiều', time: '14:00–22:00' },
  { value: 'Evening', label: 'Ca tối', time: '22:00–06:00' },
  { value: 'Custom', label: 'Tùy chỉnh', time: 'Tự chọn giờ' },
]

export default function SchedulePage() {
  const router = useRouter()
  const { authUser, isPreviewMode } = useAuth()
  const [selected, setSelected] = useState<Record<string, Shift[]>>({})
  const [customFor, setCustomFor] = useState<string | null>(null)
  const [customData, setCustomData] = useState<Record<string, CustomShift>>({})
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const days = useMemo<DayItem[]>(() => {
    const now = new Date()
    const currentDay = now.getDay()
    const daysUntilNextMonday = ((8 - currentDay) % 7) || 7
    const monday = new Date(now)
    monday.setHours(0, 0, 0, 0)
    monday.setDate(now.getDate() + daysUntilNextMonday)
    const names = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật']
    const shortNames = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
    return names.map((name, index) => {
      const date = new Date(monday)
      date.setDate(monday.getDate() + index)
      return { key: date.toISOString().slice(0, 10), name, shortName: shortNames[index], date }
    })
  }, [])

  useEffect(() => {
    const savedDraft = window.sessionStorage.getItem('schedule-draft')
    if (savedDraft) {
      const parsed = JSON.parse(savedDraft) as Record<string, Shift[] | Shift>
      setSelected(Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, Array.isArray(value) ? value : [value]])
      ))
    }
  }, [])

  const chooseShift = (dayKey: string, shift: Shift) => {
    if (shift === 'Custom') {
      setCustomFor(dayKey)
      setCustomData((prev) => ({
        ...prev,
        [dayKey]: prev[dayKey] || { start: '08:00', end: '17:00', note: '', request: '' },
      }))
      return
    }
    setSelected((prev) => {
      const current = prev[dayKey] || []
      const nextShifts = current.includes(shift)
        ? current.filter((item) => item !== shift)
        : [...current, shift]
      const next = { ...prev }
      if (nextShifts.length) next[dayKey] = nextShifts
      else delete next[dayKey]
      return next
    })
  }

  const saveCustom = () => {
    if (!customFor) return
    const item = customData[customFor]
    if (!item?.start || !item?.end) return
    setSelected((prev) => ({
      ...prev,
      [customFor]: Array.from(new Set([...(prev[customFor] || []), 'Custom' as Shift])),
    }))
    setCustomFor(null)
  }

  const saveDraft = () => {
    window.sessionStorage.setItem('schedule-draft', JSON.stringify(selected))
    setMessage('Đã lưu bản nháp trên thiết bị này.')
  }

  const submitSchedule = async () => {
    if (!authUser || !Object.keys(selected).length) return
    if (!window.confirm('Bạn có chắc muốn gửi lịch này cho quản lý không?')) return
    setSubmitting(true)
    setMessage(null)
    try {
      if (isPreviewMode) {
        addPreviewSchedules(Object.entries(selected).flatMap(([dayKey, shifts]) =>
          shifts.map((shift, index) => {
            const custom = customData[dayKey]
            return {
              id: `preview-${Date.now()}-${dayKey}-${index}`,
              employeeId: authUser.uid,
              employeeName: authUser.displayName || 'Nguyễn Minh An',
              employeeCode: 'NV-001',
              phone: '0901 234 567',
              facebookUrl: 'https://facebook.com/',
              date: new Date(`${dayKey}T12:00:00`).toISOString(),
              shift: (shift === 'Custom' ? 'Morning' : shift) as 'Morning' | 'Afternoon' | 'Evening',
              status: 'Pending' as const,
              note: shift === 'Custom'
                ? `Tùy chỉnh ${custom?.start}–${custom?.end}. ${custom?.note || ''} ${custom?.request || ''}`.trim()
                : '',
            }
          })
        ))
      } else {
        await submitWorkSchedules(Object.entries(selected).flatMap(([dayKey, shifts]) =>
          shifts.map((shift) => {
            const custom = customData[dayKey]
            return {
              employeeId: authUser.uid,
              date: new Date(`${dayKey}T12:00:00`),
              shift: shift === 'Custom' ? 'Morning' : shift,
              status: 'Pending',
              note: shift === 'Custom'
                ? `Tùy chỉnh ${custom?.start}–${custom?.end}. ${custom?.note || ''} ${custom?.request || ''}`.trim()
                : '',
            }
          })
        ))
      }
      window.sessionStorage.removeItem('schedule-draft')
      setMessage('Đã gửi lịch. Lịch đang chờ quản lý xác nhận.')
      setTimeout(() => router.push('/'), 1200)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể gửi lịch. Vui lòng thử lại.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setSubmitting(false)
    }
  }

  const customDay = days.find((day) => day.key === customFor)
  const selectedCount = Object.values(selected).reduce((total, shifts) => total + shifts.length, 0)

  return (
    <main className="min-h-screen pb-32">
      <Header title="Đăng ký lịch làm" subtitle="Tuần kế tiếp · Thứ Hai đến Chủ Nhật" />
      <div className="mx-auto max-w-2xl px-3 py-4 sm:px-6">
        <section className="mb-4 rounded-3xl bg-slate-950 p-5 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-indigo-300">Lịch tuần sau</p>
              <h2 className="mt-1 text-xl font-extrabold">
                {days[0].date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}
                {' – '}
                {days[6].date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}
              </h2>
              <p className="mt-1 text-xs text-slate-300">Bạn có thể chọn một hoặc nhiều ca trong cùng ngày.</p>
            </div>
            <div className="rounded-2xl bg-white/10 px-3 py-2 text-center">
              <span className="block text-xl font-black">{selectedCount}</span>
              <span className="text-[10px] uppercase tracking-wider text-slate-300">ca đã chọn</span>
            </div>
          </div>
        </section>

        {message && (
          <div className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-3 text-sm font-medium text-indigo-800">
            {message}
          </div>
        )}

        <div className="space-y-3">
          {days.map((day) => (
            <article key={day.key} className="mobile-card overflow-hidden p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-50 font-black text-indigo-600 dark:bg-indigo-500/15">
                    {day.shortName}
                  </div>
                  <div>
                    <h3 className="font-extrabold">{day.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {day.date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </p>
                  </div>
                </div>
                {!!selected[day.key]?.length && <Badge variant="success">{selected[day.key].length} ca</Badge>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {shiftOptions.map((shift) => {
                  const active = selected[day.key]?.includes(shift.value)
                  return (
                    <button
                      key={shift.value}
                      type="button"
                      onClick={() => chooseShift(day.key, shift.value)}
                      className={`min-h-[58px] rounded-2xl border px-3 text-left transition active:scale-[0.98] ${
                        active
                          ? 'border-indigo-600 bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                          : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800'
                      }`}
                    >
                      <span className="flex items-center justify-between text-sm font-bold">
                        {shift.label}
                        {active && <Check className="h-4 w-4" />}
                      </span>
                      <span className={`mt-0.5 block text-[11px] ${active ? 'text-indigo-100' : 'text-muted-foreground'}`}>
                        {shift.value === 'Custom' && customData[day.key]
                          ? `${customData[day.key].start}–${customData[day.key].end}`
                          : shift.time}
                      </span>
                    </button>
                  )
                })}
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/70 bg-white/95 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95">
        <div className="mx-auto grid max-w-2xl grid-cols-[.8fr_1.2fr] gap-2">
          <button type="button" onClick={saveDraft} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 font-bold dark:border-slate-700">
            <Save className="h-4 w-4" /> Lưu nháp
          </button>
          <button type="button" onClick={submitSchedule} disabled={!selectedCount || submitting} className="mobile-primary-button">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitting ? 'Đang gửi...' : 'Gửi lịch'}
          </button>
        </div>
      </div>

      {customFor && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/45 backdrop-blur-sm" onClick={() => setCustomFor(null)}>
          <section className="w-full rounded-t-[2rem] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
            <div className="mx-auto max-w-lg">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Ca tùy chỉnh</p>
                  <h2 className="text-xl font-extrabold">{customDay?.name}</h2>
                </div>
                <button onClick={() => setCustomFor(null)} className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 dark:bg-slate-800" aria-label="Đóng">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-bold">Giờ bắt đầu
                  <input type="time" className="mobile-field mt-2" value={customData[customFor]?.start || ''} onChange={(e) => setCustomData((prev) => ({ ...prev, [customFor]: { ...prev[customFor], start: e.target.value } }))} />
                </label>
                <label className="text-sm font-bold">Giờ kết thúc
                  <input type="time" className="mobile-field mt-2" value={customData[customFor]?.end || ''} onChange={(e) => setCustomData((prev) => ({ ...prev, [customFor]: { ...prev[customFor], end: e.target.value } }))} />
                </label>
              </div>
              <label className="mt-3 block text-sm font-bold">Ghi chú
                <textarea className="mobile-field mt-2 min-h-20 py-3" placeholder="Ví dụ: cần nghỉ giữa ca 30 phút" value={customData[customFor]?.note || ''} onChange={(e) => setCustomData((prev) => ({ ...prev, [customFor]: { ...prev[customFor], note: e.target.value } }))} />
              </label>
              <label className="mt-3 block text-sm font-bold">Yêu cầu đặc biệt
                <textarea className="mobile-field mt-2 min-h-20 py-3" placeholder="Nhập nếu có" value={customData[customFor]?.request || ''} onChange={(e) => setCustomData((prev) => ({ ...prev, [customFor]: { ...prev[customFor], request: e.target.value } }))} />
              </label>
              <button type="button" onClick={saveCustom} className="mobile-primary-button mt-4">
                <SlidersHorizontal className="h-4 w-4" /> Áp dụng ca tùy chỉnh
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
