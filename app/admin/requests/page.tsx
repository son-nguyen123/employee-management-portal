'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { AlertTriangle, Building2, CalendarPlus, Check, ChevronDown, CircleDollarSign, Clock3, Download, ExternalLink, FileText, Loader2, MessageSquareText, Phone, Plus, UsersRound, X } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import { auth } from '@/lib/firebase'
import { updateLeaveStatus } from '@/lib/services/leaveService'
import { updateLateStatus } from '@/lib/services/lateService'
import { subscribeToPendingSalaryAdvances, updateSalaryAdvanceStatus } from '@/lib/services/salaryService'
import { mockLateRequests, mockLeaveRequests, mockSalaryAdvances } from '@/lib/services/mockData'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { ManagementOverview } from '@/components/admin/management-overview'
import { subscribeToActiveEmployees } from '@/lib/services/employeeService'
import { adjustPenalty, cancelPenalty, createManualPenalty, subscribeToAllPenalties } from '@/lib/services/penaltyService'
import { subscribeToPendingStaffRequests, updateStaffRequestStatus } from '@/lib/services/staffRequestService'
import type { Employee, Penalty, StaffRequest } from '@/lib/models/types'
import { employeeFactoryId, FACTORY_LABELS } from '@/lib/models/factory'
import { MonthNavigator } from '@/components/ui/month-navigator'
import { invalidateMonthData, readPenaltyMonth } from '@/lib/services/monthDataService'
import { currentVietnamMonth } from '@/lib/archive/retention'
import { belongsToVietnamMonth, dateFromMonthValue } from '@/lib/services/monthDataUtils'

type RequestType = 'leave' | 'late' | 'salary' | 'overtime' | 'note' | 'scheduleChange' | 'scheduleModeChange' | 'factoryChange'
type RequestRow = {
  id: string
  type: RequestType
  employeeId: string
  employeeName: string
  title: string
  detail: string
  status: string
  shifts?: StaffRequest['shifts']
  removedShifts?: StaffRequest['removedShifts']
  restoredShifts?: StaffRequest['restoredShifts']
  workScheduleIds?: string[]
  penaltyIfApproved?: number
  penaltyIfRejected?: number
  noticeClass?: 'onTime' | 'late'
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'NV'
}

function requestShiftLabel(item: NonNullable<StaffRequest['shifts']>[number]): string {
  const custom = item.note?.match(/\[CUSTOM:(\d{2}:\d{2})-(\d{2}:\d{2})\]/)
  if (custom) return `Tăng ca ${custom[1]}–${custom[2]}`
  return item.shift === 'Morning' ? 'Ca sáng' : item.shift === 'Afternoon' ? 'Ca chiều' : 'Ca tối'
}

function EmployeeAvatar({ employee, className = 'h-11 w-11' }: { employee: Employee; className?: string }) {
  return employee.photoURL ? (
    <img src={employee.photoURL} alt="" className={`${className} shrink-0 rounded-full object-cover ring-2 ring-white dark:ring-slate-900`} />
  ) : (
    <span className={`grid ${className} shrink-0 place-items-center rounded-full bg-gradient-to-br from-rose-500 to-fuchsia-600 text-xs font-black text-white ring-2 ring-white dark:ring-slate-900`} aria-hidden="true">
      {initials(employee.fullName)}
    </span>
  )
}

function buildRequestRows(
  leaves: any[],
  lates: any[],
  salaries: any[],
  staffRequests: StaffRequest[],
  employees: Employee[],
  preview = false
): RequestRow[] {
  const employeeNames = new Map(employees.map((employee) => [employee.uid, employee.fullName]))
  const fallbackName = preview ? 'Nguyễn Minh An' : 'Nhân viên'
  return [
    ...leaves.map((item, index) => ({
      id: item.id || `leave-${index}`,
      type: 'leave' as const,
      employeeId: item.employeeId || 'demo-user-001',
      employeeName: employeeNames.get(item.employeeId) || fallbackName,
      title: 'Yêu cầu xin nghỉ',
      detail: `${item.reason || 'Nghỉ việc cá nhân'} · ${item.duration === 'long' ? 'Dài hạn' : 'Ngắn hạn'}`,
      status: item.status || 'Pending',
      workScheduleIds: item.workScheduleIds || (item.workScheduleId ? [item.workScheduleId] : []),
      penaltyIfApproved: Number(item.penaltyIfApproved ?? (item.noticeClass === 'late' ? 500 : 0)),
      penaltyIfRejected: Number(item.penaltyIfRejected ?? (item.noticeClass === 'late' ? 1000 : 500)),
      noticeClass: item.noticeClass || 'onTime',
    })),
    ...lates.map((item, index) => ({
      id: item.id || `late-${index}`,
      type: 'late' as const,
      employeeId: item.employeeId || 'demo-user-001',
      employeeName: employeeNames.get(item.employeeId) || fallbackName,
      title: 'Yêu cầu đi trễ',
      detail: `${item.reason || 'Có việc đột xuất'} · ${item.lateMinutes || 15} phút`,
      status: item.status || 'Pending',
    })),
    ...salaries.map((item, index) => ({
      id: item.id || `salary-${index}`,
      type: 'salary' as const,
      employeeId: item.employeeId || 'demo-user-001',
      employeeName: employeeNames.get(item.employeeId) || fallbackName,
      title: 'Yêu cầu ứng lương',
      detail: `${Number(item.amount || 0).toLocaleString('vi-VN')} VND · ${item.reason || 'Không có ghi chú'}`,
      status: item.status || 'Pending',
    })),
    ...staffRequests.map((item, index) => ({
      id: item.id || `staff-${index}`,
      type: item.type,
      employeeId: item.employeeId,
      employeeName: employeeNames.get(item.employeeId) || fallbackName,
      title: item.type === 'scheduleModeChange' ? 'Yêu cầu đổi chế độ làm việc' : item.type === 'factoryChange' ? 'Yêu cầu đổi xưởng' : item.type === 'scheduleChange' ? 'Yêu cầu đổi / thêm ca' : item.type === 'overtime' ? 'Yêu cầu làm thêm' : 'Ghi chú từ nhân viên',
      detail: item.type === 'scheduleModeChange'
        ? `${item.previousScheduleMode === 'fixed' ? 'Cố định' : 'Xoay ca'} → ${item.requestedScheduleMode === 'fixed' ? 'Cố định' : 'Xoay ca'}${item.content ? ` · ${item.content}` : ''}`
        : item.type === 'factoryChange'
        ? `${FACTORY_LABELS[item.previousFactoryId || 'factory-1']} → ${FACTORY_LABELS[item.requestedFactoryId || 'factory-1']}${item.content ? ` · ${item.content}` : ''}`
        : item.type === 'scheduleChange'
        ? `${item.removedShifts?.length || 0} ca xin hủy · ${item.restoredShifts?.length || 0} ca đi làm lại · ${item.shifts?.length || 0} ca mới / ca thêm${item.content ? ` · ${item.content}` : ''}`
        : item.type === 'overtime'
        ? `${item.shifts?.length || 0} ca muốn làm thêm${item.content ? ` · ${item.content}` : ''}`
        : item.content,
      status: item.status,
      shifts: item.shifts,
      removedShifts: item.removedShifts,
      restoredShifts: item.restoredShifts,
    })),
  ].filter((item) => item.status === 'Pending')
}

export default function AdminRequestsPage() {
  const { authUser, employee: currentEmployee, isPreviewMode } = useAuth()
  const [filter, setFilter] = useState<'all' | RequestType>('all')
  const [rows, setRows] = useState<RequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [penaltyEmployeeId, setPenaltyEmployeeId] = useState('')
  const [penaltyDate, setPenaltyDate] = useState(new Date().toISOString().slice(0, 10))
  const [penaltyAmount, setPenaltyAmount] = useState('500')
  const [penaltyNote, setPenaltyNote] = useState('')
  const [penaltyFormError, setPenaltyFormError] = useState('')
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false)
  const manualPenaltyFormRef = useRef<HTMLFormElement | null>(null)
  const employeePickerButtonRef = useRef<HTMLButtonElement | null>(null)
  const [penaltySubmitting, setPenaltySubmitting] = useState(false)
  const [penalties, setPenalties] = useState<Penalty[]>([])
  const [editingPenalty, setEditingPenalty] = useState<{ penalty: Penalty; mode: 'adjust' | 'cancel' } | null>(null)
  const [managedAmount, setManagedAmount] = useState('')
  const [manageReason, setManageReason] = useState('')
  const [managingPenalty, setManagingPenalty] = useState(false)

  const [rejectingRow, setRejectingRow] = useState<RequestRow | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [penaltiesOpen, setPenaltiesOpen] = useState(false)
  const [manualPenaltyOpen, setManualPenaltyOpen] = useState(false)
  const [pageMode, setPageMode] = useState<'requests' | 'penalties'>('requests')
  const [penaltyTab, setPenaltyTab] = useState<'employees' | 'list'>('employees')
  const [penaltyExportMonth, setPenaltyExportMonth] = useState(currentVietnamMonth(new Date()).key)
  const [exportingPenalties, setExportingPenalties] = useState(false)
  const [penaltyMonthLoading, setPenaltyMonthLoading] = useState(true)
  const factoryScope = currentEmployee?.role === 'director' ? undefined : employeeFactoryId(currentEmployee)

  useEffect(() => {
    if (!rejectingRow && !editingPenalty) return
    const previousOverflow = document.body.style.overflow
    const bottomNavigation = document.querySelector<HTMLElement>('[data-app-bottom-navigation]')
    const previousAriaHidden = bottomNavigation?.getAttribute('aria-hidden')
    document.body.style.overflow = 'hidden'
    bottomNavigation?.setAttribute('aria-hidden', 'true')
    bottomNavigation?.setAttribute('inert', '')
    return () => {
      document.body.style.overflow = previousOverflow
      bottomNavigation?.removeAttribute('inert')
      if (previousAriaHidden === null) bottomNavigation?.removeAttribute('aria-hidden')
      else if (previousAriaHidden !== undefined) bottomNavigation?.setAttribute('aria-hidden', previousAriaHidden)
    }
  }, [editingPenalty, rejectingRow])

  useEffect(() => {
    setPageMode(new URLSearchParams(window.location.search).get('view') === 'penalties' ? 'penalties' : 'requests')
  }, [])

  useEffect(() => {
    if (!authUser) return
    if (isPreviewMode) {
      const employeeList = [{
        uid: 'demo-user-001',
        employeeCode: '001',
        fullName: 'Nguyễn Minh An',
        phone: '0901234567',
        email: 'demo@example.com',
        role: 'employee',
        status: 'active',
        joinDate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Employee]
      setEmployees(employeeList)
      setRows(buildRequestRows(mockLeaveRequests, mockLateRequests, mockSalaryAdvances, [], employeeList, true))
      setPenaltyEmployeeId('')
      setLoading(false)
      setPenaltyMonthLoading(false)
      return
    }

    let salaries: any[] = []
    let staffRequests: StaffRequest[] = []
    let employeeList: Employee[] = []
    const ready = new Set<string>()
    const publish = () => {
      setEmployees(employeeList)
      setRows(buildRequestRows([], [], salaries, staffRequests, employeeList))
      if (ready.size === 3) {
        setLoading(false)
        setMessage('')
      }
    }
    const handleError = () => {
      setMessage('Chưa tải được danh sách yêu cầu.')
      setLoading(false)
    }

    const unsubscribers = [
      subscribeToPendingSalaryAdvances((items) => {
        salaries = items
        ready.add('salary')
        publish()
      }, handleError, factoryScope),
      subscribeToPendingStaffRequests((items) => {
        staffRequests = items
        ready.add('staff')
        publish()
      }, handleError, factoryScope),
      subscribeToActiveEmployees((items) => {
        employeeList = items
        ready.add('employees')
        publish()
      }, handleError, factoryScope),
    ]

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [authUser, factoryScope, isPreviewMode])

  useEffect(() => {
    if (!authUser || isPreviewMode || pageMode !== 'penalties') return
    let active = true
    let sourceRecords: Penalty[] = []
    let liveRecords: Penalty[] | null = null
    let allowedEmployeeIds = new Set<string>()
    const mergeRecords = () => {
      const byId = new Map(sourceRecords.map((item) => [item.id, item]))
      liveRecords
        ?.filter((item) => allowedEmployeeIds.has(item.employeeId) && belongsToVietnamMonth(item.penaltyDate, penaltyExportMonth))
        .forEach((item) => byId.set(item.id, item))
      const sorted = Array.from(byId.values()).sort((left, right) => {
        const leftDate = dateFromMonthValue(left.penaltyDate)?.getTime() || 0
        const rightDate = dateFromMonthValue(right.penaltyDate)?.getTime() || 0
        return rightDate - leftDate
      })
      if (active) setPenalties(sorted)
    }
    const currentMonthWindow = currentVietnamMonth(new Date())
    const unsubscribe = penaltyExportMonth === currentMonthWindow.key
      ? subscribeToAllPenalties((items) => {
        liveRecords = items
        mergeRecords()
      }, () => {
        if (active) setMessage('Không thể cập nhật khoản phạt theo thời gian thực.')
      }, { startDate: currentMonthWindow.start, endDate: currentMonthWindow.end }, factoryScope)
      : undefined
    setPenalties([])
    setPenaltyMonthLoading(true)
    void readPenaltyMonth(penaltyExportMonth)
      .then((result) => {
        if (!active) return
        sourceRecords = result.records
        allowedEmployeeIds = new Set(result.employees.map((employee) => employee.uid || (employee as Employee & { id?: string }).id || ''))
        mergeRecords()
        setEmployees((current) => {
          const byId = new Map(current.map((employee) => [employee.uid, employee]))
          result.employees.forEach((employee) => byId.set(employee.uid || (employee as Employee & { id?: string }).id || '', employee))
          return Array.from(byId.values()).filter((employee) => employee.uid)
        })
      })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : 'Chưa thể tải dữ liệu phạt của tháng này.') })
      .finally(() => { if (active) setPenaltyMonthLoading(false) })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [authUser, factoryScope, isPreviewMode, pageMode, penaltyExportMonth])

  useEffect(() => {
    if (!manualPenaltyOpen) return

    const frame = window.requestAnimationFrame(() => {
      manualPenaltyFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [manualPenaltyOpen])

  const process = async (row: RequestRow, status: 'Approved' | 'Rejected', suppliedNote = '') => {
    if (!authUser) return
    const reviewNote = status === 'Rejected' ? suppliedNote.trim() : ''
    if (status === 'Rejected' && !reviewNote) return
    try {
      if (!isPreviewMode) {
        if (row.type === 'leave') await updateLeaveStatus(row.id, status, authUser.uid, reviewNote)
        if (row.type === 'late') await updateLateStatus(row.id, status, authUser.uid, reviewNote)
        if (row.type === 'salary') await updateSalaryAdvanceStatus(row.id, status, authUser.uid, reviewNote)
        if (row.type === 'overtime' || row.type === 'note' || row.type === 'scheduleChange' || row.type === 'scheduleModeChange' || row.type === 'factoryChange') await updateStaffRequestStatus(row.id, status, reviewNote)
      }
      setRows((prev) => prev.filter((item) => item.id !== row.id))
      setMessage(status === 'Approved' ? 'Đã duyệt yêu cầu.' : 'Đã từ chối yêu cầu.')
      setRejectingRow(null)
      setRejectReason('')
    } catch {
      setMessage('Không thể xử lý. Kiểm tra quyền admin của tài khoản.')
    }
  }

  const toggleManualPenalty = () => {
    if (!manualPenaltyOpen) {
      setPenaltyEmployeeId('')
      setPenaltyFormError('')
    }
    setManualPenaltyOpen((current) => !current)
    setEmployeePickerOpen(false)
  }

  const closeManualPenalty = () => {
    setManualPenaltyOpen(false)
    setEmployeePickerOpen(false)
  }

  const selectPenaltyEmployee = (employeeId: string) => {
    setPenaltyEmployeeId(employeeId)
    setEmployeePickerOpen(false)
    setPenaltyFormError('')
    window.requestAnimationFrame(() => employeePickerButtonRef.current?.focus())
  }

  const addManualPenalty = async (event: React.FormEvent) => {
    event.preventDefault()
    const amount = Number(penaltyAmount.replace(/\D/g, ''))
    if (!penaltyEmployeeId || !employees.some((employee) => employee.uid === penaltyEmployeeId) || !penaltyDate || !Number.isSafeInteger(amount) || amount < 1 || !penaltyNote.trim()) {
      setPenaltyFormError('Vui lòng chọn nhân viên, nhập số tiền là số nguyên dương và ghi rõ lý do.')
      return
    }
    setPenaltyFormError('')
    setPenaltySubmitting(true)
    try {
      const createdPenalty: Penalty = {
        id: `manual-${Date.now()}`,
        employeeId: penaltyEmployeeId,
        title: 'Phạt thủ công',
        description: penaltyNote.trim(),
        category: 'Other',
        amount,
        penaltyDate: new Date(`${penaltyDate}T12:00:00`),
        createdBy: authUser?.uid || 'manager',
        createdAt: new Date(),
        status: 'Active',
      }
      if (!isPreviewMode) {
        const result = await createManualPenalty(penaltyEmployeeId, `${penaltyDate}T12:00:00`, amount, penaltyNote.trim())
        createdPenalty.id = result.id
        invalidateMonthData('penalties', penaltyExportMonth)
        const refreshed = await readPenaltyMonth(penaltyExportMonth)
        setPenalties(refreshed.records)
      } else {
        setPenalties((current) => [createdPenalty, ...current])
      }
      setPenaltyNote('')
      setPenaltyAmount('500')
      setPenaltyFormError('')
      setEmployeePickerOpen(false)
      setManualPenaltyOpen(false)
      setMessage(`Đã ghi nhận khoản phạt ${amount.toLocaleString('vi-VN')}đ và gửi thông báo cho nhân viên.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể ghi nhận khoản phạt.')
    } finally {
      setPenaltySubmitting(false)
    }
  }

  const exportPenalties = async () => {
    if (!authUser || !penaltyExportMonth) return
    setExportingPenalties(true)
    setMessage('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) throw new Error('Phiên đăng nhập đã hết hạn.')
      const response = await fetch(`/api/exports/penalties?month=${encodeURIComponent(penaltyExportMonth)}`, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(data?.error || 'Chưa thể xuất bảng phạt.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `bang-phat-${penaltyExportMonth}.xlsx`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể xuất bảng phạt.')
    } finally {
      setExportingPenalties(false)
    }
  }

  const openPenaltyManager = (penalty: Penalty, mode: 'adjust' | 'cancel') => {
    setEditingPenalty({ penalty, mode })
    setManagedAmount(mode === 'adjust' ? String(penalty.amount) : '')
    setManageReason('')
  }

  const submitPenaltyChange = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editingPenalty || !manageReason.trim()) return
    const penaltyId = editingPenalty.penalty.id
    if (!penaltyId) return
    const amount = Number(managedAmount)
    if (editingPenalty.mode === 'adjust' && (!Number.isFinite(amount) || amount < 1)) return
    setManagingPenalty(true)
    try {
      if (!isPreviewMode) {
        if (editingPenalty.mode === 'adjust') {
          await adjustPenalty(penaltyId, amount, manageReason.trim())
        } else {
          await cancelPenalty(penaltyId, manageReason.trim())
        }
      }
      setPenalties((current) => current.map((item) => item.id === penaltyId
        ? editingPenalty.mode === 'adjust'
          ? { ...item, amount, status: 'Active', adjustmentReason: manageReason.trim() }
          : { ...item, amount: 0, status: 'Cancelled', cancellationReason: manageReason.trim() }
        : item))
      setMessage(editingPenalty.mode === 'adjust'
        ? 'Đã điều chỉnh khoản phạt và gửi thông báo cho nhân viên.'
        : 'Đã hủy khoản phạt và gửi thông báo cho nhân viên.')
      setEditingPenalty(null)
      setManageReason('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể cập nhật khoản phạt.')
    } finally {
      setManagingPenalty(false)
    }
  }

  const visibleRows = rows.filter((row) => filter === 'all' || row.type === filter)
  const activePenalties = penalties.filter((item) => item.status !== 'Cancelled')
  const penalizedEmployees = employees.filter((employee) => activePenalties.some((penalty) => penalty.employeeId === employee.uid))
  const selectedPenaltyEmployee = employees.find((employee) => employee.uid === penaltyEmployeeId)
  const meta = {
    leave: { icon: FileText, label: 'Xin nghỉ' },
    late: { icon: Clock3, label: 'Đi trễ' },
    salary: { icon: CircleDollarSign, label: 'Ứng lương' },
    overtime: { icon: CalendarPlus, label: 'Làm thêm' },
    scheduleChange: { icon: CalendarPlus, label: 'Đổi / thêm ca' },
    scheduleModeChange: { icon: CalendarPlus, label: 'Đổi chế độ' },
    factoryChange: { icon: Building2, label: 'Đổi xưởng' },
    note: { icon: MessageSquareText, label: 'Ghi chú' },
  }
  const filterItems: Array<{ value: 'all' | RequestType; label: string; count: number }> = [
    { value: 'all', label: 'Tất cả', count: rows.length },
    { value: 'leave', label: 'Xin nghỉ', count: rows.filter((row) => row.type === 'leave').length },
    { value: 'late', label: 'Đi trễ', count: rows.filter((row) => row.type === 'late').length },
    { value: 'salary', label: 'Ứng lương', count: rows.filter((row) => row.type === 'salary').length },
    { value: 'overtime', label: 'Làm thêm', count: rows.filter((row) => row.type === 'overtime').length },
    { value: 'scheduleChange', label: 'Đổi / thêm', count: rows.filter((row) => row.type === 'scheduleChange').length },
    { value: 'factoryChange', label: 'Đổi xưởng', count: rows.filter((row) => row.type === 'factoryChange').length },
    { value: 'note', label: 'Ghi chú', count: rows.filter((row) => row.type === 'note').length },
  ]

  return (
    <main className="min-h-screen pb-8">
      <Header title={pageMode === 'penalties' ? 'Quản lý phạt' : 'Yêu cầu khác'} subtitle={pageMode === 'penalties' ? 'Theo dõi theo nhân viên và từng khoản phạt' : 'Tất cả yêu cầu ngoài lịch đăng ký tuần'} />
      <PageContainer>
        {pageMode === 'penalties' && <MonthNavigator value={penaltyExportMonth} onChange={setPenaltyExportMonth} loading={penaltyMonthLoading} />}
        {pageMode === 'requests' && <ManagementOverview employees={employees} />}
        <div className="flex flex-col">
        {pageMode === 'penalties' && (
          <div className="order-1 mb-4 space-y-3">
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
              <button type="button" onClick={() => setPenaltyTab('employees')} className={`min-h-11 rounded-xl text-sm font-bold ${penaltyTab === 'employees' ? 'bg-white text-rose-600 shadow-sm dark:bg-slate-950' : 'text-muted-foreground'}`}>Theo nhân viên</button>
              <button type="button" onClick={() => setPenaltyTab('list')} className={`min-h-11 rounded-xl text-sm font-bold ${penaltyTab === 'list' ? 'bg-white text-rose-600 shadow-sm dark:bg-slate-950' : 'text-muted-foreground'}`}>Từng khoản phạt</button>
            </div>
            <div className={`grid gap-2 ${penaltyExportMonth === currentVietnamMonth(new Date()).key ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {penaltyExportMonth === currentVietnamMonth(new Date()).key && <button type="button" onClick={toggleManualPenalty} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-rose-600 px-3 text-sm font-bold text-white"><Plus className="h-4 w-4" /> Ghi phạt</button>}
              <button type="button" onClick={() => void exportPenalties()} disabled={exportingPenalties} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-white px-3 text-sm font-bold text-rose-700 disabled:opacity-50 dark:bg-slate-900"><Download className="h-4 w-4" /> {exportingPenalties ? 'Đang xuất...' : 'Xuất Excel'}</button>
            </div>
          </div>
        )}
        {pageMode === 'penalties' && penaltyTab === 'employees' && (
          <section className="order-3 space-y-3">
            {penalizedEmployees.map((employee) => {
              const employeePenalties = activePenalties.filter((penalty) => penalty.employeeId === employee.uid)
              return (
                <details key={employee.uid} className="mobile-card overflow-hidden">
                  <summary className="flex min-h-20 cursor-pointer list-none items-center gap-3 p-4">
                    <EmployeeAvatar employee={employee} />
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate font-extrabold">{employee.fullName}</h2>
                      <p className="mt-0.5 text-xs font-bold text-rose-600">Mã nhân viên · {employee.employeeCode}</p>
                    </div>
                    <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-extrabold text-rose-700">{employeePenalties.length} khoản</span>
                  </summary>
                  <div className="space-y-2 border-t border-slate-100 p-3">
                    {employeePenalties.map((penalty) => (
                      <article key={penalty.id} className="rounded-2xl bg-slate-50 p-3">
                        <div className="flex justify-between gap-3"><strong>{penalty.title}</strong><span className="font-black text-rose-600">{Number(penalty.amount || 0).toLocaleString('vi-VN')}đ</span></div>
                        <p className="mt-1 text-xs text-muted-foreground">{penalty.description}</p>
                        {penaltyExportMonth === currentVietnamMonth(new Date()).key && <div className="mt-3 grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => openPenaltyManager(penalty, 'cancel')} className="min-h-10 rounded-xl border border-rose-200 text-xs font-bold text-rose-600">Xóa phạt</button>
                          <button type="button" onClick={() => openPenaltyManager(penalty, 'adjust')} className="min-h-10 rounded-xl bg-slate-900 text-xs font-bold text-white">Xác nhận / sửa</button>
                        </div>}
                      </article>
                    ))}
                  </div>
                </details>
              )
            })}
            {!penalizedEmployees.length && penaltyMonthLoading && <div className="mobile-card grid min-h-28 place-items-center gap-2 p-8 text-center text-sm font-semibold text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin text-rose-600" />Đang tải dữ liệu tháng...</div>}
            {!penaltyMonthLoading && !penalizedEmployees.length && <div className="mobile-card p-8 text-center text-sm font-semibold text-muted-foreground">Chưa có nhân viên bị phạt.</div>}
          </section>
        )}
        <form ref={manualPenaltyFormRef} onSubmit={addManualPenalty} className={`${pageMode === 'penalties' && manualPenaltyOpen ? 'order-2' : 'hidden'} relative z-20 mb-5 scroll-mt-6 overflow-visible rounded-3xl border border-rose-200 bg-white shadow-sm dark:border-rose-500/20 dark:bg-slate-900`}>
          <div className="flex items-center gap-3 rounded-t-3xl bg-gradient-to-r from-rose-600 to-fuchsia-600 p-4 text-white">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15"><AlertTriangle className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-wider text-rose-100">Quản lý tự ghi nhận</p><h2 className="font-black">Thêm khoản phạt</h2></div>
            <button type="button" onClick={closeManualPenalty} aria-label="Đóng form ghi phạt" className="grid h-10 w-10 place-items-center rounded-xl bg-white/15"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <label className="relative block text-sm font-bold sm:col-span-2">Nhân viên
              <button
                type="button"
                ref={employeePickerButtonRef}
                onClick={() => setEmployeePickerOpen((current) => !current)}
                aria-expanded={employeePickerOpen}
                aria-haspopup="listbox"
                className="mt-2 flex min-h-14 w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 text-left outline-none transition hover:border-rose-300 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 dark:border-slate-700 dark:bg-slate-900"
              >
                {selectedPenaltyEmployee ? <EmployeeAvatar employee={selectedPenaltyEmployee} className="h-10 w-10" /> : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800"><UsersRound className="h-4 w-4" /></span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-extrabold">{selectedPenaltyEmployee?.fullName || 'Chọn nhân viên'}</span>
                  <span className="mt-0.5 block text-xs font-semibold text-muted-foreground">{selectedPenaltyEmployee ? `Mã nhân viên · ${selectedPenaltyEmployee.employeeCode}` : 'Chọn đúng người cần ghi phạt'}</span>
                </span>
                <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${employeePickerOpen ? 'rotate-180' : ''}`} />
              </button>
              {employeePickerOpen && (
                <div className="absolute inset-x-0 top-full z-40 mt-2 max-h-72 touch-pan-y overscroll-contain overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-950/10 dark:border-slate-700 dark:bg-slate-950" role="listbox">
                  {employees.map((employee) => (
                    <button
                      key={employee.uid}
                      type="button"
                      role="option"
                      aria-selected={penaltyEmployeeId === employee.uid}
                      onClick={() => selectPenaltyEmployee(employee.uid)}
                      className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition ${penaltyEmployeeId === employee.uid ? 'bg-rose-50 dark:bg-rose-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-900'}`}
                    >
                      <EmployeeAvatar employee={employee} className="h-10 w-10" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-extrabold">{employee.fullName}</span>
                        <span className="mt-0.5 block text-xs font-semibold text-muted-foreground">Mã nhân viên · {employee.employeeCode}</span>
                      </span>
                      {penaltyEmployeeId === employee.uid && <Check className="h-4 w-4 shrink-0 text-rose-600" />}
                    </button>
                  ))}
                  {!employees.length && <p className="p-3 text-sm font-semibold text-muted-foreground">Chưa có nhân viên đang hoạt động.</p>}
                </div>
              )}
            </label>
            <label className="text-sm font-bold">Ngày ghi phạt
              <input type="date" value={penaltyDate} onChange={(event) => setPenaltyDate(event.target.value)} className="mobile-field mt-2" required />
            </label>
            <label className="text-sm font-bold sm:col-span-2">Số tiền phạt
              <input type="text" inputMode="numeric" pattern="[0-9 ]*" value={penaltyAmount} onChange={(event) => { setPenaltyAmount(event.target.value.replace(/\D/g, '')); setPenaltyFormError('') }} className="mobile-field mt-2" placeholder="Ví dụ: 500 hoặc 1.000" required />
              <span className="mt-1.5 block text-xs font-medium text-muted-foreground">Nhập số nguyên dương, có thể nhập dấu chấm hoặc khoảng trắng.</span>
            </label>
            <label className="text-sm font-bold sm:col-span-2">Lý do
              <textarea value={penaltyNote} onChange={(event) => setPenaltyNote(event.target.value)} maxLength={1000} className="mobile-field mt-2 min-h-24 py-3" placeholder="Ghi rõ lý do để nhân viên hiểu..." required />
            </label>
            {penaltyFormError && <p className="rounded-2xl bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-700 sm:col-span-2" role="alert">{penaltyFormError}</p>}
            <button type="submit" disabled={penaltySubmitting || !selectedPenaltyEmployee || (!isPreviewMode && !employees.length)} className="mobile-primary-button bg-rose-600 sm:col-span-2">
              {penaltySubmitting && <Loader2 className="h-4 w-4 animate-spin" />} Xác nhận ghi phạt
            </button>
          </div>
        </form>
        <section className={`${pageMode === 'penalties' && penaltyTab === 'list' ? 'order-3' : 'hidden'} mt-5 overflow-hidden rounded-3xl border border-rose-100 bg-white shadow-sm dark:border-rose-500/20 dark:bg-slate-900`}>
          <button type="button" onClick={() => setPenaltiesOpen((current) => !current)} className="flex w-full items-center justify-between gap-3 p-4 text-left" aria-expanded={penaltiesOpen}>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-rose-600">{penalizedEmployees.length} nhân viên bị phạt</p>
              <h2 className="text-xl font-black">{activePenalties.length} khoản phạt đang áp dụng</h2>
            </div>
            <div className="flex items-center gap-2"><span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700">
              {activePenalties.length} khoản
            </span><ChevronDown className={`h-5 w-5 text-slate-400 transition-transform ${penaltiesOpen ? 'rotate-180' : ''}`} /></div>
          </button>
          {!activePenalties.length && penaltyMonthLoading && <div className="grid min-h-28 place-items-center gap-2 border-t border-slate-100 p-6 text-center text-sm font-semibold text-muted-foreground dark:border-white/10"><Loader2 className="h-5 w-5 animate-spin text-rose-600" />Đang tải dữ liệu tháng...</div>}
          {penaltiesOpen && !penaltyMonthLoading && <div className="space-y-3 border-t border-slate-100 p-3 dark:border-white/10">
            {penalties.filter((item) => item.status !== 'Cancelled').map((penalty) => {
              const employee = employees.find((item) => item.uid === penalty.employeeId)
              return (
                <article key={penalty.id} className="mobile-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-extrabold">{penalty.title}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {employee?.fullName || 'Nhân viên'} · {employee?.employeeCode || penalty.employeeId}
                      </p>
                      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{penalty.description}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-rose-50 px-3 py-1 text-xs font-black text-rose-600">
                      {Number(penalty.amount || 0).toLocaleString('vi-VN')}đ
                    </span>
                  </div>
                  {penaltyExportMonth === currentVietnamMonth(new Date()).key && <div className="mt-4 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => openPenaltyManager(penalty, 'cancel')} className="min-h-11 rounded-xl border border-rose-200 text-sm font-bold text-rose-600">
                      Xóa phạt
                    </button>
                    <button type="button" onClick={() => openPenaltyManager(penalty, 'adjust')} className="min-h-11 rounded-xl bg-slate-900 text-sm font-bold text-white dark:bg-white dark:text-slate-900">
                      Điều chỉnh
                    </button>
                  </div>}
                </article>
              )
            })}
            {!penaltyMonthLoading && !penalties.some((item) => item.status !== 'Cancelled') && (
              <div className="mobile-card p-5 text-center text-sm font-semibold text-muted-foreground">Chưa có khoản phạt đang áp dụng.</div>
            )}
          </div>}
        </section>
        <section className={pageMode === 'requests' ? 'order-1' : 'hidden'}>
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
          <Link href="/admin/dashboard#schedules" className="grid min-h-11 place-items-center rounded-xl text-sm font-bold text-muted-foreground">Lịch chờ duyệt</Link>
          <div className="grid min-h-11 place-items-center rounded-xl bg-white text-sm font-bold text-indigo-600 shadow-sm dark:bg-slate-950">Yêu cầu khác</div>
        </div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-extrabold">Yêu cầu khác</h2>
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{rows.length} đang chờ</p>
        </div>
        <div className="-mx-3 overflow-x-auto border-y border-slate-200/80 bg-white/70 px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden dark:border-white/10 dark:bg-slate-900/60 sm:mx-0 sm:rounded-2xl sm:border sm:px-2">
          <div className="flex w-max">
            {filterItems.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setFilter(item.value)}
                aria-pressed={filter === item.value}
                className={`relative flex h-12 min-w-[92px] shrink-0 items-center justify-center gap-1.5 px-3 text-sm font-bold transition-colors ${filter === item.value ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}
              >
                {item.label}
                <span className="text-[11px] font-extrabold text-slate-400 dark:text-slate-500">{item.count}</span>
                {filter === item.value && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-indigo-600" />}
              </button>
            ))}
          </div>
        </div>
        {message && <p className="mt-3 rounded-2xl bg-indigo-50 p-3 text-sm font-semibold text-indigo-800">{message}</p>}
        {loading ? (
          <div className="grid min-h-56 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>
        ) : (
          <div className="mt-4 space-y-3">
            {visibleRows.map((row) => {
              const itemMeta = meta[row.type]
              const Icon = itemMeta.icon
              const employee = employees.find((item) => item.uid === row.employeeId)
              return (
                <article key={`${row.type}-${row.id}`} className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.45)] dark:border-white/10 dark:bg-slate-900">
                    <div className="flex items-start gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300"><Icon className="h-5 w-5" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-400">{itemMeta.label}</p>
                        <h2 className="mt-0.5 text-base font-extrabold leading-tight tracking-tight">{row.title}</h2>
                        <p className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{row.employeeName}</p>
                      </div>
                      <span className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-slate-100 px-2 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Chờ xử lý
                      </span>
                    </div>

                    <div className="mt-3 border-t border-slate-100 pt-3 text-sm leading-5 text-slate-600 dark:border-white/10 dark:text-slate-300">
                      {row.detail}
                    </div>
                      {row.type === 'leave' && (
                        <div className="mt-2.5 rounded-2xl border border-amber-100 bg-amber-50/80 p-3 text-xs text-amber-950 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">
                          <p className="font-extrabold">{row.noticeClass === 'late' ? 'Báo nghỉ dưới 24 giờ trước ca' : 'Báo nghỉ đúng hạn'} · {row.workScheduleIds?.length || 0} ca</p>
                          <p className="mt-1">Duyệt: trừ {Number(row.penaltyIfApproved || 0).toLocaleString('vi-VN')}đ · Từ chối: trừ {Number(row.penaltyIfRejected || 0).toLocaleString('vi-VN')}đ</p>
                        </div>
                      )}
                      {!!row.removedShifts?.length && (
                        <div className="mt-2.5 space-y-1.5 rounded-2xl border border-rose-100 bg-rose-50/80 p-3 text-xs text-rose-950 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-100">
                          <p className="font-extrabold">Ca xin hủy</p>
                          {row.removedShifts.map((item, index) => {
                            const date = item.date instanceof Date ? item.date : item.date.toDate()
                            const shiftLabel = item.shift === 'Morning' ? 'Ca sáng' : item.shift === 'Afternoon' ? 'Ca chiều' : 'Ca tối'
                            return <p key={`${item.scheduleId}-${index}`}><strong>{date.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })}</strong> · {shiftLabel}</p>
                          })}
                        </div>
                      )}
                      {!!row.restoredShifts?.length && (
                        <div className="mt-2.5 space-y-1.5 rounded-2xl border border-emerald-100 bg-emerald-50/80 p-3 text-xs text-emerald-950 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-100">
                          <p className="font-extrabold">Ca xin đi làm lại</p>
                          {row.restoredShifts.map((item, index) => {
                            const date = item.date instanceof Date ? item.date : item.date.toDate()
                            const shiftLabel = item.shift === 'Morning' ? 'Ca sáng' : item.shift === 'Afternoon' ? 'Ca chiều' : 'Ca tối'
                            return <p key={`${item.scheduleId}-${index}`}><strong>{date.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })}</strong> · {shiftLabel}</p>
                          })}
                        </div>
                      )}
                      {!!row.shifts?.length && (
                        <div className="mt-2.5 space-y-1.5 rounded-2xl border border-sky-100 bg-sky-50/80 p-3 text-xs text-sky-950 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-100">
                          {row.type === 'scheduleChange' && <p className="font-extrabold">Ca mới / ca thêm</p>}
                          {row.shifts.map((item, index) => {
                            const date = item.date instanceof Date ? item.date : item.date.toDate()
                            const shiftLabel = requestShiftLabel(item)
                            return <p key={`${date.toISOString()}-${item.shift}-${index}`}><strong>{date.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })}</strong> · {shiftLabel}</p>
                          })}
                        </div>
                      )}

                    <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-4 dark:border-white/10">
                      <a href={`tel:${employee?.phone || ''}`} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 transition active:scale-[0.98] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"><Phone className="h-4 w-4" /> Gọi điện</a>
                      <a href={employee?.facebookUrl || 'https://facebook.com/'} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 transition active:scale-[0.98] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"><ExternalLink className="h-4 w-4" /> Facebook</a>
                      <button type="button" onClick={() => setRejectingRow(row)} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 transition active:scale-[0.98] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"><X className="h-4 w-4" /> Từ chối</button>
                      <button type="button" onClick={() => process(row, 'Approved')} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 text-xs font-bold text-white transition active:scale-[0.98]"><Check className="h-4 w-4" /> Duyệt</button>
                    </div>
                </article>
              )
            })}
            {!visibleRows.length && <div className="mobile-card p-8 text-center"><Check className="mx-auto h-8 w-8 text-emerald-600" /><h2 className="mt-3 font-extrabold">Không còn yêu cầu</h2><p className="text-sm text-muted-foreground">Danh sách đã được xử lý hết.</p></div>}
          </div>
        )}
        </section>
        </div>
      </PageContainer>
      {rejectingRow && createPortal(
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/60 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-sm">
          <div className="flex min-h-full items-center justify-center">
          <div role="dialog" aria-modal="true" aria-labelledby="reject-request-title" className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-[2rem] bg-white p-5 shadow-2xl dark:bg-slate-900">
            <p className="text-xs font-bold uppercase tracking-wider text-rose-600">Từ chối yêu cầu</p>
            <h2 id="reject-request-title" className="mt-1 text-xl font-black">{rejectingRow.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Lý do này sẽ được gửi trực tiếp cho nhân viên.</p>
            <textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} className="mobile-field mt-4 min-h-28 py-3" placeholder="Nhập lý do từ chối..." autoFocus />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setRejectingRow(null)} className="min-h-12 rounded-2xl border font-bold">Quay lại</button>
              <button type="button" disabled={!rejectReason.trim()} onClick={() => process(rejectingRow, 'Rejected', rejectReason)} className="min-h-12 rounded-2xl bg-rose-600 font-bold text-white disabled:opacity-50">Xác nhận từ chối</button>
            </div>
          </div>
          </div>
        </div>
      , document.body)}
      {editingPenalty && createPortal(
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/60 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-sm">
          <div className="flex min-h-full items-center justify-center">
          <form role="dialog" aria-modal="true" aria-labelledby="penalty-change-title" onSubmit={submitPenaltyChange} className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-[2rem] bg-white p-5 shadow-2xl dark:bg-slate-900">
            <p className="text-xs font-bold uppercase tracking-wider text-rose-600">
              {editingPenalty.mode === 'adjust' ? 'Điều chỉnh khoản phạt' : 'Hủy khoản phạt'}
            </p>
            <h2 id="penalty-change-title" className="mt-1 text-xl font-black">{editingPenalty.penalty.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Nhân viên sẽ nhận thông báo ngay sau khi bạn xác nhận.</p>
            {editingPenalty.mode === 'adjust' && (
              <label className="mt-4 block text-sm font-bold">Số tiền mới
                <input type="number" min="1" step="500" value={managedAmount} onChange={(event) => setManagedAmount(event.target.value)} className="mobile-field mt-2" required />
              </label>
            )}
            <label className="mt-4 block text-sm font-bold">Lý do
              <textarea value={manageReason} onChange={(event) => setManageReason(event.target.value)} className="mobile-field mt-2 min-h-28 py-3" placeholder="Nhập lý do để nhân viên biết..." required autoFocus={editingPenalty.mode === 'cancel'} />
            </label>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setEditingPenalty(null)} className="min-h-12 rounded-2xl border font-bold">Quay lại</button>
              <button type="submit" disabled={managingPenalty || !manageReason.trim()} className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl font-bold text-white disabled:opacity-50 ${editingPenalty.mode === 'cancel' ? 'bg-rose-600' : 'bg-indigo-600'}`}>
                {managingPenalty && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingPenalty.mode === 'cancel' ? 'Xác nhận hủy' : 'Lưu điều chỉnh'}
              </button>
            </div>
          </form>
          </div>
        </div>
      , document.body)}
    </main>
  )
}
