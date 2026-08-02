'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  AlertTriangle,
  Clock3,
  Loader2,
  PartyPopper,
  RotateCcw,
  Save,
  Send,
  MessageSquareText,
  ExternalLink,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import {
  cancelWorkScheduleBatch,
  replaceWorkSchedules,
  setWorkScheduleBatchEditing,
  getEmployeeSchedules,
  getDutyAvailability,
  subscribeToSchedulesByDateRange,
  submitWorkSchedules,
} from '@/lib/services/scheduleService'
import { addPreviewSchedules, getPreviewSchedules, updatePreviewSchedule } from '@/lib/services/previewWorkflow'
import type { WorkSchedule } from '@/lib/models/types'
import { Header } from '@/components/layout/header'
import { Badge } from '@/components/ui/badge'
import { getManagementContact } from '@/lib/services/managementSettingsService'
import { toMessengerUrl } from '@/lib/utils/messenger'
import { submitStaffRequest } from '@/lib/services/staffRequestService'
import { subscribeToEmployeeLeaves } from '@/lib/services/leaveService'
import type { LeaveRequest } from '@/lib/models/types'

type Shift = 'Morning' | 'Afternoon' | 'Evening' | 'Custom'
type DayItem = { key: string; name: string; shortName: string; date: Date }
type CustomShift = { start: string; end: string; note: string; request: string }
type Selection = Record<string, Shift[]>
type EditBaseline = {
  selected: Selection
  customData: Record<string, CustomShift>
  dutyDay: string | null
  weekNote: string
}

const DUTY_TEAM_CAPACITY = 7
const DUTY_WHEEL_ROW_HEIGHT = 64

const shiftOptions: { value: Shift; label: string; shortLabel: string; time: string }[] = [
  { value: 'Morning', label: 'Ca sáng', shortLabel: 'sáng', time: '07:30–11:30' },
  { value: 'Afternoon', label: 'Ca chiều', shortLabel: 'chiều', time: '13:00–17:00' },
  { value: 'Evening', label: 'Ca tối', shortLabel: 'tối', time: '18:00–22:00' },
  { value: 'Custom', label: 'Tùy chỉnh', shortLabel: 'tùy chỉnh', time: 'Tự chọn giờ' },
]

const cloneSelection = (value: Selection): Selection =>
  Object.fromEntries(Object.entries(value).map(([key, shifts]) => [key, [...shifts]]))

const editSignature = (
  selected: Selection,
  customData: Record<string, CustomShift>,
  dutyDay: string | null,
  weekNote: string
) => JSON.stringify({
  selected: Object.entries(selected)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, shifts]) => [day, [...shifts].sort()]),
  customData: Object.entries(customData)
    .filter(([day]) => selected[day]?.includes('Custom'))
    .sort(([left], [right]) => left.localeCompare(right)),
  dutyDay,
  weekNote: weekNote.trim(),
})

const scheduleDate = (value: WorkSchedule['date']) =>
  value instanceof Date ? value : value.toDate()

const localDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export default function SchedulePage() {
  const { authUser, employee, isPreviewMode } = useAuth()
  const [managerFacebookUrl, setManagerFacebookUrl] = useState(process.env.NEXT_PUBLIC_MANAGER_FACEBOOK_URL?.trim() || '')
  const [selected, setSelected] = useState<Selection>({})
  const [original, setOriginal] = useState<Selection>({})
  const [customFor, setCustomFor] = useState<string | null>(null)
  const [customData, setCustomData] = useState<Record<string, CustomShift>>({})
  const [dutyDay, setDutyDay] = useState<string | null>(null)
  const [dutyPickerOpen, setDutyPickerOpen] = useState(false)
  const [dutyCandidate, setDutyCandidate] = useState<string | null>(null)
  const [dutyCounts, setDutyCounts] = useState<Record<string, number>>({})
  const [dutyAvailabilityLoading, setDutyAvailabilityLoading] = useState(false)
  const [dutyOverloadCandidate, setDutyOverloadCandidate] = useState<string | null>(null)
  const [submittedIds, setSubmittedIds] = useState<string[]>([])
  const [submittedStatus, setSubmittedStatus] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editingOriginStatus, setEditingOriginStatus] = useState<string | null>(null)
  const [requiresReapproval, setRequiresReapproval] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [celebrating, setCelebrating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [weekNote, setWeekNote] = useState('')
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const [overtimeMode, setOvertimeMode] = useState(false)
  const [changeMode, setChangeMode] = useState(false)
  const [currentWeekMode, setCurrentWeekMode] = useState(false)
  const [originalScheduleIds, setOriginalScheduleIds] = useState<Record<string, string>>({})
  const [returnableLeaveShifts, setReturnableLeaveShifts] = useState<Record<string, string>>({})
  const [submittedChangeSummary, setSubmittedChangeSummary] = useState<{ removed: string[]; added: string[]; restored: string[] } | null>(null)
  const [editBaseline, setEditBaseline] = useState<EditBaseline | null>(null)
  const [hasExistingSchedules, setHasExistingSchedules] = useState<boolean | null>(null)
  const [referenceNow] = useState(() => Date.now())
  const [portalReady, setPortalReady] = useState(false)
  const [leaveMarks, setLeaveMarks] = useState<Record<string, { fullDay: boolean; shifts: string[]; status: 'Pending' | 'AwaitingEmployeeConsent' | 'Approved' }>>({})
  const dutyWheelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!authUser || isPreviewMode) return
    return subscribeToEmployeeLeaves(authUser.uid, (requests: LeaveRequest[]) => {
      const active = requests.filter((request) => ['Pending', 'AwaitingEmployeeConsent', 'Approved'].includes(request.status))
      const marks: Record<string, { fullDay: boolean; shifts: string[]; status: 'Pending' | 'AwaitingEmployeeConsent' | 'Approved' }> = {}
      const statusRank = (status: 'Pending' | 'AwaitingEmployeeConsent' | 'Approved') => status === 'Approved' ? 3 : status === 'AwaitingEmployeeConsent' ? 2 : 1
      const add = (key: string, status: 'Pending' | 'AwaitingEmployeeConsent' | 'Approved', shift?: string) => {
        marks[key] ||= { fullDay: false, shifts: [], status }
        if (statusRank(status) > statusRank(marks[key].status)) marks[key].status = status
        if (shift && !marks[key].shifts.includes(shift)) marks[key].shifts.push(shift)
      }
      active.forEach((request) => {
        const requestStatus = request.status as 'Pending' | 'AwaitingEmployeeConsent' | 'Approved'
        const start = request.leaveDate instanceof Date ? request.leaveDate : request.leaveDate.toDate()
        const end = request.endDate ? (request.endDate instanceof Date ? request.endDate : request.endDate.toDate()) : start
        if (request.duration === 'long') {
          for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
            const key = localDateKey(cursor)
            add(key, requestStatus)
            marks[key].fullDay = true
          }
          return
        }
        if (request.workScheduleIds?.length) {
          request.workScheduleIds.forEach((id) => {
            const match = Object.entries(originalScheduleIds).find(([, scheduleId]) => scheduleId === id)?.[0]
            add(match?.slice(0, 10) || localDateKey(start), requestStatus, match?.slice(11))
          })
        } else add(localDateKey(start), requestStatus)
      })
      setLeaveMarks(marks)
    }, () => setLeaveMarks({}))
  }, [authUser, isPreviewMode, originalScheduleIds])

  useEffect(() => setPortalReady(true), [])

  useEffect(() => {
    const mode = new URLSearchParams(window.location.search).get('mode')
    const week = new URLSearchParams(window.location.search).get('week')
    setOvertimeMode(mode === 'overtime')
    setChangeMode(mode === 'change')
    setCurrentWeekMode(mode === 'change' ? new Date().getDay() !== 0 : week === 'current')
  }, [])

  useEffect(() => {
    if (!authUser || isPreviewMode) return
    void getManagementContact().then((contact) => {
      if (contact.facebookUrl) setManagerFacebookUrl(contact.facebookUrl)
    }).catch(() => undefined)
  }, [authUser, isPreviewMode])

  useEffect(() => {
    if (!authUser) return
    if (isPreviewMode) {
      setHasExistingSchedules(getPreviewSchedules().some((item) => item.employeeId === authUser.uid && item.status !== 'Cancelled'))
      return
    }
    setHasExistingSchedules(null)
    void getEmployeeSchedules(authUser.uid)
      .then((schedules) => setHasExistingSchedules(schedules.some((item) => item.status !== 'Cancelled')))
      .catch(() => setHasExistingSchedules(false))
  }, [authUser, isPreviewMode])

  const isNewEmployee = useMemo(() => {
    if (!employee || hasExistingSchedules !== false || overtimeMode || changeMode) return false
    const joined = employee.joinDate instanceof Date ? employee.joinDate : employee.joinDate.toDate()
    return referenceNow - joined.getTime() <= 45 * 24 * 60 * 60 * 1000
  }, [employee, hasExistingSchedules, overtimeMode, changeMode, referenceNow])

  const days = useMemo<DayItem[]>(() => {
    const now = new Date()
    if (isNewEmployee) {
      const first = new Date(now)
      first.setHours(0, 0, 0, 0)
      const last = new Date(first)
      last.setDate(first.getDate() + ((7 - first.getDay()) % 7) + 7)
      const names = ['Chá»§ Nháº­t', 'Thá»© Hai', 'Thá»© Ba', 'Thá»© TÆ°', 'Thá»© NÄƒm', 'Thá»© SÃ¡u', 'Thá»© Báº£y']
      const shortNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
      const result: DayItem[] = []
      for (const date = new Date(first); date <= last; date.setDate(date.getDate() + 1)) {
        const itemDate = new Date(date)
        result.push({ key: localDateKey(itemDate), name: names[itemDate.getDay()], shortName: shortNames[itemDate.getDay()], date: itemDate })
      }
      return result
    }
    const currentDay = now.getDay()
    const daysUntilNextMonday = currentWeekMode
      ? -((currentDay || 7) - 1)
      : ((8 - currentDay) % 7) || 7
    const monday = new Date(now)
    monday.setHours(0, 0, 0, 0)
    monday.setDate(now.getDate() + daysUntilNextMonday)
    const names = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật']
    const shortNames = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
    return names.map((name, index) => {
      const date = new Date(monday)
      date.setDate(monday.getDate() + index)
      return { key: localDateKey(date), name, shortName: shortNames[index], date }
    })
  }, [currentWeekMode, isNewEmployee])

  const loadDutyAvailability = useCallback(async () => {
    if (!authUser || !days.length) return
    setDutyAvailabilityLoading(true)
    try {
      if (isPreviewMode) {
        const members = new Map<string, Set<string>>()
        getPreviewSchedules().forEach((schedule) => {
          if (['Draft', 'Rejected', 'Cancelled'].includes(schedule.status) || !schedule.note?.includes('[DUTY')) return
          const key = localDateKey(new Date(schedule.date))
          const team = members.get(key) || new Set<string>()
          team.add(schedule.employeeId)
          members.set(key, team)
        })
        setDutyCounts(Object.fromEntries([...members.entries()].map(([key, team]) => [key, team.size])))
      } else {
        const availability = await getDutyAvailability(days[0].key, days[days.length - 1].key)
        setDutyCounts(availability.counts)
      }
    } catch {
      // The picker remains usable when the live headcount is temporarily unavailable.
      setDutyCounts({})
    } finally {
      setDutyAvailabilityLoading(false)
    }
  }, [authUser, days, isPreviewMode])

  useEffect(() => {
    void loadDutyAvailability()
  }, [loadDutyAvailability])

  const dutyWheelEntries = useMemo(() => [...days, ...days, ...days], [days])
  const dutyTeamCount = useCallback((dayKey: string) => {
    const storedCount = dutyCounts[dayKey] || 0
    const currentSelectionIsSaved = dayKey === dutyDay && submittedIds.length > 0
    return storedCount + (currentSelectionIsSaved ? 0 : 1)
  }, [dutyCounts, dutyDay, submittedIds.length])

  const openDutyPicker = () => {
    setDutyCandidate(dutyDay || days[0]?.key || null)
    setDutyPickerOpen(true)
    void loadDutyAvailability()
  }

  useEffect(() => {
    if (!dutyPickerOpen || !dutyCandidate || !days.length) return
    const index = Math.max(0, days.findIndex((day) => day.key === dutyCandidate))
    const timer = window.setTimeout(() => {
      if (dutyWheelRef.current) dutyWheelRef.current.scrollTop = (days.length + index) * DUTY_WHEEL_ROW_HEIGHT
    }, 0)
    return () => window.clearTimeout(timer)
  }, [days, dutyCandidate, dutyPickerOpen])

  const selectDutyCandidate = () => {
    if (!dutyCandidate) return
    if (dutyTeamCount(dutyCandidate) > DUTY_TEAM_CAPACITY) {
      setDutyPickerOpen(false)
      setDutyOverloadCandidate(dutyCandidate)
      return
    }
    setDutyDay(dutyCandidate)
    setDutyPickerOpen(false)
  }

  useEffect(() => {
    if (!authUser || hasExistingSchedules === null) return
    const hydrateSchedules = (schedules: WorkSchedule[]) => {
        const current = schedules.filter((item) => (overtimeMode || changeMode)
          ? item.status === 'Approved'
          : ['Pending', 'Registered', 'ChangesRequested', 'Rejected', 'Approved', 'Editing'].includes(item.status)
        )
        const returnable = changeMode
          ? schedules.filter((item) => item.status === 'Cancelled' && (
            Boolean((item as WorkSchedule & { cancelledByLeaveRequestId?: string }).cancelledByLeaveRequestId) || /ngh[ỉi]|leave/i.test(item.cancellationReason || '')
          ))
          : []
        const available = [...current, ...returnable]
        if (available.length) {
          const hydrated: Selection = {}
          const custom: Record<string, CustomShift> = {}
          const scheduleIds: Record<string, string> = {}
          const restorableIds: Record<string, string> = {}
          let loadedDuty: string | null = null
          let loadedWeekNote = ''
          current.forEach((item) => {
            const key = localDateKey(scheduleDate(item.date))
            const weekNoteMatch = item.note?.match(/\[WEEK_NOTE\]\s*([^\[]+)/)
            if (weekNoteMatch) loadedWeekNote = weekNoteMatch[1].trim()
            if (item.note?.includes('[NO_SHIFTS]')) return
            const dutyOnly = item.note?.includes('[DUTY_ONLY]')
            if (item.note?.includes('[DUTY')) loadedDuty = key
            if (dutyOnly) return
            const customMatch = item.note?.match(/\[CUSTOM:(\d\d:\d\d)-(\d\d:\d\d)\]/)
            const shift: Shift = customMatch ? 'Custom' : item.shift
            hydrated[key] = Array.from(new Set([...(hydrated[key] || []), shift]))
            if (item.id && shift !== 'Custom') scheduleIds[`${key}-${shift}`] = item.id
            if (customMatch) {
              custom[key] = { start: customMatch[1], end: customMatch[2], note: '', request: '' }
            }
          })
          returnable.forEach((item) => {
            const key = localDateKey(scheduleDate(item.date))
            if (item.id) restorableIds[`${key}-${item.shift}`] = item.id
          })
          setWeekNote(overtimeMode || changeMode ? '' : loadedWeekNote)
          setSelected(hydrated)
          setOriginal(cloneSelection(hydrated))
          setOriginalScheduleIds(scheduleIds)
          setReturnableLeaveShifts(restorableIds)
          setCustomData(custom)
          setDutyDay(loadedDuty)
          setEditBaseline({
            selected: cloneSelection(hydrated),
            customData: structuredClone(custom),
            dutyDay: loadedDuty,
            weekNote: loadedWeekNote,
          })
          setSubmittedIds(available.map((item) => item.id!).filter(Boolean))
          setSubmittedStatus(current[0]?.status || 'Approved')
          setRequiresReapproval(current.some((item) => item.requiresReapproval))
          if (current[0]?.status === 'Editing') {
            setEditingOriginStatus(current[0].editPreviousStatus || 'Pending')
            setEditing(true)
          } else {
            setEditingOriginStatus(null)
            setEditing(false)
          }
        } else {
          setWeekNote('')
          setSelected({})
          setOriginal({})
          setOriginalScheduleIds({})
          setReturnableLeaveShifts({})
          setCustomData({})
          setDutyDay(null)
          setEditBaseline(null)
          setSubmittedIds([])
          setSubmittedStatus(null)
          setRequiresReapproval(false)
          setEditingOriginStatus(null)
          setEditing(false)
          const savedDraft = window.sessionStorage.getItem('schedule-draft')
          if (savedDraft) {
            const parsed = JSON.parse(savedDraft) as Record<string, Shift[] | Shift>
            setSelected(Object.fromEntries(
              Object.entries(parsed).map(([key, value]) => [key, Array.isArray(value) ? value : [value]])
            ))
          }
        }
        setLoading(false)
    }

    const start = days[0].date
    const end = new Date(days[days.length - 1].date)
    end.setHours(23, 59, 59, 999)
    if (isPreviewMode) {
      hydrateSchedules(getPreviewSchedules()
        .filter((item) => {
          const date = new Date(item.date)
          return item.employeeId === authUser.uid && date >= start && date <= end
        })
        .map((item) => ({ ...item, date: new Date(item.date), createdAt: new Date(), updatedAt: new Date() } as WorkSchedule)))
      return
    }

    return subscribeToSchedulesByDateRange(
      authUser.uid,
      start,
      end,
      hydrateSchedules,
      () => {
        setMessage('Chưa tải được lịch đã đăng ký. Bạn vẫn có thể tạo lịch mới.')
        setLoading(false)
      }
    )
  }, [authUser, days, hasExistingSchedules, isPreviewMode, overtimeMode, changeMode])

  const chooseShift = (dayKey: string, shift: Shift) => {
    if (overtimeMode && original[dayKey]?.includes(shift)) return
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
    if (!rows.length) {
      rows.push({
        employeeId: authUser!.uid,
        date: new Date(`${days[0].key}T12:00:00`),
        shift: 'Morning',
        status: 'Pending',
        note: '[NO_SHIFTS]',
      })
    }
    if (weekNote.trim()) rows[0].note = `${rows[0].note} [WEEK_NOTE] ${weekNote.trim()}`.trim()
    return rows
  }

  const submitSchedule = async (confirmed = false) => {
    if (!authUser) return
    if (overtimeMode || changeMode) {
      const restoredShifts = Object.entries(selected).flatMap(([dayKey, selectedShifts]) =>
        selectedShifts
          .filter((shift): shift is Exclude<Shift, 'Custom'> => shift !== 'Custom' && Boolean(returnableLeaveShifts[`${dayKey}-${shift}`]))
          .map((shift) => ({
            scheduleId: returnableLeaveShifts[`${dayKey}-${shift}`],
            date: new Date(`${dayKey}T12:00:00`),
            shift,
          }))
      )
      const requestedShifts = Object.entries(selected).flatMap(([dayKey, selectedShifts]) =>
        selectedShifts
          .filter((shift): shift is Exclude<Shift, 'Custom'> => shift !== 'Custom' && !original[dayKey]?.includes(shift) && !returnableLeaveShifts[`${dayKey}-${shift}`])
          .map((shift) => ({ date: new Date(`${dayKey}T12:00:00`), shift }))
      )
      const removedShifts = Object.entries(original).flatMap(([dayKey, originalShifts]) =>
        originalShifts
          .filter((shift): shift is Exclude<Shift, 'Custom'> => shift !== 'Custom' && !selected[dayKey]?.includes(shift))
          .map((shift) => ({
            scheduleId: originalScheduleIds[`${dayKey}-${shift}`],
            date: new Date(`${dayKey}T12:00:00`),
            shift,
          }))
          .filter((item) => Boolean(item.scheduleId))
      )
      if (!requestedShifts.length && !restoredShifts.length && (!changeMode || !removedShifts.length)) {
        setMessage(changeMode ? 'Vui lòng chọn ca cần hủy, đổi hoặc đăng ký thêm.' : 'Vui lòng chọn ít nhất một ca muốn làm thêm.')
        return
      }
      if (changeMode && removedShifts.length && !requestedShifts.length && !restoredShifts.length) {
        setMessage('Bạn đã xin hủy ca cũ nên phải chọn ít nhất một ca mới để thay thế.')
        return
      }
      setSubmitting(true)
      setMessage(null)
      try {
        if (!isPreviewMode) {
          await submitStaffRequest({
            type: changeMode ? 'scheduleChange' : 'overtime',
            content: weekNote.trim(),
            weekStart: days[0].date,
            shifts: requestedShifts,
            removedShifts: changeMode ? removedShifts : undefined,
            restoredShifts: changeMode ? restoredShifts : undefined,
          })
        }
        setSelected(cloneSelection(original))
        setWeekNote('')
        if (changeMode) {
          const describe = (item: { date: Date; shift: Exclude<Shift, 'Custom'> }) => {
            const day = days.find((candidate) => candidate.key === localDateKey(item.date))
            const shift = shiftOptions.find((candidate) => candidate.value === item.shift)?.label || item.shift
            return `${day?.shortName || item.date.toLocaleDateString('vi-VN')} · ${shift}`
          }
          setSubmittedChangeSummary({
            removed: removedShifts.map(describe),
            added: requestedShifts.map(describe),
            restored: restoredShifts.map(describe),
          })
        }
        setMessage(changeMode
          ? `Đã gửi yêu cầu: ${removedShifts.length} ca xin hủy, ${restoredShifts.length} ca xin đi làm lại, ${requestedShifts.length} ca mới / ca thêm.`
          : `Đã gửi yêu cầu làm thêm gồm ${requestedShifts.length} ca cho quản lý.`)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } catch (error) {
        setMessage(error instanceof Error ? error.message : changeMode ? 'Chưa thể gửi yêu cầu đổi / thêm ca.' : 'Chưa thể gửi yêu cầu làm thêm.')
      } finally {
        setSubmitting(false)
      }
      return
    }
    if (
      editing &&
      editBaseline &&
      editSignature(selected, customData, dutyDay, weekNote) ===
        editSignature(editBaseline.selected, editBaseline.customData, editBaseline.dutyDay, editBaseline.weekNote)
    ) {
      setMessage('Bạn chưa thay đổi lịch nên chưa thể gửi điều chỉnh.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    if (!confirmed && missingDays.length) {
      setConfirmationOpen(true)
      return
    }
    setConfirmationOpen(false)
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
          : await submitWorkSchedules(rows, confirmed)
        ids = result.ids
      }
      window.sessionStorage.removeItem('schedule-draft')
      setSubmittedIds(ids)
      const needsReapproval = editingOriginStatus === 'Approved' || requiresReapproval
      setSubmittedStatus('Pending')
      setRequiresReapproval(needsReapproval)
      setOriginal(cloneSelection(selected))
      setEditBaseline({
        selected: cloneSelection(selected),
        customData: structuredClone(customData),
        dutyDay,
        weekNote,
      })
      setEditing(false)
      setEditingOriginStatus(null)
      setCelebrating(true)
      setMessage(needsReapproval
        ? 'Đã gửi lịch sửa đổi. Bảng đang chờ quản lý xác nhận lại.'
        : 'Gửi lịch thành công! Bảng lịch đang chờ quản lý xác nhận.')
      window.setTimeout(() => setCelebrating(false), 2400)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể gửi lịch. Vui lòng thử lại.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setSubmitting(false)
    }
  }

  const startEditing = async () => {
    if (!submittedIds.length || !submittedStatus) return
    setSubmitting(true)
    setMessage(null)
    try {
      const previousStatus = submittedStatus
      if (isPreviewMode) {
        submittedIds.forEach((id) => updatePreviewSchedule(id, {
          status: 'Editing',
          editPreviousStatus: previousStatus as any,
        }))
      } else {
        await setWorkScheduleBatchEditing(submittedIds, true)
      }
      setEditingOriginStatus(previousStatus)
      setSubmittedStatus('Editing')
      setEditing(true)
      setMessage('Bạn đang sửa bảng lịch. Quản lý chỉ thấy lịch mới sau khi bạn gửi lại.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể mở chế độ chỉnh sửa.')
    } finally {
      setSubmitting(false)
    }
  }

  const cancelEditing = async () => {
    if (!submittedIds.length) return
    setSubmitting(true)
    setMessage(null)
    try {
      const restoredStatus = editingOriginStatus || 'Pending'
      if (isPreviewMode) {
        submittedIds.forEach((id) => updatePreviewSchedule(id, {
          status: restoredStatus as any,
          editPreviousStatus: undefined,
        }))
      } else {
        await setWorkScheduleBatchEditing(submittedIds, false)
      }
      setSelected(cloneSelection(editBaseline?.selected || original))
      setCustomData(structuredClone(editBaseline?.customData || customData))
      setDutyDay(editBaseline ? editBaseline.dutyDay : dutyDay)
      setWeekNote(editBaseline ? editBaseline.weekNote : weekNote)
      setSubmittedStatus(restoredStatus)
      setEditingOriginStatus(null)
      setEditing(false)
      setMessage('Đã hủy chỉnh sửa. Bảng lịch giữ nguyên như trước.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể hủy chỉnh sửa.')
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
  const overtimeCount = Object.entries(selected).reduce((total, [dayKey, selectedShifts]) =>
    total + selectedShifts.filter((shift) => !original[dayKey]?.includes(shift) && !returnableLeaveShifts[`${dayKey}-${shift}`]).length, 0)
  const restoredCount = Object.entries(selected).reduce((total, [dayKey, selectedShifts]) =>
    total + selectedShifts.filter((shift) => Boolean(returnableLeaveShifts[`${dayKey}-${shift}`])).length, 0)
  const removedCount = Object.entries(original).reduce((total, [dayKey, originalShifts]) =>
    total + originalShifts.filter((shift) => !selected[dayKey]?.includes(shift)).length, 0)
  const missingDays = days.filter((day) => !selected[day.key]?.length && dutyDay !== day.key)
  const compactMode = submittedIds.length > 0 && !editing && !overtimeMode && !changeMode
  const canEdit = ['Pending', 'Rejected'].includes(submittedStatus || '')

  if (loading) {
    return <main className="grid min-h-screen place-items-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></main>
  }

  return (
    <main className="min-h-screen pb-32">
      <Header title={changeMode ? 'Đổi / thêm ca' : overtimeMode ? 'Xin làm thêm' : 'Đăng ký lịch làm'} subtitle={`${isNewEmployee ? 'Từ hôm nay đến hết tuần sau' : currentWeekMode ? 'Tuần hiện tại' : 'Tuần kế tiếp'} · ${days[0].name} đến ${days[days.length - 1].name}`} />
      <div className="mx-auto max-w-2xl px-3 py-4 sm:px-6">
        {changeMode && (
          <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
            <button type="button" onClick={() => { setCurrentWeekMode(true); setSubmittedChangeSummary(null); setMessage(null) }} className={`min-h-11 rounded-xl text-sm font-bold ${currentWeekMode ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-950' : 'text-muted-foreground'}`}>Tuần này</button>
            <button type="button" onClick={() => { setCurrentWeekMode(false); setSubmittedChangeSummary(null); setMessage(null) }} className={`min-h-11 rounded-xl text-sm font-bold ${!currentWeekMode ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-950' : 'text-muted-foreground'}`}>Tuần sau</button>
          </div>
        )}
        <section className="mb-4 rounded-[2rem] bg-gradient-to-br from-indigo-700 via-indigo-800 to-violet-900 p-5 text-white shadow-xl shadow-indigo-950/20">
          <CalendarDays className="h-7 w-7 text-indigo-200" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-indigo-100">{isNewEmployee ? 'Lịch dành cho nhân viên mới' : currentWeekMode ? 'Lịch tuần này' : 'Lịch tuần sau'}</p>
              <h2 className="mt-1 text-xl font-extrabold">
                {days[0].date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}
                {' – '}
                {days[days.length - 1].date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}
              </h2>
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
        {changeMode && submittedChangeSummary && (
          <section className="mb-4 grid gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-900">
              <p className="font-extrabold">Ca xin hủy</p>
              <p className="mt-1 leading-6">{submittedChangeSummary.removed.length ? submittedChangeSummary.removed.join(' · ') : 'Không có'}</p>
            </div>
            <div className="rounded-2xl bg-sky-50 p-3 text-sm text-sky-900">
              <p className="font-extrabold">Ca mới / ca thêm</p>
              <p className="mt-1 leading-6">{submittedChangeSummary.added.length ? submittedChangeSummary.added.join(' · ') : 'Không có'}</p>
            </div>
            <div className="rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900">
              <p className="font-extrabold">Ca xin đi làm lại</p>
              <p className="mt-1 leading-6">{submittedChangeSummary.restored.length ? submittedChangeSummary.restored.join(' · ') : 'Không có'}</p>
            </div>
            <Badge variant="warning">Đang chờ quản lý xác nhận</Badge>
          </section>
        )}

        {!compactMode && (overtimeMode || changeMode) && (
          <details className="group mb-4 overflow-hidden rounded-2xl border border-slate-200/80 bg-white/75 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-sm font-bold">
              <span>Xem quy tắc màu và khoản phạt</span><ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" />
            </summary>
            <div className="border-t border-slate-100 p-3 text-xs leading-5 dark:border-white/10">
              <div className="flex items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-full bg-rose-600" /> Màu đỏ là ca đã duyệt{changeMode ? '; chạm lại để xin hủy.' : ', không thể thay đổi.'}</div>
              {changeMode && <div className="mt-2 flex items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-full bg-emerald-600" /> Ca đỏ nhạt là ca đã nghỉ; chạm để xin đi làm lại.</div>}
              <div className="mt-2 flex items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-full bg-sky-600" /> Màu xanh là ca mới / ca thêm.</div>
              {changeMode && <p className="mt-3 rounded-xl bg-amber-50 p-2 font-semibold text-amber-800">Hủy ca của hôm nay bị phạt 1.000đ. Đổi từ ngày mai hoặc chỉ đăng ký thêm ca thì không bị phạt.</p>}
            </div>
          </details>
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
                  {submittedStatus === 'Approved'
                    ? 'Đã xác nhận'
                    : submittedStatus === 'Rejected'
                      ? 'Bị từ chối'
                      : submittedStatus === 'Cancelled'
                        ? 'Đã hủy'
                        : requiresReapproval
                          ? 'Chờ xác nhận lại'
                          : 'Chờ xác nhận'}
                </Badge>
              </div>
            </div>
            <div className="border-b border-slate-100 dark:border-white/10">
              <div className="flex items-center gap-3 px-4 py-4">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10">
                  <CalendarDays className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold">
                    {selectedCount ? 'Các ngày đã đăng ký' : 'Nghỉ cả tuần'}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {selectedCount
                      ? `${days.filter((day) => selected[day.key]?.length).length} ngày · ${selectedCount} ca${dutyDay ? ' · có lịch trực' : ''}`
                      : 'Không đăng ký ca làm nào trong tuần này'}
                  </p>
                </div>
              </div>
              <div className="divide-y divide-slate-100 border-t border-slate-100 px-2 dark:divide-white/10 dark:border-white/10">
                {!selectedCount && (
                  <div className="m-2 rounded-2xl bg-slate-50 px-4 py-4 text-center dark:bg-slate-800">
                    <p className="font-extrabold">Tuần này bạn không đăng ký ca nào</p>
                    <p className="mt-1 text-xs text-muted-foreground">Bảng nghỉ cả tuần đã được gửi cho quản lý xác nhận.</p>
                  </div>
                )}
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
            </div>
            {weekNote.trim() && (
              <div className="mx-4 mb-3 rounded-2xl border border-slate-100 bg-white px-3 py-3 text-sm leading-6 text-slate-700 shadow-sm dark:border-white/10 dark:bg-slate-900 dark:text-slate-200">
                <strong>Ghi chú:</strong> {weekNote.trim()}
              </div>
            )}
            {canEdit && (
              <div className={`m-4 mt-2 grid gap-2 ${submittedStatus === 'Pending' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <button type="button" onClick={() => void startEditing()} disabled={submitting} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 font-bold text-indigo-700 disabled:opacity-60 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <SlidersHorizontal className="h-4 w-4" />} Điều chỉnh
                </button>
                {submittedStatus === 'Pending' && (
                  <button type="button" onClick={cancelSchedule} disabled={submitting} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 font-bold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Hủy yêu cầu
                  </button>
                )}
              </div>
            )}
            <div className={`${canEdit ? 'mx-4 mb-4 -mt-1' : 'm-4'} border-t border-slate-100 pt-3 dark:border-white/10`}>
              {managerFacebookUrl ? (
                <a href={toMessengerUrl(managerFacebookUrl)} target="_blank" rel="noreferrer" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 font-extrabold text-white shadow-lg shadow-blue-600/15 transition active:scale-[0.99]">
                  <ExternalLink className="h-4 w-4" /> Liên hệ quản lí
                </a>
              ) : (
                <p className="rounded-2xl bg-slate-50 p-3 text-center text-xs font-semibold text-slate-500 dark:bg-slate-800">Chưa có Facebook liên hệ của quản lí.</p>
              )}
            </div>
          </section>
        ) : (
          <>
            {!overtimeMode && !changeMode && (
              <button
                type="button"
                onClick={openDutyPicker}
                className="mb-4 flex w-full items-center gap-3 rounded-3xl border-2 border-rose-400 bg-gradient-to-r from-rose-50 to-fuchsia-50 p-4 text-left shadow-sm dark:from-rose-500/10 dark:to-fuchsia-500/10"
              >
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-rose-600 text-white"><Clock3 className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold text-rose-700 dark:text-rose-300">Thêm lịch trực</p>
                  <p className="text-xs text-rose-600/80 dark:text-rose-200/70">
                    {dutyDay
                      ? `${days.find((day) => day.key === dutyDay)?.name} · 17:00–17:30${dutyAvailabilityLoading ? '' : ` · ${dutyTeamCount(dutyDay)}/${DUTY_TEAM_CAPACITY} người`}`
                      : 'Chọn một ngày từ Thứ Hai đến Chủ Nhật'}
                  </p>
                </div>
                <ChevronDown className="h-5 w-5 text-rose-500" />
              </button>
            )}

            {changeMode && (
              <div className="mb-4 grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-xl bg-rose-50 p-2 font-bold text-rose-700">Ca xin hủy: {removedCount}</div>
                <div className="rounded-xl bg-emerald-50 p-2 font-bold text-emerald-700">Đi làm lại: {restoredCount}</div>
                <div className="rounded-xl bg-sky-50 p-2 font-bold text-sky-700">Ca mới / ca thêm: {overtimeCount}</div>
              </div>
            )}
            {!overtimeMode && !changeMode && editing && (
              <div className="mb-4 flex items-start gap-2 rounded-2xl bg-slate-100 p-3 text-xs leading-5 dark:bg-slate-800">
                <span className="mt-1 h-3 w-3 shrink-0 rounded-full bg-pink-500" /> Màu hồng là lựa chọn đã gửi.
                <span className="ml-2 mt-1 h-3 w-3 shrink-0 rounded-full bg-sky-500" /> Màu xanh là lựa chọn mới.
              </div>
            )}

            {(overtimeMode || changeMode) && !submittedIds.length && (
              <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                Bạn chưa có lịch tuần này được quản lý duyệt. Hãy chờ lịch được duyệt rồi quay lại {changeMode ? 'đổi / thêm ca' : 'xin làm thêm'}.
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
                    {!!selected[day.key]?.length && <Badge variant="success">{overtimeMode ? `+${selected[day.key].filter((shift) => !original[day.key]?.includes(shift)).length} ca mới` : `${selected[day.key].length} ca`}</Badge>}
                  </div>
                  {leaveMarks[day.key]?.fullDay && <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-extrabold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">{leaveMarks[day.key].status === 'Approved' ? 'Đã duyệt nghỉ cả ngày' : 'Đang chờ duyệt nghỉ cả ngày'}</div>}
                  {!leaveMarks[day.key]?.fullDay && !!leaveMarks[day.key]?.shifts.length && <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-extrabold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">{leaveMarks[day.key].shifts.map((shift) => `${shiftOptions.find((item) => item.value === shift)?.shortLabel || 'Ca'} · ${leaveMarks[day.key].status === 'Approved' ? 'Đã duyệt nghỉ' : 'Đang chờ duyệt'}`).join(' • ')}</div>}
                  <div className="grid grid-cols-2 gap-2">
                    {shiftOptions.filter((shift) => (!overtimeMode && !changeMode) || shift.value !== 'Custom').map((shift) => {
                      const today = new Date()
                      today.setHours(0, 0, 0, 0)
                      const isPastDay = changeMode && day.date < today
                      const active = selected[day.key]?.includes(shift.value)
                      const requestedLeave = leaveMarks[day.key]?.fullDay || leaveMarks[day.key]?.shifts.includes(shift.value)
                      const returnable = changeMode && Boolean(returnableLeaveShifts[`${day.key}-${shift.value}`])
                      const wasSaved = (editing || overtimeMode || changeMode) && original[day.key]?.includes(shift.value)
                      const activeClass = returnable
                        ? 'border-emerald-600 bg-emerald-600 text-white shadow-lg shadow-emerald-600/20'
                        : wasSaved
                        ? overtimeMode || changeMode
                          ? 'border-rose-600 bg-rose-600 text-white shadow-lg shadow-rose-600/20'
                          : 'border-pink-500 bg-pink-500 text-white shadow-lg shadow-pink-500/20'
                        : 'border-sky-600 bg-sky-600 text-white shadow-lg shadow-sky-600/20'
                      return (
                        <button
                          key={shift.value}
                          type="button"
                          onClick={() => chooseShift(day.key, shift.value)}
                          disabled={(overtimeMode && (wasSaved || !submittedIds.length)) || (changeMode && (!submittedIds.length || isPastDay))}
                          className={`min-h-[58px] rounded-2xl border px-3 text-left transition active:scale-[0.98] ${
                            active ? activeClass : returnable ? 'border-rose-400 bg-rose-50 text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-200' : requestedLeave ? 'border-rose-400 bg-rose-50 text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-200' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800'
                          } disabled:cursor-not-allowed disabled:active:scale-100`}
                        >
                          <span className="flex items-center justify-between text-sm font-bold">{shift.label}{active ? <Check className="h-4 w-4" /> : returnable ? <span className="text-[10px]">Đã nghỉ · chạm để đi làm lại</span> : requestedLeave ? <span className="text-[10px]">{leaveMarks[day.key].status === 'Approved' ? 'Đã duyệt nghỉ' : 'Đang chờ duyệt'}</span> : null}</span>
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
            <div className="mt-4 grid gap-3 rounded-3xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <label className="text-sm font-extrabold">
                <span className="flex items-center gap-2"><MessageSquareText className="h-4 w-4 text-indigo-600" /> {overtimeMode || changeMode ? 'Lời nhắn kèm yêu cầu' : 'Ghi chú cho quản lý'}</span>
                <textarea value={weekNote} onChange={(event) => setWeekNote(event.target.value)} maxLength={400} className="mobile-field mt-2 min-h-24 py-3" placeholder={changeMode ? 'Ví dụ: em đổi ca sáng thứ Ba sang ca chiều...' : overtimeMode ? 'Ví dụ: em có thể hỗ trợ thêm các ca này...' : 'Ví dụ: tuần này em nghỉ 3 buổi...'} />
              </label>
            </div>
          </>
        )}
      </div>

      {!compactMode && portalReady && createPortal(
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[55] border-t border-slate-200/70 bg-white/95 p-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95 md:bottom-0">
          <div className="mx-auto grid max-w-2xl grid-cols-[.8fr_1.2fr] gap-2">
            <button type="button" onClick={overtimeMode || changeMode ? () => { setSelected(cloneSelection(original)); setWeekNote('') } : editing ? () => void cancelEditing() : saveDraft} disabled={submitting} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 font-bold disabled:opacity-60 dark:border-slate-700">
              {overtimeMode || changeMode || editing ? <RotateCcw className="h-4 w-4" /> : <Save className="h-4 w-4" />} {overtimeMode || changeMode ? 'Chọn lại' : editing ? 'Hủy sửa' : 'Lưu nháp'}
            </button>
            <button type="button" onClick={() => void submitSchedule()} disabled={submitting || ((overtimeMode || changeMode) && ((!overtimeCount && !removedCount && !restoredCount) || (changeMode && removedCount > 0 && !overtimeCount && !restoredCount) || !submittedIds.length))} className="mobile-primary-button disabled:opacity-50">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : overtimeMode || changeMode ? <CalendarPlus className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              {submitting ? 'Đang gửi...' : changeMode ? 'Gửi yêu cầu' : overtimeMode ? `Gửi ${overtimeCount} ca` : editing ? 'Gửi điều chỉnh' : 'Gửi lịch'}
            </button>
          </div>
        </div>,
        document.body
      )}

      {confirmationOpen && (
        <div className="fixed inset-0 z-[75] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setConfirmationOpen(false)}>
          <section className="w-full max-w-lg rounded-t-[2rem] bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl dark:bg-slate-900 sm:rounded-[2rem]" onClick={(event) => event.stopPropagation()}>
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200 sm:hidden" />
            <h2 className="text-xl font-black">Xác nhận lịch tuần</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {missingDays.length === 7
                ? 'Tuần này bạn không làm ca nào, đúng không?'
                : missingDays.length === 1
                  ? `${missingDays[0].name} bạn nghỉ, đúng không?`
                  : `Bạn nghỉ ${missingDays.length} ngày: ${missingDays.map((day) => day.name).join(', ')}, đúng không?`}
            </p>
            {selectedCount < 6 && (
              <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm font-bold leading-6 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                Bạn chỉ đăng ký {selectedCount} ca, dưới mức tối thiểu 6 ca/tuần. Bạn có chắc muốn báo lịch này cho quản lý?
              </p>
            )}
            {weekNote.trim() && <p className="mt-3 rounded-2xl bg-indigo-50 p-3 text-sm text-indigo-900 dark:bg-indigo-500/10 dark:text-indigo-100"><strong>Ghi chú:</strong> {weekNote.trim()}</p>}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setConfirmationOpen(false)} className="min-h-12 rounded-2xl border border-slate-200 font-bold dark:border-slate-700">Xem lại</button>
              <button type="button" onClick={() => void submitSchedule(true)} className="mobile-primary-button">Xác nhận gửi</button>
            </div>
          </section>
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
          <section className="w-full rounded-t-[2rem] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl dark:bg-slate-900 sm:mx-auto sm:mb-4 sm:max-w-lg sm:rounded-[2rem]" onClick={(event) => event.stopPropagation()}>
            <div className="mx-auto max-w-lg">
              <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-300 dark:bg-slate-700" />
              <div className="mb-3 flex items-center justify-between">
                <div><p className="text-xs font-bold uppercase tracking-wider text-rose-600">Lịch trực</p><h2 className="text-xl font-extrabold">Chọn ngày trực</h2></div>
                <button onClick={() => setDutyPickerOpen(false)} className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 dark:bg-slate-800"><X className="h-5 w-5" /></button>
              </div>
              <p className="mb-4 text-sm text-muted-foreground">Vuốt để chọn ngày. Khung giờ cố định 17:00–17:30.</p>
              <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="pointer-events-none absolute inset-x-3 top-16 z-20 h-16 rounded-2xl border border-rose-300 bg-white/75 shadow-sm dark:border-rose-400/40 dark:bg-slate-900/70" />
                <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-gradient-to-b from-slate-50 via-slate-50/90 to-transparent dark:from-slate-800/70 dark:via-slate-800/40" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-16 bg-gradient-to-t from-slate-50 via-slate-50/90 to-transparent dark:from-slate-800/70 dark:via-slate-800/40" />
                <div
                  ref={dutyWheelRef}
                  className="h-48 snap-y snap-mandatory overflow-y-auto overscroll-contain py-16 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  onScroll={(event) => {
                    const index = Math.max(0, Math.min(dutyWheelEntries.length - 1, Math.round(event.currentTarget.scrollTop / DUTY_WHEEL_ROW_HEIGHT)))
                    const item = dutyWheelEntries[index]
                    if (item) setDutyCandidate(item.key)
                  }}
                >
                  {dutyWheelEntries.map((day, index) => {
                    const active = dutyCandidate === day.key
                    return (
                      <button
                        key={`${day.key}-${index}`}
                        type="button"
                        onClick={() => {
                          setDutyCandidate(day.key)
                          dutyWheelRef.current?.scrollTo({ top: index * DUTY_WHEEL_ROW_HEIGHT, behavior: 'smooth' })
                        }}
                        className={`relative z-0 flex h-16 w-full snap-center items-center justify-between px-6 text-left transition duration-200 ${active ? 'scale-[1.02] text-rose-700 dark:text-rose-300' : 'scale-95 text-slate-400 dark:text-slate-500'}`}
                      >
                        <span className="font-extrabold">{day.name}</span>
                        <span className="text-sm font-bold tabular-nums">{day.date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between rounded-2xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800 dark:bg-rose-500/10 dark:text-rose-200">
                <span>{dutyAvailabilityLoading ? 'Đang kiểm tra tổ trực...' : `Tổ đang chọn: ${dutyCandidate ? dutyTeamCount(dutyCandidate) : 0}/${DUTY_TEAM_CAPACITY} người`}</span>
                {!dutyAvailabilityLoading && dutyCandidate && dutyTeamCount(dutyCandidate) > DUTY_TEAM_CAPACITY && <span className="text-rose-600 dark:text-rose-300">Quá tải</span>}
              </div>
              <button type="button" disabled={!dutyCandidate || dutyAvailabilityLoading} onClick={selectDutyCandidate} className="mobile-primary-button mt-3 w-full disabled:opacity-50">
                {dutyAvailabilityLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Xác nhận ngày trực
              </button>
              {dutyDay && <button type="button" onClick={() => { setDutyDay(null); setDutyPickerOpen(false) }} className="mt-3 min-h-11 w-full rounded-2xl text-sm font-bold text-rose-600">Bỏ lịch trực</button>}
            </div>
          </section>
        </div>
      )}

      {dutyOverloadCandidate && (
        <div className="fixed inset-0 z-[65] flex items-end justify-center bg-slate-950/50 p-3 backdrop-blur-sm sm:items-center" onClick={() => setDutyOverloadCandidate(null)}>
          <section role="dialog" aria-modal="true" aria-labelledby="duty-overload-title" className="w-full max-w-sm rounded-[2rem] bg-white p-5 shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-500/10"><AlertTriangle className="h-6 w-6" /></div>
            <p className="mt-4 text-xs font-bold uppercase tracking-wider text-rose-600">Cảnh báo tổ trực</p>
            <h2 id="duty-overload-title" className="mt-1 text-xl font-black">Tổ này đã quá 7 người</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {days.find((day) => day.key === dutyOverloadCandidate)?.name} sẽ có {dutyTeamCount(dutyOverloadCandidate)} người trực. Bạn vẫn có thể chọn, nhưng quản lý sẽ thấy cảnh báo quá tải.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => { setDutyCandidate(dutyOverloadCandidate); setDutyOverloadCandidate(null); setDutyPickerOpen(true) }} className="min-h-12 rounded-2xl border border-slate-200 text-sm font-bold dark:border-slate-700">Chọn ngày khác</button>
              <button type="button" onClick={() => { setDutyDay(dutyOverloadCandidate); setDutyOverloadCandidate(null) }} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-rose-600 px-3 text-sm font-bold text-white"><Check className="h-4 w-4" /> Vẫn chọn</button>
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
