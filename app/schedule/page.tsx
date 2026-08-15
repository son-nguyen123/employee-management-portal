'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  AlertTriangle,
  Clock3,
  Download,
  Loader2,
  PartyPopper,
  RotateCcw,
  Save,
  Send,
  MessageSquareText,
  ExternalLink,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import {
  replaceWorkSchedules,
  setWorkScheduleBatchEditing,
  hasEmployeeSchedules,
  getDutyAvailability,
  ensureFixedSchedule,
  subscribeToSchedulesByDateRange,
  submitWorkSchedules,
} from '@/lib/services/scheduleService'
import { addPreviewSchedules, getPreviewSchedules, updatePreviewSchedule } from '@/lib/services/previewWorkflow'
import type { WorkSchedule } from '@/lib/models/types'
import { Header } from '@/components/layout/header'
import { Badge } from '@/components/ui/badge'
import { getManagementContact } from '@/lib/services/managementSettingsService'
import { toMessengerUrl } from '@/lib/utils/messenger'
import { scheduleShareText } from '@/lib/archive/retention'
import { submitStaffRequest } from '@/lib/services/staffRequestService'
import { subscribeToEmployeePenalties } from '@/lib/services/penaltyService'
import type { Penalty } from '@/lib/models/types'
import { isManagementScheduleRole, isPastRegistrationDate, registrationTargetsNextWeek } from '@/lib/schedule/registration-policy'

type Shift = 'Morning' | 'Afternoon' | 'Evening' | 'Custom'
type DayItem = { key: string; name: string; shortName: string; date: Date }
type CustomShift = { start: string; end: string }
type Selection = Record<string, Shift[]>
type EditBaseline = {
  selected: Selection
  customData: Record<string, CustomShift>
  dutyDay: string | null
  weekNote: string
}

const DUTY_TEAM_CAPACITY = 7
const shiftOptions: { value: Shift; label: string; shortLabel: string; time: string }[] = [
  { value: 'Morning', label: 'Ca sáng', shortLabel: 'sáng', time: '07:30–11:30' },
  { value: 'Afternoon', label: 'Ca chiều', shortLabel: 'chiều', time: '13:00–17:00' },
  { value: 'Evening', label: 'Ca tối', shortLabel: 'tối', time: '18:00–22:00' },
  { value: 'Custom', label: 'Tăng ca', shortLabel: 'tăng ca', time: 'Tự chọn giờ' },
]

const shiftDisplayOrder: Shift[] = ['Morning', 'Afternoon', 'Custom', 'Evening']

const orderedShifts = (shifts: Shift[]) => [...shifts].sort((left, right) => shiftDisplayOrder.indexOf(left) - shiftDisplayOrder.indexOf(right))

const customShiftLabel = (shift?: CustomShift) => `Ca ${shift?.start || '08:00'}–${shift?.end || '17:00'}`

const shiftTextClass = (shift: Shift) => shift === 'Morning'
  ? 'font-bold text-emerald-600 dark:text-emerald-400'
  : shift === 'Afternoon'
    ? 'font-bold text-orange-500 dark:text-orange-400'
    : shift === 'Evening'
      ? 'font-bold text-rose-600 dark:text-rose-400'
      : 'font-bold text-violet-600 dark:text-violet-400'

const timeOptions = Array.from({ length: 96 }, (_, index) => {
  const hour = Math.floor(index / 4)
  const minute = (index % 4) * 15
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
})

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

const valueDate = (value?: WorkSchedule['createdAt']) =>
  value ? (value instanceof Date ? value : value.toDate()) : null

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
  const [submittedPenaltyAmount, setSubmittedPenaltyAmount] = useState(0)
  const [submittedPenaltyId, setSubmittedPenaltyId] = useState<string | null>(null)
  const [employeePenalties, setEmployeePenalties] = useState<Penalty[]>([])
  const [submittedEditDeadline, setSubmittedEditDeadline] = useState<Date | null>(null)
  const [editing, setEditing] = useState(false)
  const [editingOriginStatus, setEditingOriginStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [celebrating, setCelebrating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [weekNote, setWeekNote] = useState('')
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const [latePenaltyConfirmationOpen, setLatePenaltyConfirmationOpen] = useState(false)
  const [overtimeMode, setOvertimeMode] = useState(false)
  const [changeMode, setChangeMode] = useState(false)
  const [currentWeekMode, setCurrentWeekMode] = useState(false)
  const [originalScheduleIds, setOriginalScheduleIds] = useState<Record<string, string>>({})
  const [returnableLeaveShifts, setReturnableLeaveShifts] = useState<Record<string, string>>({})
  const [submittedChangeSummary, setSubmittedChangeSummary] = useState<{ removed: string[]; added: string[]; restored: string[] } | null>(null)
  const [editBaseline, setEditBaseline] = useState<EditBaseline | null>(null)
  const [hasExistingSchedules, setHasExistingSchedules] = useState<boolean | null>(null)
  const [referenceNow] = useState(() => Date.now())
  const [clockNow, setClockNow] = useState(referenceNow)
  const [portalReady, setPortalReady] = useState(false)
  useEffect(() => {
    if (!authUser || isPreviewMode) {
      setEmployeePenalties([])
      return
    }
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - 14)
    startDate.setHours(0, 0, 0, 0)
    const endDate = new Date()
    endDate.setDate(endDate.getDate() + 14)
    endDate.setHours(23, 59, 59, 999)
    return subscribeToEmployeePenalties(
      authUser.uid,
      setEmployeePenalties,
      () => setEmployeePenalties([]),
      { startDate, endDate },
    )
  }, [authUser, isPreviewMode])

  useEffect(() => {
    if (!submittedPenaltyId || submittedPenaltyAmount > 0) return
    const penalty = employeePenalties.find((item) => item.id === submittedPenaltyId && item.status !== 'Cancelled')
    if (penalty) setSubmittedPenaltyAmount(Number(penalty.amount || 0))
  }, [employeePenalties, submittedPenaltyAmount, submittedPenaltyId])

  useEffect(() => setPortalReady(true), [])

  useEffect(() => {
    if (!submittedEditDeadline) return
    const remaining = submittedEditDeadline.getTime() - referenceNow
    if (remaining <= 0) {
      setClockNow(submittedEditDeadline.getTime())
      return
    }
    const timeout = window.setTimeout(() => setClockNow(submittedEditDeadline.getTime()), remaining)
    return () => window.clearTimeout(timeout)
  }, [referenceNow, submittedEditDeadline])

  const modalLayerOpen = Boolean(latePenaltyConfirmationOpen || confirmationOpen || dutyPickerOpen || dutyOverloadCandidate || customFor)
  useEffect(() => {
    if (!modalLayerOpen) return
    const body = document.body
    const scrollY = window.scrollY
    const previous = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    }
    body.classList.add('modal-layer-open')
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
    body.style.overflow = 'hidden'
    return () => {
      body.classList.remove('modal-layer-open')
      body.style.position = previous.position
      body.style.top = previous.top
      body.style.width = previous.width
      body.style.overflow = previous.overflow
      window.scrollTo(0, scrollY)
    }
  }, [modalLayerOpen])

  useEffect(() => {
    const mode = new URLSearchParams(window.location.search).get('mode')
    const week = new URLSearchParams(window.location.search).get('week')
    const weekday = new Date().getDay()
    setOvertimeMode(mode === 'overtime')
    setChangeMode(mode === 'change')
    setCurrentWeekMode(mode === 'change' ? weekday !== 0 : week === 'current' && weekday >= 1 && weekday <= 4)
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
    void hasEmployeeSchedules(authUser.uid)
      .then((hasSchedules) => setHasExistingSchedules(hasSchedules))
      .catch(() => setHasExistingSchedules(false))
  }, [authUser, isPreviewMode])

  const managementSchedule = isManagementScheduleRole(employee?.role)
  const fixedScheduleOwner = managementSchedule || (employee?.role === 'employee' && employee.scheduleMode === 'fixed')
  const isNewEmployee = !managementSchedule && employee?.hasSubmittedSchedule !== true && hasExistingSchedules === false && !overtimeMode && !changeMode

  const currentWeekKey = useMemo(() => {
    const now = new Date(referenceNow)
    const weekday = now.getDay() || 7
    now.setDate(now.getDate() - weekday + 1)
    now.setHours(0, 0, 0, 0)
    return localDateKey(now)
  }, [referenceNow])
  const reactivationWaiverWeekActive = employee?.reactivationScheduleWaiverWeekStart === currentWeekKey

  const days = useMemo<DayItem[]>(() => {
    const now = new Date()
    const currentDay = now.getDay()
    const regularRegistration = !overtimeMode && !changeMode
    const useCurrentWeek = currentWeekMode || (regularRegistration && (reactivationWaiverWeekActive || !registrationTargetsNextWeek(currentDay || 7)))
    const daysUntilNextMonday = useCurrentWeek
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
  }, [changeMode, currentWeekMode, overtimeMode, reactivationWaiverWeekActive])

  const targetIsCurrentWeek = useMemo(() => {
    if (!days.length) return false
    const now = new Date()
    const weekday = now.getDay() || 7
    const monday = new Date(now)
    monday.setDate(now.getDate() - weekday + 1)
    monday.setHours(0, 0, 0, 0)
    return days[0].key === localDateKey(monday)
  }, [days])

  const reactivationWaiverActive = reactivationWaiverWeekActive && targetIsCurrentWeek
  const restrictPastRegistration = !managementSchedule && targetIsCurrentWeek && !isNewEmployee && employee?.scheduleMode !== 'fixed'
  const todayKey = localDateKey(new Date(referenceNow))
  const isPastRegistrationDay = useCallback(
    (dayKey: string) => isPastRegistrationDate(dayKey, todayKey, restrictPastRegistration),
    [restrictPastRegistration, todayKey]
  )

  useEffect(() => {
    if (!authUser || isPreviewMode || (!managementSchedule && employee?.scheduleMode !== 'fixed') || !days.length) return
    void ensureFixedSchedule(days[0].key).catch(() => undefined)
  }, [authUser, days, employee?.scheduleMode, isPreviewMode, managementSchedule])

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

  const selectDutyCandidate = () => {
    if (!dutyCandidate) return
    if (isPastRegistrationDay(dutyCandidate) && dutyDay !== dutyCandidate) {
      setDutyPickerOpen(false)
      setMessage('Bạn chỉ được đăng ký lịch từ hôm nay đến Chủ Nhật. Ngày trực này đã khóa.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    if (dutyTeamCount(dutyCandidate) > DUTY_TEAM_CAPACITY) {
      setDutyPickerOpen(false)
      setDutyOverloadCandidate(dutyCandidate)
      return
    }
    setDutyDay(dutyCandidate)
    setDutyPickerOpen(false)
  }

  useEffect(() => {
    if (!authUser) return
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
              custom[key] = { start: customMatch[1], end: customMatch[2] }
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
          const loadedPenalty = current.find((item) => item.penaltyId || Number(item.penaltyAmount || 0) > 0)
          setSubmittedPenaltyId(loadedPenalty?.penaltyId || null)
          setSubmittedPenaltyAmount(Math.max(0, ...current.map((item) => Number(item.penaltyAmount || 0))))
          setSubmittedEditDeadline(valueDate(current[0]?.editDeadlineAt))
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
          setSubmittedPenaltyId(null)
          setSubmittedPenaltyAmount(0)
          setSubmittedEditDeadline(null)
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
  }, [authUser, days, isPreviewMode, overtimeMode, changeMode])

  const chooseShift = (dayKey: string, shift: Shift) => {
    if (isPastRegistrationDay(dayKey) && !original[dayKey]?.includes(shift)) {
      setMessage('Bạn chỉ được đăng ký lịch từ hôm nay đến Chủ Nhật. Ngày này đã khóa.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    if (overtimeMode && original[dayKey]?.includes(shift)) return
    if (shift === 'Custom') {
      setCustomFor(dayKey)
      setCustomData((prev) => ({
        ...prev,
        [dayKey]: prev[dayKey] || { start: '08:00', end: '17:00' },
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
    if (!item?.start || !item?.end || item.end <= item.start) return
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
        date: new Date(`${restrictPastRegistration ? todayKey : days[0].key}T12:00:00`),
        shift: 'Morning',
        status: 'Pending',
        note: '[NO_SHIFTS]',
      })
    }
    if (weekNote.trim()) rows[0].note = `${rows[0].note} [WEEK_NOTE] ${weekNote.trim()}`.trim()
    return rows
  }

  const submitSchedule = async (confirmed = false, lateConfirmed = false) => {
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
          .filter((shift) => !original[dayKey]?.includes(shift) && (shift === 'Custom' || !returnableLeaveShifts[`${dayKey}-${shift}`]))
          .map((shift) => shift === 'Custom'
            ? {
                date: new Date(`${dayKey}T12:00:00`),
                shift: 'Morning' as const,
                note: `[CUSTOM:${customData[dayKey]?.start || '08:00'}-${customData[dayKey]?.end || '17:00'}]`,
              }
            : { date: new Date(`${dayKey}T12:00:00`), shift })
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
      if (changeMode && removedShifts.length && !requestedShifts.length && !restoredShifts.length && !fixedScheduleOwner) {
        setMessage('Chỉ người có lịch cố định mới được xin nghỉ ca mà không chọn ca thay thế.')
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
          const describe = (item: { date: Date; shift: Exclude<Shift, 'Custom'>; note?: string }) => {
            const day = days.find((candidate) => candidate.key === localDateKey(item.date))
            const customMatch = item.note?.match(/\[CUSTOM:(\d{2}:\d{2})-(\d{2}:\d{2})\]/)
            const shift = customMatch
              ? `Tăng ca ${customMatch[1]}–${customMatch[2]}`
              : shiftOptions.find((candidate) => candidate.value === item.shift)?.label || item.shift
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
    if (!confirmed && lateScheduleWarning && !lateConfirmed) {
      setLatePenaltyConfirmationOpen(true)
      return
    }
    if (!confirmed && missingDays.length) {
      setConfirmationOpen(true)
      return
    }
    setLatePenaltyConfirmationOpen(false)
    setConfirmationOpen(false)
    setSubmitting(true)
    setMessage(null)
    try {
      const rows = payload()
      let ids: string[]
      let editDeadlineAt: Date | null = null
      let penaltyAmount = 0
      if (isPreviewMode) {
        if (submittedIds.length) {
          const existing = getPreviewSchedules().filter((item) => !submittedIds.includes(item.id))
          window.sessionStorage.setItem('employee-portal-preview-schedules', JSON.stringify(existing))
        }
        const previewRows = rows.map((row, index) => ({
          id: `preview-${Date.now()}-${index}`,
          employeeId: authUser.uid,
          employeeName: authUser.displayName || 'Nguyễn Minh An',
          employeeCode: '001',
          phone: '0901 234 567',
          facebookUrl: 'https://facebook.com/',
          date: (row.date as Date).toISOString(),
          shift: row.shift,
          status: 'Approved' as const,
          note: row.note,
          weeklyShiftCount: selectedCount,
          underMinimumWarning: !managementSchedule && selectedCount < 6,
          autoApproved: true,
          fixedSchedule: managementSchedule || employee?.scheduleMode === 'fixed',
          reviewedAt: new Date().toISOString(),
        }))
        addPreviewSchedules(previewRows)
        ids = previewRows.map((item) => item.id)
        editDeadlineAt = new Date(referenceNow + 24 * 60 * 60 * 1000)
      } else {
        const result = submittedIds.length
          ? await replaceWorkSchedules(submittedIds, rows)
          : await submitWorkSchedules(rows, confirmed)
        ids = result.ids
        editDeadlineAt = new Date(result.editDeadlineAt)
        penaltyAmount = result.penalty || (submittedIds.length ? submittedPenaltyAmount : 0)
      }
      window.sessionStorage.removeItem('schedule-draft')
      setSubmittedIds(ids)
      setSubmittedStatus('Approved')
      setSubmittedPenaltyAmount(penaltyAmount)
      setSubmittedPenaltyId(submittedIds.length ? submittedPenaltyId : null)
      setSubmittedEditDeadline(editDeadlineAt)
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
      setMessage(managementSchedule
        ? `Đã xác nhận lịch ${selectedCount} ca. Nếu không thay đổi, lịch này sẽ tự hiển thị lại cho tuần kế tiếp.`
        : penaltyAmount > 0
        ? `Đã xác nhận lịch ${selectedCount} ca. Khoản phạt đăng ký trễ ${penaltyAmount.toLocaleString('vi-VN')}đ đã được ghi nhận.`
        : selectedCount < 6
        ? `Đã xác nhận lịch ${selectedCount}/6 ca. Hệ thống đã duyệt và đánh dấu màu vàng để quản lý lưu ý.`
        : `Đã xác nhận lịch ${selectedCount} ca. Hệ thống đã tự động duyệt.`)
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
      setMessage('Bạn đang sửa bảng lịch. Bản đã xác nhận vẫn được giữ cho tới khi bạn xác nhận điều chỉnh.')
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

  const customDay = days.find((day) => day.key === customFor)
  const customTimeInvalid = Boolean(customFor && customData[customFor] && customData[customFor].end <= customData[customFor].start)
  const selectedCount = Object.values(selected).reduce((total, shifts) => total + shifts.length, 0)
  const overtimeCount = Object.entries(selected).reduce((total, [dayKey, selectedShifts]) =>
    total + selectedShifts.filter((shift) => !original[dayKey]?.includes(shift) && !returnableLeaveShifts[`${dayKey}-${shift}`]).length, 0)
  const restoredCount = Object.entries(selected).reduce((total, [dayKey, selectedShifts]) =>
    total + selectedShifts.filter((shift) => Boolean(returnableLeaveShifts[`${dayKey}-${shift}`])).length, 0)
  const removedCount = Object.entries(original).reduce((total, [dayKey, originalShifts]) =>
    total + originalShifts.filter((shift) => !selected[dayKey]?.includes(shift)).length, 0)
  const missingDays = managementSchedule ? [] : days.filter((day) => !isPastRegistrationDay(day.key) && !selected[day.key]?.length && dutyDay !== day.key)
  const compactMode = submittedIds.length > 0 && !editing && !overtimeMode && !changeMode
  const canEditStatus = ['Pending', 'Rejected', 'Approved'].includes(submittedStatus || '')
  const editWindowOpen = !submittedEditDeadline || clockNow < submittedEditDeadline.getTime()
  const canEdit = canEditStatus && editWindowOpen
  const lateScheduleWarning = !managementSchedule && !overtimeMode && !changeMode && !editing && !submittedIds.length && targetIsCurrentWeek && !isNewEmployee && !reactivationWaiverActive && employee?.scheduleMode !== 'fixed'
  const scheduleWeekEnd = new Date(days[days.length - 1]?.date || days[0]?.date || new Date())
  scheduleWeekEnd.setHours(23, 59, 59, 999)
  const fallbackSchedulePenalty = employeePenalties.find((item) => {
    if (item.status === 'Cancelled' || item.sourceType !== 'scheduleSubmission') return false
    const penaltyDate = item.penaltyDate instanceof Date ? item.penaltyDate : item.penaltyDate.toDate()
    return penaltyDate >= (days[0]?.date || new Date(0)) && penaltyDate <= scheduleWeekEnd
  })
  const effectivePenaltyAmount = managementSchedule ? 0 : submittedPenaltyAmount || Number(fallbackSchedulePenalty?.amount || 0)
  const schedulePenaltyActive = effectivePenaltyAmount > 0
  const latePenaltyDisplayAmount = Number(process.env.NEXT_PUBLIC_PENALTY_LATE_SCHEDULE_AMOUNT || 1000)

  const downloadSchedule = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      // Keep the exported bitmap compact enough for Messenger's preview width.
      // A very wide canvas makes Messenger scale the whole schedule down,
      // which makes otherwise readable shift labels look tiny.
      const scale = 2
      const width = 640
      const visibleDays = days.filter((day) => selected[day.key]?.length || dutyDay === day.key)
      const rowHeight = 116
      const headerHeight = 150
      const summaryHeight = 110
      const footerHeight = 48
      const height = Math.max(500, headerHeight + summaryHeight + Math.max(1, visibleDays.length) * rowHeight + footerHeight)
      const canvas = document.createElement('canvas')
      canvas.width = width * scale
      canvas.height = height * scale
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Thiết bị chưa hỗ trợ xuất ảnh lịch.')
      context.scale(scale, scale)
      context.textBaseline = 'middle'

      const roundedRect = (x: number, y: number, boxWidth: number, boxHeight: number, radius: number, fill: string | CanvasGradient, stroke?: string) => {
        const safeRadius = Math.min(radius, boxWidth / 2, boxHeight / 2)
        context.beginPath()
        context.moveTo(x + safeRadius, y)
        context.lineTo(x + boxWidth - safeRadius, y)
        context.quadraticCurveTo(x + boxWidth, y, x + boxWidth, y + safeRadius)
        context.lineTo(x + boxWidth, y + boxHeight - safeRadius)
        context.quadraticCurveTo(x + boxWidth, y + boxHeight, x + boxWidth - safeRadius, y + boxHeight)
        context.lineTo(x + safeRadius, y + boxHeight)
        context.quadraticCurveTo(x, y + boxHeight, x, y + boxHeight - safeRadius)
        context.lineTo(x, y + safeRadius)
        context.quadraticCurveTo(x, y, x + safeRadius, y)
        context.closePath()
        context.fillStyle = fill
        context.fill()
        if (stroke) {
          context.strokeStyle = stroke
          context.lineWidth = 2
          context.stroke()
        }
      }
      const text = (value: string, x: number, y: number, font: string, fill: string, align: CanvasTextAlign = 'left') => {
        context.font = font
        context.fillStyle = fill
        context.textAlign = align
        context.fillText(value, x, y)
      }
      const shiftLabel = (shift: Shift) => shift === 'Morning' ? 'sáng' : shift === 'Afternoon' ? 'chiều' : shift === 'Evening' ? 'tối' : 'ca riêng'
      const shiftTextColor = (shift: Shift) => shift === 'Morning' ? '#059669' : shift === 'Afternoon' ? '#f97316' : shift === 'Evening' ? '#e11d48' : '#7c3aed'

      context.fillStyle = '#eef2ff'
      context.fillRect(0, 0, width, height)
      roundedRect(18, 18, width - 36, height - 36, 34, '#ffffff', '#dbe4ff')
      const headerGradient = context.createLinearGradient(18, 18, width - 18, 18)
      headerGradient.addColorStop(0, '#4f46e5')
      headerGradient.addColorStop(1, '#7c3aed')
      roundedRect(18, 18, width - 36, headerHeight, 34, headerGradient)
      context.fillStyle = headerGradient
      context.fillRect(18, 52, width - 36, headerHeight - 52)
      text('BẢNG ĐĂNG KÝ TUẦN', 44, 48, '700 16px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif', '#c7d2fe')
      text('Lịch làm của bạn', 44, 86, '800 30px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif', '#ffffff')
      const statusText = submittedStatus === 'Approved' ? 'Đã xác nhận' : submittedStatus === 'Rejected' ? 'Bị từ chối' : submittedStatus === 'Cancelled' ? 'Đã hủy' : 'Đang đồng bộ'
      context.font = '700 18px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
      const statusWidth = Math.max(132, context.measureText(statusText).width + 34)
      roundedRect(width - statusWidth - 38, 50, statusWidth, 44, 22, '#d1fae5')
      text(statusText, width - statusWidth / 2 - 38, 72, '700 18px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif', '#047857', 'center')
      if (schedulePenaltyActive) {
        const penaltyText = `Trừ ${effectivePenaltyAmount.toLocaleString('vi-VN')}đ`
        context.font = '800 15px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
        const penaltyWidth = Math.max(116, context.measureText(penaltyText).width + 28)
        roundedRect(width - penaltyWidth - 38, 102, penaltyWidth, 28, 14, '#ffe4e6')
        text(penaltyText, width - penaltyWidth / 2 - 38, 116, '800 15px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif', '#be123c', 'center')
      }

      const summaryY = headerHeight + 16
      roundedRect(32, summaryY, width - 64, 86, 18, '#f8fafc')
      context.beginPath()
      context.arc(62, summaryY + 43, 23, 0, Math.PI * 2)
      context.fillStyle = '#e0e7ff'
      context.fill()
      text('▦', 62, summaryY + 44, '700 27px sans-serif', '#4f46e5', 'center')
      text(selectedCount ? 'Các ngày đã đăng ký' : 'Nghỉ cả tuần', 98, summaryY + 33, '800 20px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif', '#0f172a')
      text(selectedCount ? `${visibleDays.length} ngày · ${selectedCount} ca${dutyDay ? ' · có lịch trực' : ''}` : 'Không đăng ký ca nào trong tuần này', 98, summaryY + 61, '500 15px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif', '#64748b')

      let rowY = summaryY + summaryHeight
      if (!visibleDays.length) {
        roundedRect(32, rowY + 10, width - 64, rowHeight - 20, 16, '#f8fafc')
        text('Tuần này bạn không đăng ký ca nào', width / 2, rowY + 48, '700 18px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif', '#334155', 'center')
      } else {
        visibleDays.forEach((day) => {
          const dayShifts = selected[day.key] || []
          const dayLabel = `${day.name} (${day.date.getDate()}/${day.date.getMonth() + 1})`
          context.beginPath()
          context.arc(62, rowY + rowHeight / 2, 25, 0, Math.PI * 2)
          context.fillStyle = '#eef2ff'
          context.fill()
          text(day.shortName, 62, rowY + rowHeight / 2, '800 16px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif', '#4f46e5', 'center')
          text(dayLabel, 108, rowY + 38, '800 25px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif', '#0f172a')
          const labels = orderedShifts(dayShifts).map((shift) => ({
            label: shift === 'Custom'
              ? customShiftLabel(customData[day.key])
              : shiftLabel(shift),
            color: shiftTextColor(shift),
          }))
          if (dutyDay === day.key) labels.push({ label: 'trực 17:00–17:30', color: '#e11d48' })
          if (!labels.length) labels.push({ label: 'Không đăng ký ca', color: '#64748b' })
          let labelX = 108
          let labelY = rowY + 76
          labels.forEach((item, index) => {
            context.font = '600 21px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
            const separator = index > 0 ? ' · ' : ''
            const segmentWidth = context.measureText(`${separator}${item.label}`).width
            if (labelX > 108 && labelX + segmentWidth > width - 34) {
              labelX = 108
              labelY += 25
            }
            if (separator) {
              text(separator, labelX, labelY, '500 21px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif', '#cbd5e1')
              labelX += context.measureText(separator).width
            }
            text(item.label, labelX, labelY, '600 21px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif', item.color)
            labelX += context.measureText(item.label).width
          })
          context.strokeStyle = '#e2e8f0'
          context.lineWidth = 1
          context.beginPath()
          context.moveTo(32, rowY + rowHeight - 1)
          context.lineTo(width - 32, rowY + rowHeight - 1)
          context.stroke()
          rowY += rowHeight
        })
      }
      text(`Tri Candy · ${days[0]?.key || localDateKey(new Date())}`, 32, height - 24, '500 12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif', '#94a3b8')

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Chưa thể tạo ảnh lịch.')
      const filename = `lich-lam-${days[0]?.key || localDateKey(new Date())}.png`
      const file = new File([blob], filename, { type: 'image/png' })
      const shareText = scheduleShareText({
        fullName: employee?.fullName,
        employeeCode: employee?.employeeCode,
        weekStart: days[0]?.date || new Date(),
        weekEnd: days.at(-1)?.date || days[0]?.date || new Date(),
      })
      const shareNavigator = navigator as Navigator & {
        canShare?: (data?: { files?: File[] }) => boolean
        share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>
      }
      if (shareNavigator.share && shareNavigator.canShare?.({ files: [file] })) {
        await shareNavigator.share({ files: [file], title: 'Lịch làm của bạn', text: shareText })
        setMessage('Đã mở bảng chia sẻ cùng lời giới thiệu tên và mã nhân viên.')
      } else {
        await navigator.clipboard?.writeText(shareText).catch(() => undefined)
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = filename
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 1500)
        setMessage('Đã tải ảnh lịch và sao chép lời giới thiệu để bạn dán khi gửi.')
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setMessage(error instanceof Error ? error.message : 'Chưa thể tải ảnh lịch về máy.')
    } finally {
      setDownloading(false)
    }
  }

  if (loading) {
    return <main className="grid min-h-screen place-items-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></main>
  }

  return (
    <main className="min-h-screen pb-32">
      <Header title={changeMode ? 'Đổi / thêm ca' : overtimeMode ? 'Xin làm thêm' : 'Đăng ký lịch làm'} subtitle={`${isNewEmployee ? 'Lịch dành cho nhân viên mới' : targetIsCurrentWeek ? 'Tuần hiện tại' : 'Tuần kế tiếp'} · ${days[0].name} đến ${days[days.length - 1].name}`} />
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
              <p className="text-xs font-semibold text-indigo-100">{isNewEmployee ? 'Lịch dành cho nhân viên mới' : targetIsCurrentWeek ? 'Lịch tuần này' : 'Lịch tuần sau'}</p>
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
        {reactivationWaiverActive && !submittedIds.length && (
          <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold leading-6 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
            Tuần mở lại tài khoản: không trừ phí đăng ký muộn · chỉ chọn từ hôm nay đến Chủ Nhật.
          </div>
        )}
        {lateScheduleWarning && (
          <div className="mb-4 flex items-start gap-3 rounded-3xl border border-rose-200 bg-rose-50 p-4 text-rose-900 shadow-sm dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-300" />
            <div className="text-sm leading-6"><p className="font-extrabold">Đăng ký lịch tuần này đã trễ hạn</p><p className="mt-1">Nếu bạn xác nhận, hệ thống sẽ ghi nhận khoản phạt đăng ký trễ <strong>{latePenaltyDisplayAmount.toLocaleString('vi-VN')}đ</strong>. Nếu đang nghỉ bệnh, bạn có thể liên hệ quản lý và chờ đến Thứ Sáu để nhập lịch tuần sau.</p></div>
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
              {changeMode && <p className="mt-3 rounded-xl bg-amber-50 p-2 font-semibold text-amber-800">{managementSchedule ? 'Tài khoản quản lý không bị trừ tiền khi điều chỉnh lịch.' : fixedScheduleOwner ? 'Có thể chọn bỏ ca cố định để nghỉ trong tuần này hoặc thêm ca khác. Hủy ca hôm nay bị phạt 1.000đ.' : 'Hủy ca của hôm nay bị phạt 1.000đ. Đổi từ ngày mai hoặc chỉ đăng ký thêm ca thì không bị phạt.'}</p>}
            </div>
          </details>
        )}

        {compactMode ? (
          <section className={`schedule-summary overflow-hidden rounded-[1.75rem] border-2 bg-white shadow-lg shadow-indigo-950/5 dark:bg-slate-900 ${schedulePenaltyActive ? 'border-rose-500 animate-penalty-pulse dark:border-rose-400' : 'border-indigo-100 dark:border-indigo-500/20'}`}>
            <div className="bg-gradient-to-r from-indigo-600 to-violet-600 p-4 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-indigo-100">Bảng đăng ký tuần</p>
                  <h2 className="mt-1 text-lg font-extrabold">Lịch làm của bạn</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => void downloadSchedule()} disabled={downloading} aria-label="Tải ảnh lịch về máy" title="Tải ảnh lịch về máy" className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 text-white transition hover:bg-white/25 active:scale-95 disabled:cursor-wait disabled:opacity-70">
                    {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  </button>
                  <Badge variant={submittedStatus === 'Approved' ? 'success' : submittedStatus === 'Rejected' ? 'destructive' : submittedStatus === 'Cancelled' ? 'outline' : 'warning'}>
                    {submittedStatus === 'Approved'
                      ? 'Đã xác nhận'
                      : submittedStatus === 'Rejected'
                        ? 'Bị từ chối'
                        : submittedStatus === 'Cancelled'
                          ? 'Đã hủy'
                          : 'Đang đồng bộ'}
                  </Badge>
                </div>
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
                      ? <>{days.filter((day) => selected[day.key]?.length).length} ngày · {selectedCount} ca{dutyDay ? ' · có lịch trực' : ''}{schedulePenaltyActive && <span className="ml-1 font-black text-rose-600">· Trừ {effectivePenaltyAmount.toLocaleString('vi-VN')}đ</span>}</>
                      : 'Không đăng ký ca làm nào trong tuần này'}
                  </p>
                </div>
              </div>
              <div className="divide-y divide-slate-100 border-t border-slate-100 px-2 dark:divide-white/10 dark:border-white/10">
                {!selectedCount && (
                  <div className="m-2 rounded-2xl bg-slate-50 px-4 py-4 text-center dark:bg-slate-800">
                    <p className="font-extrabold">Tuần này bạn không đăng ký ca nào</p>
                    <p className="mt-1 text-xs text-muted-foreground">Bảng nghỉ cả tuần đã được hệ thống xác nhận và đánh dấu cần lưu ý.</p>
                  </div>
                )}
                {days.filter((day) => selected[day.key]?.length || dutyDay === day.key).map((day) => (
                  <div key={day.key} className="flex gap-3 px-3 py-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-xs font-black text-indigo-600 dark:bg-indigo-500/10">{day.shortName}</div>
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold">{day.name} ({day.date.toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric' })})</p>
                      <p className="mt-0.5 text-sm">
                        {orderedShifts(selected[day.key] || []).map((shift, index) => (
                          <Fragment key={shift}>
                            {index > 0 && <span className="mx-1 text-slate-300">·</span>}
                            <span className={shiftTextClass(shift)}>{shift === 'Custom' ? customShiftLabel(customData[day.key]) : shiftOptions.find((item) => item.value === shift)?.shortLabel}</span>
                          </Fragment>
                        ))}
                        {dutyDay === day.key && <span className="font-bold text-rose-600">{selected[day.key]?.length ? <span className="mx-1 text-slate-300">·</span> : ''}trực 17:00–17:30</span>}
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
              <div className="m-4 mt-2 grid gap-2">
                <button type="button" onClick={() => void startEditing()} disabled={submitting} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 font-bold text-indigo-700 disabled:opacity-60 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <SlidersHorizontal className="h-4 w-4" />} Điều chỉnh
                </button>
              </div>
            )}
            {canEditStatus && !editWindowOpen && (
              <div className="mx-4 mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-center text-xs font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                Lịch đã qua hạn điều chỉnh và được khóa.
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
                  <div className="grid grid-cols-2 gap-2">
                    {shiftOptions.map((shift) => {
                      const today = new Date()
                      today.setHours(0, 0, 0, 0)
                      const isPastDay = changeMode && day.date < today
                      const registrationLocked = isPastRegistrationDay(day.key) && !original[day.key]?.includes(shift.value)
                      const active = selected[day.key]?.includes(shift.value)
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
                          aria-disabled={registrationLocked}
                          className={`min-h-[58px] rounded-2xl border px-3 text-left transition active:scale-[0.98] ${registrationLocked
                            ? 'border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-500'
                            :
                            active ? activeClass : returnable ? 'border-rose-400 bg-rose-50 text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-200' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800'
                          } disabled:cursor-not-allowed disabled:active:scale-100`}
                        >
                          <span className="flex items-center justify-between text-sm font-bold">{shift.label}{registrationLocked ? <span className="text-[10px]">Đã khóa</span> : active ? <Check className="h-4 w-4" /> : returnable ? <span className="text-[10px]">Đã nghỉ · chạm để đi làm lại</span> : null}</span>
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
            {(overtimeMode || changeMode) && <div className="mt-4 grid gap-3 rounded-3xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <label className="text-sm font-extrabold">
                <span className="flex items-center gap-2"><MessageSquareText className="h-4 w-4 text-indigo-600" /> {overtimeMode || changeMode ? 'Lời nhắn kèm yêu cầu' : 'Ghi chú cho quản lý'}</span>
                <textarea value={weekNote} onChange={(event) => setWeekNote(event.target.value)} maxLength={400} className="mobile-field mt-2 min-h-24 py-3" placeholder={changeMode ? 'Ví dụ: em đổi ca sáng thứ Ba sang ca chiều...' : overtimeMode ? 'Ví dụ: em có thể hỗ trợ thêm các ca này...' : 'Ví dụ: tuần này em nghỉ 3 buổi...'} />
              </label>
            </div>}
          </>
        )}
      </div>

      {!compactMode && !modalLayerOpen && portalReady && createPortal(
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[55] border-t border-slate-200/70 bg-white/95 p-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95 md:bottom-0">
          <div className="mx-auto grid max-w-2xl grid-cols-[.8fr_1.2fr] gap-2">
            <button type="button" onClick={overtimeMode || changeMode ? () => { setSelected(cloneSelection(original)); setWeekNote('') } : editing ? () => void cancelEditing() : saveDraft} disabled={submitting} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 font-bold disabled:opacity-60 dark:border-slate-700">
              {overtimeMode || changeMode || editing ? <RotateCcw className="h-4 w-4" /> : <Save className="h-4 w-4" />} {overtimeMode || changeMode ? 'Chọn lại' : editing ? 'Hủy sửa' : 'Lưu nháp'}
            </button>
            <button type="button" onClick={() => void submitSchedule()} disabled={submitting || ((overtimeMode || changeMode) && ((!overtimeCount && !removedCount && !restoredCount) || (changeMode && removedCount > 0 && !overtimeCount && !restoredCount && !fixedScheduleOwner) || !submittedIds.length))} className="mobile-primary-button disabled:opacity-50">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : overtimeMode || changeMode ? <CalendarPlus className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              {submitting ? 'Đang xác nhận...' : changeMode ? 'Gửi yêu cầu' : overtimeMode ? `Gửi ${overtimeCount} ca` : editing ? 'Xác nhận điều chỉnh' : 'Xác nhận lịch'}
            </button>
          </div>
        </div>,
        document.body
      )}

      {latePenaltyConfirmationOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm" onClick={() => setLatePenaltyConfirmationOpen(false)}>
          <section role="dialog" aria-modal="true" className="w-full max-w-lg rounded-[2rem] bg-white p-5 shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300"><AlertTriangle className="h-6 w-6" /></div>
              <div className="min-w-0 flex-1"><p className="text-xs font-black uppercase tracking-wider text-rose-600">Đăng ký trễ hạn</p><h2 className="mt-1 text-xl font-black">Xác nhận lịch và khoản trừ?</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Bạn đang tạo lịch cho tuần hiện tại sau thời hạn quy định.</p></div>
            </div>
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
              <p className="font-black">Bạn sẽ bị trừ {latePenaltyDisplayAmount.toLocaleString('vi-VN')}đ.</p>
              <p className="mt-1">Nếu tuần này bạn nghỉ bệnh hoặc có lý do chính đáng, hãy liên hệ quản lý và chờ đến Thứ Sáu để nhập lịch tuần sau. Nếu vẫn xác nhận, khoản trừ sẽ tiếp tục được ghi nhận.</p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setLatePenaltyConfirmationOpen(false)} className="min-h-12 rounded-2xl border border-slate-200 font-bold dark:border-slate-700">Hủy xác nhận</button>
              <button type="button" onClick={() => void submitSchedule(true, true)} disabled={submitting} className="flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-rose-600 px-3 text-center font-extrabold text-white shadow-lg shadow-rose-600/20 disabled:cursor-wait disabled:opacity-70">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {submitting ? 'Đang xử lý…' : 'Xác nhận và trừ tiền'}
              </button>
            </div>
          </section>
        </div>
      )}

      {confirmationOpen && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-4" onClick={() => setConfirmationOpen(false)}>
          <section className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-[2rem] bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
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
            {lateScheduleWarning && (
              <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold leading-6 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
                Lịch tuần này đã trễ hạn. Khoản phạt đăng ký trễ {latePenaltyDisplayAmount.toLocaleString('vi-VN')}đ sẽ được ghi nhận khi bạn xác nhận.
              </p>
            )}
            {weekNote.trim() && <p className="mt-3 rounded-2xl bg-indigo-50 p-3 text-sm text-indigo-900 dark:bg-indigo-500/10 dark:text-indigo-100"><strong>Ghi chú:</strong> {weekNote.trim()}</p>}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setConfirmationOpen(false)} className="min-h-12 rounded-2xl border border-slate-200 font-bold dark:border-slate-700">Xem lại</button>
              <button type="button" onClick={() => void submitSchedule(true)} className="mobile-primary-button">Xác nhận lịch</button>
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
            <h2 className="mt-5 text-2xl font-black">Xác nhận lịch thành công!</h2>
            <p className="mt-2 text-sm text-muted-foreground">Bảng lịch đã được lưu, tự động duyệt và cập nhật cho quản lý.</p>
          </div>
        </div>
      )}

      {dutyPickerOpen && (
        <div className="fixed inset-0 z-[75] flex items-end bg-slate-950/45 backdrop-blur-sm" onClick={() => setDutyPickerOpen(false)}>
          <section className="max-h-[calc(100dvh-1rem)] w-full overflow-y-auto rounded-t-[2rem] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl dark:bg-slate-900 sm:mx-auto sm:mb-4 sm:max-w-lg sm:rounded-[2rem]" onClick={(event) => event.stopPropagation()}>
            <div className="mx-auto max-w-lg">
              <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-300 dark:bg-slate-700" />
              <div className="mb-3 flex items-center justify-between">
                <div><p className="text-xs font-bold uppercase tracking-wider text-rose-600">Lịch trực</p><h2 className="text-xl font-extrabold">Chọn ngày trực</h2></div>
                <button onClick={() => setDutyPickerOpen(false)} className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 dark:bg-slate-800"><X className="h-5 w-5" /></button>
              </div>
               <p className="mb-4 text-sm text-muted-foreground">Chạm vào ngày muốn trực. Khung giờ cố định 17:00–17:30.</p>
               <div className="grid grid-cols-2 gap-2 rounded-3xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/70">
                 {days.map((day, index) => {
                   const active = dutyCandidate === day.key
                   const count = dutyTeamCount(day.key)
                   const registrationLocked = isPastRegistrationDay(day.key) && dutyDay !== day.key
                   return (
                     <button
                       key={day.key}
                       type="button"
                       onClick={() => {
                         if (registrationLocked) {
                           setDutyPickerOpen(false)
                           setMessage('Bạn chỉ được đăng ký lịch từ hôm nay đến Chủ Nhật. Ngày trực này đã khóa.')
                           window.scrollTo({ top: 0, behavior: 'smooth' })
                           return
                         }
                         setDutyCandidate(day.key)
                       }}
                       aria-disabled={registrationLocked}
                       className={`min-h-[74px] rounded-2xl border px-3 py-2.5 text-left transition active:scale-[0.98] ${index === days.length - 1 ? 'col-span-2' : ''} ${registrationLocked ? 'border-transparent bg-slate-100 text-slate-400 dark:bg-slate-800/60 dark:text-slate-500' : active ? 'border-rose-500 bg-white text-rose-700 shadow-md shadow-rose-950/10 ring-2 ring-rose-100 dark:bg-slate-900 dark:text-rose-300 dark:ring-rose-500/15' : 'border-transparent bg-white/70 text-slate-700 dark:bg-slate-900/60 dark:text-slate-200'}`}
                     >
                       <span className="flex items-center justify-between gap-2">
                         <span className="font-extrabold">{day.shortName}</span>
                         {registrationLocked ? <span className="text-[10px]">Đã khóa</span> : active && <Check className="h-4 w-4" />}
                       </span>
                       <span className="mt-1 block text-xs font-semibold tabular-nums opacity-75">{day.date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })} · {count}/{DUTY_TEAM_CAPACITY} người</span>
                     </button>
                   )
                 })}
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
        <div className="fixed inset-0 z-[75] flex items-end bg-slate-950/45 backdrop-blur-sm" onClick={() => setCustomFor(null)}>
          <section className="max-h-[calc(100dvh-1rem)] w-full overflow-y-auto rounded-t-[2rem] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
            <div className="mx-auto max-w-lg">
              <div className="mb-4 flex items-center justify-between">
                <div><p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Ca tăng ca</p><h2 className="text-xl font-extrabold">{customDay?.name}</h2></div>
                <button onClick={() => setCustomFor(null)} className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 dark:bg-slate-800"><X className="h-5 w-5" /></button>
              </div>
               <p className="mb-4 rounded-2xl bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-100">Chọn giờ cho riêng ngày này. Bạn có thể mở lại để sửa bất cứ lúc nào trước khi xác nhận cả tuần.</p>
               <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                 <label className="text-sm font-bold">Bắt đầu<select className="mobile-field mt-2 appearance-none text-center font-extrabold tabular-nums" value={customData[customFor]?.start || '08:00'} onChange={(e) => setCustomData((prev) => ({ ...prev, [customFor]: { ...prev[customFor], start: e.target.value } }))}>{timeOptions.map((time) => <option key={`start-${time}`} value={time}>{time}</option>)}</select></label>
                 <span className="mb-3 text-sm font-black text-slate-400">đến</span>
                 <label className="text-sm font-bold">Kết thúc<select className="mobile-field mt-2 appearance-none text-center font-extrabold tabular-nums" value={customData[customFor]?.end || '17:00'} onChange={(e) => setCustomData((prev) => ({ ...prev, [customFor]: { ...prev[customFor], end: e.target.value } }))}>{timeOptions.map((time) => <option key={`end-${time}`} value={time}>{time}</option>)}</select></label>
               </div>
               {customTimeInvalid && <p className="mt-3 rounded-2xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">Giờ kết thúc phải sau giờ bắt đầu.</p>}
               <button type="button" disabled={customTimeInvalid} onClick={saveCustom} className="mobile-primary-button mt-5 w-full disabled:opacity-50"><Check className="h-4 w-4" /> Xác nhận ca tăng ca</button>
               {selected[customFor]?.includes('Custom') && <button type="button" onClick={() => { setSelected((prev) => { const next = { ...prev }; const shifts = (next[customFor] || []).filter((shift) => shift !== 'Custom'); if (shifts.length) next[customFor] = shifts; else delete next[customFor]; return next }); setCustomFor(null) }} className="mt-2 min-h-11 w-full rounded-2xl text-sm font-bold text-rose-600">Bỏ ca tăng ca ngày này</button>}
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
