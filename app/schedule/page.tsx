'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Loader2,
  PartyPopper,
  RotateCcw,
  Save,
  Send,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import {
  cancelWorkScheduleBatch,
  getSchedulesByDateRange,
  replaceWorkSchedules,
  submitWorkSchedules,
} from '@/lib/services/scheduleService'
import { addPreviewSchedules, getPreviewSchedules } from '@/lib/services/previewWorkflow'
import type { WorkSchedule } from '@/lib/models/types'
import { Header } from '@/components/layout/header'
import { Badge } from '@/components/ui/badge'

type Shift = 'Morning' | 'Afternoon' | 'Evening' | 'Custom'
type DayItem = { key: string; name: string; shortName: string; date: Date }
type CustomShift = { start: string; end: string; note: string; request: string }
type Selection = Record<string, Shift[]>

const shiftOptions: { value: Shift; label: string; shortLabel: string; time: string }[] = [
  { value: 'Morning', label: 'Ca sáng', shortLabel: 'sáng', time: '06:00–14:00' },
  { value: 'Afternoon', label: 'Ca chiều', shortLabel: 'chiều', time: '14:00–22:00' },
  { value: 'Evening', label: 'Ca tối', shortLabel: 'tối', time: '22:00–06:00' },
  { value: 'Custom', label: 'Tùy chỉnh', shortLabel: 'tùy chỉnh', time: 'Tự chọn giờ' },
]

const cloneSelection = (value: Selection): Selection =>
  Object.fromEntries(Object.entries(value).map(([key, shifts]) => [key, [...shifts]]))

const scheduleDate = (value: WorkSchedule['date']) =>
  value instanceof Date ? value : value.toDate()

export default function SchedulePage() {
  const { authUser, isPreviewMode } = useAuth()
  const [selected, setSelected] = useState<Selection>({})
  const [original, setOriginal] = useState<Selection>({})
  const [customFor, setCustomFor] = useState<string | null>(null)
  const [customData, setCustomData] = useState<Record<string, CustomShift>>({})
  const [dutyDay, setDutyDay] = useState<string | null>(null)
  const [dutyPickerOpen, setDutyPickerOpen] = useState(false)
  const [submittedIds, setSubmittedIds] = useState<string[]>([])
  const [submittedStatus, setSubmittedStatus] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [celebrating, setCelebrating] = useState(false)
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
    if (!authUser) return
    const load = async () => {
      try {
        const start = days[0].date
        const end = new Date(days[6].date)
        end.setHours(23, 59, 59, 999)
        const schedules = isPreviewMode
          ? getPreviewSchedules()
              .filter((item) => {
                const date = new Date(item.date)
                return item.employeeId === authUser.uid && date >= start && date <= end
              })
              .map((item) => ({ ...item, date: new Date(item.date), createdAt: new Date(), updatedAt: new Date() } as WorkSchedule))
          : await getSchedulesByDateRange(authUser.uid, start, end)
        const current = schedules.filter((item) =>
          ['Pending', 'Registered', 'ChangesRequested', 'Rejected', 'Approved'].includes(item.status)
        )
        if (current.length) {
          const hydrated: Selection = {}
          const custom: Record<string, CustomShift> = {}
          let loadedDuty: string | null = null
          current.forEach((item) => {
            const key = scheduleDate(item.date).toISOString().slice(0, 10)
            const dutyOnly = item.note?.includes('[DUTY_ONLY]')
            if (item.note?.includes('[DUTY')) loadedDuty = key
            if (dutyOnly) return
            const customMatch = item.note?.match(/\[CUSTOM:(\d\d:\d\d)-(\d\d:\d\d)\]/)
            const shift: Shift = customMatch ? 'Custom' : item.shift
            hydrated[key] = Array.from(new Set([...(hydrated[key] || []), shift]))
            if (customMatch) {
              custom[key] = { start: customMatch[1], end: customMatch[2], note: '', request: '' }
            }
          })
          setSelected(hydrated)
          setOriginal(cloneSelection(hydrated))
          setCustomData(custom)
          setDutyDay(loadedDuty)
          setSubmittedIds(current.map((item) => item.id!).filter(Boolean))
          setSubmittedStatus(current[0].status)
        } else {
          const savedDraft = window.sessionStorage.getItem('schedule-draft')
          if (savedDraft) {
            const parsed = JSON.parse(savedDraft) as Record<string, Shift[] | Shift>
            setSelected(Object.fromEntries(
              Object.entries(parsed).map(([key, value]) => [key, Array.isArray(value) ? value : [value]])
            ))
          }
        }
      } catch {
        setMessage('Chưa tải được lịch đã đăng ký. Bạn vẫn có thể tạo lịch mới.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [authUser, days, isPreviewMode])

  const chooseShift = (dayKey: string, shift: Shift) => {
    if (shift === 'Custom' && !selected[dayKey]?.includes('Custom')) {
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

  const payload = () => {
    const rows: Array<Omit<WorkSchedule, 'id' | 'createdAt' | 'updatedAt'>> = []
    Object.entries(selected).forEach(([dayKey, shifts]) => {
      shifts.forEach((shift) => {
        const custom = customData[dayKey]
        const isDuty = dutyDay === dayKey && shift === 'Afternoon'
        rows.push({
          employeeId: authUser!.uid,
          date: new Date(`${dayKey}T12:00:00`),
          shift: shift === 'Custom' ? 'Morning' : shift,
          status: 'Pending',
          note: [
            shift === 'Custom' ? `[CUSTOM:${custom?.start || '08:00'}-${custom?.end || '17:00'}]` : '',
            shift === 'Custom' ? custom?.note || '' : '',
            shift === 'Custom' ? custom?.request || '' : '',
            isDuty ? '[DUTY] Trực 17:00–17:30' : '',
          ].filter(Boolean).join(' ').trim(),
        })
      })
    })
    if (dutyDay && !selected[dutyDay]?.includes('Afternoon')) {
      rows.push({
        employeeId: authUser!.uid,
        date: new Date(`${dutyDay}T12:00:00`),
        shift: 'Afternoon',
        status: 'Pending',
        note: '[DUTY_ONLY] Trực 17:00–17:30',
      })
    }
    return rows
  }

  const submitSchedule = async () => {
    if (!authUser || !Object.keys(selected).length) return
    setSubmitting(true)
    setMessage(null)
    try {
      const rows = payload()
      let ids: string[]
      if (isPreviewMode) {
        if (submittedIds.length) {
          const existing = getPreviewSchedules().filter((item) => !submittedIds.includes(item.id))
          window.sessionStorage.setItem('employee-portal-preview-schedules', JSON.stringify(existing))
        }
        const previewRows = rows.map((row, index) => ({
          id: `preview-${Date.now()}-${index}`,
          employeeId: authUser.uid,
          employeeName: authUser.displayName || 'Nguyễn Minh An',
          employeeCode: 'NV-001',
          phone: '0901 234 567',
          facebookUrl: 'https://facebook.com/',
          date: (row.date as Date).toISOString(),
          shift: row.shift,
          status: 'Pending' as const,
          note: row.note,
        }))
        addPreviewSchedules(previewRows)
        ids = previewRows.map((item) => item.id)
      } else {
        const result = submittedIds.length
          ? await replaceWorkSchedules(submittedIds, rows)
          : await submitWorkSchedules(rows)
        ids = result.ids
      }
      window.sessionStorage.removeItem('schedule-draft')
      setSubmittedIds(ids)
      setSubmittedStatus('Pending')
      setOriginal(cloneSelection(selected))
      setEditing(false)
      setCelebrating(true)
      setMessage('Gửi lịch thành công! Bảng lịch đang chờ quản lý xác nhận.')
      window.setTimeout(() => setCelebrating(false), 2400)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể gửi lịch. Vui lòng thử lại.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setSubmitting(false)
    }
  }

  const cancelSchedule = async () => {
    if (!submittedIds.length || submittedStatus !== 'Pending') return
    if (!window.confirm('Hủy toàn bộ bảng lịch đang chờ xác nhận?')) return
    setSubmitting(true)
    setMessage(null)
    try {
      if (isPreviewMode) {
        const remaining = getPreviewSchedules().filter((item) => !submittedIds.includes(item.id))
        window.sessionStorage.setItem('employee-portal-preview-schedules', JSON.stringify(remaining))
      } else {
        await cancelWorkScheduleBatch(submittedIds)
      }
      setSubmittedStatus('Cancelled')
      setMessage('Đã hủy bảng lịch. Khoản phạt đã phát sinh trước đó (nếu có) vẫn được giữ nguyên.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể hủy bảng lịch.')
    } finally {
      setSubmitting(false)
    }
  }

  const customDay = days.find((day) => day.key === customFor)
  const selectedCount = Object.values(selected).reduce((total, shifts) => total + shifts.length, 0)
  const compactMode = submittedIds.length > 0 && !editing
  const canEdit = submittedStatus === 'Pending' || submittedStatus === 'Rejected'

  if (loading) {
    return <main className="grid min-h-screen place-items-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></main>
  }

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
              <p className="mt-1 text-xs text-slate-300">
                {compactMode ? 'Lịch đã được gom thành một bảng để quản lý xác nhận.' : 'Bạn có thể chọn một hoặc nhiều ca trong cùng ngày.'}
              </p>
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

        {compactMode ? (
          <section className="schedule-summary overflow-hidden rounded-[1.75rem] border border-indigo-100 bg-white shadow-lg shadow-indigo-950/5 dark:border-indigo-500/20 dark:bg-slate-900">
            <div className="bg-gradient-to-r from-indigo-600 to-violet-600 p-4 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-indigo-100">Bảng đăng ký tuần</p>
                  <h2 className="mt-1 text-lg font-extrabold">Lịch làm của bạn</h2>
                </div>
                <Badge variant={submittedStatus === 'Approved' ? 'success' : submittedStatus === 'Rejected' ? 'destructive' : submittedStatus === 'Cancelled' ? 'outline' : 'warning'}>
                  {submittedStatus === 'Approved' ? 'Đã xác nhận' : submittedStatus === 'Rejected' ? 'Bị từ chối' : submittedStatus === 'Cancelled' ? 'Đã hủy' : 'Chờ xác nhận'}
                </Badge>
              </div>
            </div>
            <div className="divide-y divide-slate-100 p-2 dark:divide-white/10">
              {days.filter((day) => selected[day.key]?.length || dutyDay === day.key).map((day) => (
                <div key={day.key} className="flex gap-3 px-3 py-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-xs font-black text-indigo-600 dark:bg-indigo-500/10">{day.shortName}</div>
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold">{day.name} ({day.date.toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric' })})</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {(selected[day.key] || []).map((shift) =>
                        shift === 'Custom'
                          ? `tùy chỉnh ${customData[day.key]?.start || '08:00'}–${customData[day.key]?.end || '17:00'}`
                          : shiftOptions.find((item) => item.value === shift)?.shortLabel
                      ).filter(Boolean).join(' – ')}
                      {dutyDay === day.key && <span className="font-bold text-rose-600">{selected[day.key]?.length ? ' + ' : ''}trực 17:00–17:30</span>}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            {canEdit && (
              <div className="m-4 mt-2 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setEditing(true)} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 font-bold text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200">
                  <SlidersHorizontal className="h-4 w-4" /> Điều chỉnh
                </button>
                {submittedStatus === 'Pending' && (
                  <button type="button" onClick={cancelSchedule} disabled={submitting} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 font-bold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Hủy yêu cầu
                  </button>
                )}
              </div>
            )}
          </section>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setDutyPickerOpen(true)}
              className="mb-4 flex w-full items-center gap-3 rounded-3xl border-2 border-rose-400 bg-gradient-to-r from-rose-50 to-fuchsia-50 p-4 text-left shadow-sm dark:from-rose-500/10 dark:to-fuchsia-500/10"
            >
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-rose-600 text-white"><Clock3 className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <p className="font-extrabold text-rose-700 dark:text-rose-300">Thêm lịch trực</p>
                <p className="text-xs text-rose-600/80 dark:text-rose-200/70">
                  {dutyDay ? `${days.find((day) => day.key === dutyDay)?.name} · 17:00–17:30` : 'Chọn một ngày từ Thứ Hai đến Chủ Nhật'}
                </p>
              </div>
              <ChevronDown className="h-5 w-5 text-rose-500" />
            </button>

            {editing && (
              <div className="mb-4 flex items-start gap-2 rounded-2xl bg-slate-100 p-3 text-xs leading-5 dark:bg-slate-800">
                <span className="mt-1 h-3 w-3 shrink-0 rounded-full bg-pink-500" /> Màu hồng là lựa chọn đã gửi.
                <span className="ml-2 mt-1 h-3 w-3 shrink-0 rounded-full bg-sky-500" /> Màu xanh là lựa chọn mới.
              </div>
            )}

            <div className="space-y-3">
              {days.map((day) => (
                <article key={day.key} className="mobile-card overflow-hidden p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-50 font-black text-indigo-600 dark:bg-indigo-500/15">{day.shortName}</div>
                      <div>
                        <h3 className="font-extrabold">{day.name}</h3>
                        <p className="text-xs text-muted-foreground">{day.date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })}</p>
                      </div>
                    </div>
                    {!!selected[day.key]?.length && <Badge variant="success">{selected[day.key].length} ca</Badge>}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {shiftOptions.map((shift) => {
                      const active = selected[day.key]?.includes(shift.value)
                      const wasSaved = editing && original[day.key]?.includes(shift.value)
                      const activeClass = wasSaved
                        ? 'border-pink-500 bg-pink-500 text-white shadow-lg shadow-pink-500/20'
                        : 'border-sky-600 bg-sky-600 text-white shadow-lg shadow-sky-600/20'
                      return (
                        <button
                          key={shift.value}
                          type="button"
                          onClick={() => chooseShift(day.key, shift.value)}
                          className={`min-h-[58px] rounded-2xl border px-3 text-left transition active:scale-[0.98] ${
                            active ? activeClass : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800'
                          }`}
                        >
                          <span className="flex items-center justify-between text-sm font-bold">{shift.label}{active && <Check className="h-4 w-4" />}</span>
                          <span className={`mt-0.5 block text-[11px] ${active ? 'text-white/80' : 'text-muted-foreground'}`}>
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
          </>
        )}
      </div>

      {!compactMode && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 border-t border-slate-200/70 bg-white/95 p-3 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95 md:bottom-0">
          <div className="mx-auto grid max-w-2xl grid-cols-[.8fr_1.2fr] gap-2">
            <button type="button" onClick={editing ? () => { setSelected(cloneSelection(original)); setEditing(false) } : saveDraft} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 font-bold dark:border-slate-700">
              {editing ? <RotateCcw className="h-4 w-4" /> : <Save className="h-4 w-4" />} {editing ? 'Hủy sửa' : 'Lưu nháp'}
            </button>
            <button type="button" onClick={submitSchedule} disabled={!selectedCount || submitting} className="mobile-primary-button">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {submitting ? 'Đang gửi...' : editing ? 'Gửi điều chỉnh' : 'Gửi lịch'}
            </button>
          </div>
        </div>
      )}

      {celebrating && (
        <div className="pointer-events-none fixed inset-0 z-[70] grid place-items-center bg-slate-950/30 p-5 backdrop-blur-sm">
          <div className="schedule-celebration relative w-full max-w-sm overflow-hidden rounded-[2rem] bg-white p-7 text-center shadow-2xl dark:bg-slate-900">
            <Sparkles className="absolute left-5 top-5 h-6 w-6 animate-pulse text-amber-400" />
            <Sparkles className="absolute right-6 top-10 h-5 w-5 animate-pulse text-pink-500" />
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-xl shadow-indigo-500/30">
              <PartyPopper className="h-9 w-9" />
            </div>
            <h2 className="mt-5 text-2xl font-black">Gửi lịch thành công!</h2>
            <p className="mt-2 text-sm text-muted-foreground">Tuyệt vời! Bảng lịch của bạn đã được chuyển đến quản lý.</p>
          </div>
        </div>
      )}

      {dutyPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/45 backdrop-blur-sm" onClick={() => setDutyPickerOpen(false)}>
          <section className="w-full rounded-t-[2rem] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
            <div className="mx-auto max-w-lg">
              <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-300 dark:bg-slate-700" />
              <div className="mb-3 flex items-center justify-between">
                <div><p className="text-xs font-bold uppercase tracking-wider text-rose-600">Lịch trực</p><h2 className="text-xl font-extrabold">Chọn ngày trực</h2></div>
                <button onClick={() => setDutyPickerOpen(false)} className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 dark:bg-slate-800"><X className="h-5 w-5" /></button>
              </div>
              <p className="mb-3 text-sm text-muted-foreground">Khung giờ cố định 17:00–17:30</p>
              <div className="duty-wheel relative max-h-64 snap-y snap-mandatory overflow-y-auto rounded-3xl bg-slate-100 p-2 dark:bg-slate-800">
                {days.map((day) => (
                  <button key={day.key} type="button" onClick={() => { setDutyDay(day.key); setDutyPickerOpen(false) }} className={`flex min-h-14 w-full snap-center items-center justify-between rounded-2xl px-4 font-bold transition ${dutyDay === day.key ? 'bg-rose-600 text-white shadow-lg' : 'text-slate-600 dark:text-slate-300'}`}>
                    <span>{day.name}</span><span className="text-sm opacity-75">{day.date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</span>
                  </button>
                ))}
              </div>
              {dutyDay && <button type="button" onClick={() => { setDutyDay(null); setDutyPickerOpen(false) }} className="mt-3 min-h-11 w-full rounded-2xl text-sm font-bold text-rose-600">Bỏ lịch trực</button>}
            </div>
          </section>
        </div>
      )}

      {customFor && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/45 backdrop-blur-sm" onClick={() => setCustomFor(null)}>
          <section className="w-full rounded-t-[2rem] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
            <div className="mx-auto max-w-lg">
              <div className="mb-4 flex items-center justify-between">
                <div><p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Ca tùy chỉnh</p><h2 className="text-xl font-extrabold">{customDay?.name}</h2></div>
                <button onClick={() => setCustomFor(null)} className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 dark:bg-slate-800"><X className="h-5 w-5" /></button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-bold">Giờ bắt đầu<input type="time" className="mobile-field mt-2" value={customData[customFor]?.start || ''} onChange={(e) => setCustomData((prev) => ({ ...prev, [customFor]: { ...prev[customFor], start: e.target.value } }))} /></label>
                <label className="text-sm font-bold">Giờ kết thúc<input type="time" className="mobile-field mt-2" value={customData[customFor]?.end || ''} onChange={(e) => setCustomData((prev) => ({ ...prev, [customFor]: { ...prev[customFor], end: e.target.value } }))} /></label>
              </div>
              <label className="mt-3 block text-sm font-bold">Ghi chú<textarea className="mobile-field mt-2 min-h-20 py-3" placeholder="Ví dụ: cần nghỉ giữa ca 30 phút" value={customData[customFor]?.note || ''} onChange={(e) => setCustomData((prev) => ({ ...prev, [customFor]: { ...prev[customFor], note: e.target.value } }))} /></label>
              <label className="mt-3 block text-sm font-bold">Yêu cầu đặc biệt<textarea className="mobile-field mt-2 min-h-20 py-3" placeholder="Nhập nếu có" value={customData[customFor]?.request || ''} onChange={(e) => setCustomData((prev) => ({ ...prev, [customFor]: { ...prev[customFor], request: e.target.value } }))} /></label>
              <button type="button" onClick={saveCustom} className="mobile-primary-button mt-4"><SlidersHorizontal className="h-4 w-4" /> Áp dụng ca tùy chỉnh</button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
