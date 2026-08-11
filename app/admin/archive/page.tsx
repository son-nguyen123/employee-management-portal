'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  Eye,
  ExternalLink,
  FlaskConical,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { Badge } from '@/components/ui/badge'
import { useAuth, useUserRole } from '@/lib/hooks/useAuth'
import {
  listArchiveFiles,
  readArchiveFile,
  createArchivePreview,
  archivePreviousMonth,
  readCurrentMonthSnapshot,
  type ArchiveFileSummary,
  type ArchivedRecord,
  type WeeklyArchivePayload,
} from '@/lib/services/archiveService'
import { auth } from '@/lib/firebase'

const collectionLabels: Record<string, string> = {
  workSchedules: 'Lịch làm',
  leaveRequests: 'Xin nghỉ',
  lateRequests: 'Đi trễ',
  salaryAdvances: 'Ứng lương',
  staffRequests: 'Làm thêm và ghi chú',
  penalties: 'Khoản phạt',
  auditEvents: 'Nhật ký thao tác',
  employeeProfiles: 'Hồ sơ tham chiếu',
}

const filterCollections = [
  ['all', 'Tất cả'],
  ['workSchedules', 'Lịch làm'],
  ['leaveRequests', 'Xin nghỉ'],
  ['lateRequests', 'Đi trễ'],
  ['salaryAdvances', 'Ứng lương'],
  ['staffRequests', 'Đổi / thêm ca · Ghi chú'],
  ['penalties', 'Khoản phạt'],
] as const

type FilterCollection = typeof filterCollections[number][0]

interface AppliedFilter {
  month: string
  collection: FilterCollection
  employee: string
}

interface FilterResult {
  key: string
  collection: string
  records: ArchivedRecord[]
  employee: string
  employeeId: string
  status: string
  date: string
  weekStart: string
  weekKey: string
}

function bytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function displayDate(value: unknown) {
  if (typeof value !== 'string') return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN')
}

function sourceWeekKey(archiveKey: string) {
  return archiveKey.split('-test-')[0]
}

function monthKey(file: ArchiveFileSummary) {
  if (file.archiveKind === 'monthly') return file.archiveKey.slice(0, 7)
  return sourceWeekKey(file.archiveKey).slice(0, 7)
}

function monthLabel(key: string) {
  const [year, month] = key.split('-').map(Number)
  return `Tháng ${month}/${year}`
}

function weekRange(key: string) {
  const start = new Date(`${key}T12:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const formatter = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' })
  return `Từ ${formatter.format(start)} đến ${formatter.format(end)}`
}

function vietnamMonthKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  return `${year}-${month}`
}

function fileTouchesMonth(file: ArchiveFileSummary, targetMonth: string) {
  if (file.archiveKind === 'monthly') return monthKey(file) === targetMonth
  const start = new Date(`${sourceWeekKey(file.archiveKey)}T12:00:00+07:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return vietnamMonthKey(start) === targetMonth || vietnamMonthKey(end) === targetMonth
}

function recordBelongsToMonth(collection: string, data: Record<string, unknown>, targetMonth: string) {
  const [year, month] = targetMonth.split('-').map(Number)
  const monthStart = new Date(Date.UTC(year, month - 1, 1) - 7 * 60 * 60 * 1000)
  const monthEnd = new Date(Date.UTC(year, month, 1) - 7 * 60 * 60 * 1000)
  if (collection === 'leaveRequests') {
    const start = new Date(String(data.leaveDate || ''))
    const end = new Date(String(data.endDate || data.leaveDate || ''))
    return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start < monthEnd && end >= monthStart
  }
  const value = collection === 'workSchedules' || collection === 'lateRequests'
    ? data.date
    : collection === 'penalties'
      ? data.penaltyDate
      : data.reviewedAt || data.updatedAt || data.createdAt
  const date = new Date(String(value || ''))
  return !Number.isNaN(date.getTime()) && date >= monthStart && date < monthEnd
}

function recordSummary(record: ArchivedRecord, employeeNames: Map<string, string>) {
  const data = record.data || {}
  const employeeId = typeof data.employeeId === 'string' ? data.employeeId : ''
  const directName = typeof data.employeeName === 'string' ? data.employeeName : ''
  const directCode = typeof data.employeeCode === 'string' ? data.employeeCode : ''
  const fallback = directName ? `${directName}${directCode ? ` · ${directCode}` : ''}` : ''
  const employee = employeeNames.get(employeeId) || fallback || employeeId || record.id
  const status = typeof data.status === 'string' ? data.status : ''
  const date = displayDate(data.date || data.leaveDate || data.penaltyDate || data.createdAt)
  return { employee, employeeId, status, date }
}

const valueLabels: Record<string, string> = {
  employeeId: 'Mã hệ thống',
  date: 'Ngày',
  leaveDate: 'Ngày nghỉ',
  endDate: 'Đến ngày',
  shift: 'Ca',
  lateMinutes: 'Số phút đi trễ',
  expectedArrival: 'Giờ dự kiến',
  reason: 'Lý do',
  amount: 'Số tiền',
  status: 'Trạng thái',
  reviewNote: 'Phản hồi quản lý',
  createdAt: 'Gửi lúc',
  reviewedAt: 'Xử lý lúc',
  cancellationReason: 'Lý do hủy',
}

function readableValue(key: string, value: unknown) {
  if (value == null || value === '') return ''
  if (key.toLowerCase().includes('date') || key.endsWith('At')) return displayDate(value)
  if (key === 'amount') return `${Number(value || 0).toLocaleString('vi-VN')}đ`
  if (key === 'shift') return value === 'Morning' ? 'Ca sáng' : value === 'Afternoon' ? 'Ca chiều' : 'Ca tối'
  if (key === 'status') return value === 'Approved' ? 'Đã duyệt' : value === 'Rejected' ? 'Từ chối' : value === 'Cancelled' ? 'Đã hủy' : value === 'Pending' ? 'Chờ duyệt' : String(value)
  return String(value)
}

function readableFields(record: ArchivedRecord) {
  return Object.entries(record.data || {})
    .filter(([key, value]) => key in valueLabels && readableValue(key, value))
    .map(([key, value]) => ({ label: valueLabels[key], value: readableValue(key, value) }))
}

function canonicalFiles(files: ArchiveFileSummary[]) {
  const fileTime = (file: ArchiveFileSummary) => {
    const value = Date.parse(file.modifiedTime || file.createdTime || '')
    return Number.isNaN(value) ? 0 : value
  }
  const byWeek = new Map<string, ArchiveFileSummary>()
  files.forEach((file) => {
    const week = `${file.archiveKind}:${sourceWeekKey(file.archiveKey)}`
    const current = byWeek.get(week)
    const currentIsTest = current?.archiveKey.includes('-test-') ?? false
    const fileIsTest = file.archiveKey.includes('-test-')
    const shouldReplace = !current ||
      (currentIsTest && !fileIsTest) ||
      (currentIsTest === fileIsTest && (fileTime(file) > fileTime(current) || (fileTime(file) === fileTime(current) && file.archiveKey > current.archiveKey)))
    if (shouldReplace) {
      byWeek.set(week, file)
    }
  })
  return [...byWeek.values()]
}

export default function AdminArchivePage() {
  const { authUser, isPreviewMode } = useAuth()
  const role = useUserRole()
  const [files, setFiles] = useState<ArchiveFileSummary[]>([])
  const [selected, setSelected] = useState<ArchiveFileSummary | null>(null)
  const [archive, setArchive] = useState<WeeklyArchivePayload | null>(null)
  const archiveCache = useRef(new Map<string, WeeklyArchivePayload>())
  const [loading, setLoading] = useState(true)
  const [loadingFile, setLoadingFile] = useState(false)
  const [message, setMessage] = useState('')
  const [testDate, setTestDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 7)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  })
  const [creatingTest, setCreatingTest] = useState(false)
  const [archivingMonth, setArchivingMonth] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [draftCollection, setDraftCollection] = useState<FilterCollection>('all')
  const [draftEmployee, setDraftEmployee] = useState('')
  const [appliedFilter, setAppliedFilter] = useState<AppliedFilter | null>(null)
  const [filterResults, setFilterResults] = useState<FilterResult[]>([])
  const [filtering, setFiltering] = useState(false)
  const [selectedBrowseMonth, setSelectedBrowseMonth] = useState('')
  const [showWeeklyDetails, setShowWeeklyDetails] = useState(false)
  const [exportingMonth, setExportingMonth] = useState(false)
  const monthRailRef = useRef<HTMLDivElement>(null)
  const centeredYearRef = useRef<number | null>(null)
  const filterRequestIdRef = useRef(0)
  const visibleFiles = useMemo(() => canonicalFiles(files), [files])
  const currentMonthKey = vietnamMonthKey(new Date())

  const loadFiles = useCallback(async () => {
    if (!authUser) return
    setLoading(true)
    setMessage('')
    try {
      if (isPreviewMode) {
        setFiles([])
        setMessage('Chế độ xem thử không kết nối Google Drive.')
      } else {
        setFiles(await listArchiveFiles())
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể tải kho dữ liệu.')
    } finally {
      setLoading(false)
    }
  }, [authUser, isPreviewMode])

  useEffect(() => { void loadFiles() }, [loadFiles])

  const monthGroups = useMemo(() => {
    const groups = new Map<string, ArchiveFileSummary[]>()
    visibleFiles.forEach((file) => {
      const startKey = monthKey(file)
      if (file.archiveKind === 'monthly') {
        groups.set(startKey, [...(groups.get(startKey) || []), file])
        return
      }
      const end = new Date(`${sourceWeekKey(file.archiveKey)}T12:00:00+07:00`)
      end.setDate(end.getDate() + 6)
      const endKey = vietnamMonthKey(end)
      ;[...new Set([startKey, endKey])].forEach((key) => {
        groups.set(key, [...(groups.get(key) || []), file])
      })
    })
    return [...groups.entries()]
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([key, entries]) => ({
        key,
        files: entries.sort((left, right) => right.archiveKey.localeCompare(left.archiveKey)),
        weekKeys: [...new Set(entries.filter((file) => file.archiveKind === 'weekly').map((file) => sourceWeekKey(file.archiveKey)))].sort(),
      }))
  }, [visibleFiles])

  useEffect(() => {
    if (!selectedBrowseMonth && !loading) {
      setSelectedBrowseMonth(currentMonthKey)
    }
  }, [currentMonthKey, loading, selectedBrowseMonth])

  const browseGroup = monthGroups.find((group) => group.key === selectedBrowseMonth)
  const selectedYear = Number(selectedBrowseMonth.slice(0, 4)) || new Date().getFullYear()
  const wheelMonths = Array.from({ length: 12 }, (_, index) => `${selectedYear}-${String(index + 1).padStart(2, '0')}`)

  const centerMonth = useCallback((key: string, behavior: ScrollBehavior = 'smooth') => {
    window.requestAnimationFrame(() => {
      const rail = monthRailRef.current
      const item = rail?.querySelector<HTMLElement>(`[data-month-key="${key}"]`)
      if (!rail || !item) return
      rail.scrollTo({ left: item.offsetLeft - (rail.clientWidth - item.offsetWidth) / 2, behavior })
    })
  }, [])

  useEffect(() => {
    if (selectedBrowseMonth && centeredYearRef.current !== selectedYear) {
      centeredYearRef.current = selectedYear
      centerMonth(selectedBrowseMonth, 'auto')
    }
  }, [centerMonth, selectedBrowseMonth, selectedYear])

  const selectYear = (offset: number) => {
    const month = Number(selectedBrowseMonth.slice(5, 7)) || 1
    const key = `${selectedYear + offset}-${String(month).padStart(2, '0')}`
    setSelectedBrowseMonth(key)
    setSelected(null)
    setArchive(null)
  }

  const handleMonthScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const rail = event.currentTarget
    const center = rail.scrollLeft + rail.clientWidth / 2
    let closestKey = selectedBrowseMonth
    let closestDistance = Number.POSITIVE_INFINITY
    rail.querySelectorAll<HTMLElement>('[data-month-key]').forEach((item) => {
      const distance = Math.abs(item.offsetLeft + item.offsetWidth / 2 - center)
      if (distance < closestDistance) {
        closestDistance = distance
        closestKey = item.dataset.monthKey || closestKey
      }
    })
    if (closestKey && closestKey !== selectedBrowseMonth) {
      setSelectedBrowseMonth(closestKey)
      setSelected(null)
      setArchive(null)
    }
  }

  const getArchive = useCallback(async (file: ArchiveFileSummary) => {
    const cached = archiveCache.current.get(file.id)
    if (cached) return cached
    const result = await readArchiveFile(file.id)
    archiveCache.current.set(file.id, result)
    return result
  }, [])

  const openArchive = async (file: ArchiveFileSummary) => {
    if (selected?.id === file.id && archive) {
      setSelected(null)
      setArchive(null)
      return
    }
    setSelected(file)
    setArchive(null)
    setLoadingFile(true)
    setMessage('')
    try {
      setArchive(await getArchive(file))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể mở file lưu trữ.')
    } finally {
      setLoadingFile(false)
    }
  }

  const createTestArchive = async () => {
    if (!testDate || isPreviewMode) return
    setCreatingTest(true)
    setMessage('')
    try {
      const result = await createArchivePreview(testDate)
      await loadFiles()
      if (result.driveFileId) {
        setFiles((current) => current.some((file) => file.id === result.driveFileId) ? current : [{
          id: result.driveFileId!,
          name: result.driveFileName || `employee-portal-week-${result.archiveKey}.json`,
          archiveKey: result.archiveKey,
          size: result.driveFileSize || 0,
          webViewLink: result.driveWebViewLink,
          archiveKind: 'weekly',
        }, ...current])
      }
      setMessage(`Đã tạo bản lưu thử có ${result.documentCount} mục. Firestore không bị xóa.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể tạo bản lưu thử.')
    } finally {
      setCreatingTest(false)
    }
  }

  const createPreviousMonthArchive = async () => {
    if (isPreviewMode || archivingMonth) return
    setArchivingMonth(true)
    setMessage('')
    try {
      const result = await archivePreviousMonth()
      await loadFiles()
      setSelectedBrowseMonth(result.archiveKey)
      setMessage(`Đã lưu tháng ${result.archiveKey}: ${result.documentCount} mục, reset ${result.deletedDocumentCount} mục theo cấu hình.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể lưu dữ liệu tháng trước.')
    } finally {
      setArchivingMonth(false)
    }
  }

  const runFilters = useCallback(async (nextFilter: AppliedFilter, closePanel = false) => {
    const requestId = ++filterRequestIdRef.current
    if (closePanel) setFilterOpen(false)
    setFiltering(true)
    setMessage('')
    try {
      const monthFiles = canonicalFiles(files.filter((file) => fileTouchesMonth(file, nextFilter.month)))
      const currentMonth = vietnamMonthKey(new Date())
      const liveSnapshot = nextFilter.month === currentMonth && !isPreviewMode ? await readCurrentMonthSnapshot(nextFilter.month) : null
      const driveSnapshots = await Promise.all(monthFiles.map(async (file) => ({ file, archive: await getArchive(file) })))
      const loaded: Array<{ file: ArchiveFileSummary | null; archive: WeeklyArchivePayload }> = [
        ...(liveSnapshot ? [{ file: null, archive: liveSnapshot }] : []),
        ...driveSnapshots,
      ]
      const hasMonthlySnapshot = loaded.some(({ file }) => file?.archiveKind === 'monthly')
      const employeeNames = new Map<string, string>()
      loaded.forEach(({ archive: payload }) => {
        ;(payload.records?.employeeProfiles || []).forEach((record) => {
          const fullName = typeof record.data.fullName === 'string' ? record.data.fullName : record.id
          const employeeCode = typeof record.data.employeeCode === 'string' ? record.data.employeeCode : ''
          employeeNames.set(record.id, employeeCode ? `${fullName} · ${employeeCode}` : fullName)
        })
      })

      const query = nextFilter.employee.toLocaleLowerCase('vi')
      const grouped = new Map<string, FilterResult>()
      const seenPaths = new Set<string>()
      loaded.forEach(({ file, archive: payload }) => {
        Object.entries(payload.records || {}).forEach(([collection, records]) => {
          if (collection === 'employeeProfiles' || (nextFilter.collection !== 'all' && collection !== nextFilter.collection)) return
          if (hasMonthlySnapshot && file?.archiveKind === 'weekly' && ['penalties', 'salaryAdvances'].includes(collection)) return
          records.forEach((record) => {
            if (seenPaths.has(record.path)) return
            seenPaths.add(record.path)
            if (!recordBelongsToMonth(collection, record.data, nextFilter.month)) return
            const summary = recordSummary(record, employeeNames)
            const dataText = `${summary.employee} ${summary.employeeId} ${String(record.data.employeeCode || '')} ${String(record.data.employeeName || '')}`.toLocaleLowerCase('vi')
            if (query && !dataText.includes(query)) return
            const batchKey = typeof record.data.batchKey === 'string' ? record.data.batchKey : ''
            const resultKey = collection === 'workSchedules'
              ? `${collection}:${payload.weekStart || payload.monthStart || file?.archiveKey || nextFilter.month}:${batchKey || summary.employeeId || record.id}`
              : `${collection}:${record.path}`
            const existing = grouped.get(resultKey)
            if (existing) {
              existing.records.push(record)
            } else {
              grouped.set(resultKey, {
                key: resultKey,
                collection,
                records: [record],
                employee: summary.employee,
                employeeId: summary.employeeId,
                status: summary.status,
                date: summary.date,
                weekStart: payload.weekStart || payload.monthStart || '',
                weekKey: file?.archiveKind === 'weekly' ? sourceWeekKey(file.archiveKey) : nextFilter.month,
              })
            }
          })
        })
      })
      if (requestId === filterRequestIdRef.current) {
        setFilterResults([...grouped.values()].sort((left, right) => `${right.weekStart}${right.date}`.localeCompare(`${left.weekStart}${left.date}`)))
        setAppliedFilter(nextFilter)
      }
    } catch (error) {
      if (requestId === filterRequestIdRef.current) setMessage(error instanceof Error ? error.message : 'Chưa thể lọc dữ liệu trong tháng này.')
    } finally {
      if (requestId === filterRequestIdRef.current) setFiltering(false)
    }
  }, [files, getArchive, isPreviewMode])

  useEffect(() => {
    if (!selectedBrowseMonth || loading) return
    const timeout = window.setTimeout(() => {
      void runFilters({ month: selectedBrowseMonth, collection: 'all', employee: '' })
    }, 150)
    return () => window.clearTimeout(timeout)
  }, [files, loading, runFilters, selectedBrowseMonth])

  const applyFilters = () => {
    if (!selectedBrowseMonth) return
    void runFilters({ month: selectedBrowseMonth, collection: draftCollection, employee: draftEmployee.trim() }, true)
  }

  const clearFilters = () => {
    setDraftCollection('all')
    setDraftEmployee('')
    if (selectedBrowseMonth) void runFilters({ month: selectedBrowseMonth, collection: 'all', employee: '' })
  }

  const filteredEmployeeGroups = useMemo(() => {
    const groups = new Map<string, FilterResult[]>()
    filterResults.forEach((result) => {
      const employee = result.employeeId ? result.employee : result.collection === 'auditEvents' ? 'Hệ thống' : result.employee
      groups.set(employee, [...(groups.get(employee) || []), result])
    })
    return [...groups.entries()].map(([employee, results]) => ({ employee, results }))
  }, [filterResults])
  const employeeCount = useMemo(() => new Set(filterResults.map((result) => result.employeeId).filter(Boolean)).size, [filterResults])
  const activeFilterCount = appliedFilter ? Number(appliedFilter.collection !== 'all') + Number(Boolean(appliedFilter.employee)) : 0
  const monthCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    filterResults.forEach((result) => {
      counts[result.collection] = (counts[result.collection] || 0) + result.records.length
    })
    return counts
  }, [filterResults])
  const monthTotal = Object.values(monthCounts).reduce((sum, value) => sum + value, 0)
  const displayedMonthCount = new Set([...monthGroups.map((group) => group.key), currentMonthKey]).size

  const exportMonthWord = async () => {
    if (!selectedBrowseMonth || isPreviewMode) return
    setExportingMonth(true)
    setMessage('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) throw new Error('Bạn cần đăng nhập lại.')
      const response = await fetch(`/api/exports/archive-month?month=${encodeURIComponent(selectedBrowseMonth)}`, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('Chưa thể xuất dữ liệu tháng.')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `kho-du-lieu-${selectedBrowseMonth}.docx`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể xuất file Word.')
    } finally {
      setExportingMonth(false)
    }
  }

  const archiveDetails = (payload: WeeklyArchivePayload, file: ArchiveFileSummary) => {
    const employeeNames = new Map(
      (payload.records?.employeeProfiles || []).map((record) => {
        const fullName = typeof record.data.fullName === 'string' ? record.data.fullName : record.id
        const employeeCode = typeof record.data.employeeCode === 'string' ? record.data.employeeCode : ''
        return [record.id, employeeCode ? `${fullName} · ${employeeCode}` : fullName]
      }),
    )
    return (
      <div className="border-t border-slate-100 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-slate-950/30">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Chi tiết {file.archiveKind === 'monthly' ? 'tháng' : 'tuần'}</p>
          {file.webViewLink && <a href={file.webViewLink} target="_blank" rel="noreferrer" className="flex min-h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold dark:border-slate-700 dark:bg-slate-900"><ExternalLink className="h-3.5 w-3.5" /> Drive</a>}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Object.entries(payload.counts || {}).filter(([key]) => key !== 'employeeProfiles').map(([key, count]) => <article key={key} className="rounded-2xl bg-white p-3 shadow-sm dark:bg-slate-900"><p className="text-lg font-black">{count}</p><p className="mt-1 text-xs font-semibold text-muted-foreground">{collectionLabels[key] || key}</p></article>)}
        </div>
        <div className="mt-3 space-y-2">
          {Object.entries(payload.records || {}).filter(([key]) => key !== 'employeeProfiles').map(([key, records]) => (
            <details key={key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3"><span className="text-sm font-extrabold">{collectionLabels[key] || key}</span><Badge variant="outline">{records.length}</Badge></summary>
              <div className="divide-y divide-slate-100 border-t border-slate-100 px-3 dark:divide-white/10 dark:border-white/10">
                {records.map((record) => {
                  const summary = recordSummary(record, employeeNames)
                  return <details key={record.path} className="py-3"><summary className="cursor-pointer list-none"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-bold">{summary.employee}</p><p className="mt-1 text-xs text-muted-foreground">{summary.date || record.id}</p></div>{summary.status && <Badge variant={summary.status === 'Approved' ? 'success' : summary.status === 'Rejected' ? 'destructive' : 'outline'}>{readableValue('status', summary.status)}</Badge>}</div></summary><div className="mt-3 rounded-2xl bg-slate-100 p-3 text-sm dark:bg-slate-800">{readableFields(record).map((field) => <p key={field.label} className="mt-1 first:mt-0"><span className="font-bold">{field.label}:</span> {field.value}</p>)}</div></details>
                })}
              </div>
            </details>
          ))}
        </div>
      </div>
    )
  }

  if ((!role || !['admin', 'manager'].includes(role)) && !isPreviewMode) {
    return <main className="min-h-screen"><Header title="Kho dữ liệu" /><PageContainer><div className="mobile-card p-8 text-center font-bold">Tài khoản không có quyền xem kho dữ liệu.</div></PageContainer></main>
  }

  return (
    <main className="min-h-screen pb-28">
      <Header title="Kho dữ liệu" subtitle="Lịch sử đã lưu an toàn trên Google Drive" />
      <PageContainer maxWidth="2xl">
        <section className="overflow-hidden rounded-[1.75rem] bg-slate-950 p-4 text-white shadow-xl shadow-slate-950/15">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-600"><Archive className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1"><p className="text-[11px] font-bold uppercase tracking-wider text-indigo-300">Lưu trữ dài hạn</p><h1 className="mt-0.5 text-xl font-black">{visibleFiles.length} bản Drive · {displayedMonthCount} tháng</h1><p className="mt-1 text-xs leading-5 text-slate-300">Tháng hiện tại cộng Drive + Firestore; tháng đã chốt chỉ đọc Drive.</p></div>
            <button type="button" onClick={() => void loadFiles()} disabled={loading} aria-label="Tải lại kho dữ liệu" className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/10 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
          </div>
        </section>

        {message && <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">{message}</p>}

        <div className="mt-5 flex items-center justify-between gap-3">
          <div><p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Tra cứu</p><h2 className="text-xl font-black">{appliedFilter ? 'Đang lọc dữ liệu' : 'Theo tháng'}</h2></div>
          <button type="button" onClick={() => setFilterOpen(true)} className="flex min-h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold shadow-sm dark:border-slate-700 dark:bg-slate-900"><SlidersHorizontal className="h-4 w-4" /> Lọc {activeFilterCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-indigo-600 px-1 text-[10px] text-white">{activeFilterCount}</span>}</button>
        </div>

        {selectedBrowseMonth && (
          <section className="mt-3 overflow-hidden rounded-3xl border border-slate-200/80 bg-white/70 py-3 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/70">
            <div className="flex items-center justify-center gap-4 px-3"><button type="button" onClick={() => selectYear(-1)} aria-label="Năm trước" className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><ChevronLeft className="h-4 w-4" /></button><p className="min-w-20 text-center text-sm font-black">Năm {selectedYear}</p><button type="button" onClick={() => selectYear(1)} aria-label="Năm sau" className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><ChevronRight className="h-4 w-4" /></button></div>
            <div className="relative mt-3"><div className="pointer-events-none absolute inset-y-0 left-1/2 z-0 w-[8.5rem] -translate-x-1/2 rounded-2xl bg-indigo-50/70 dark:bg-indigo-500/5" /><nav ref={monthRailRef} aria-label="Bánh xe chọn tháng" onScroll={handleMonthScroll} className="relative z-10 flex snap-x snap-mandatory gap-2 overflow-x-auto px-0 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"><span aria-hidden="true" className="shrink-0" style={{ width: 'calc(50% - 4.25rem)' }} />{wheelMonths.map((key) => { const group = monthGroups.find((item) => item.key === key); const active = key === selectedBrowseMonth; const live = key === currentMonthKey; return <button key={key} data-month-key={key} type="button" onClick={() => { setSelectedBrowseMonth(key); setSelected(null); setArchive(null); centerMonth(key) }} className={`w-[8.5rem] shrink-0 snap-center rounded-2xl border px-3 py-3 text-center transition duration-200 active:scale-[0.98] ${active ? 'scale-100 border-indigo-600 bg-indigo-600 text-white shadow-lg shadow-indigo-600/25' : 'scale-90 border-slate-200 bg-white text-slate-500 opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}><p className="text-[10px] font-bold uppercase tracking-wider">Tháng</p><p className="mt-0.5 text-2xl font-black">{Number(key.slice(5))}</p><p className={`mt-1 text-[10px] font-semibold ${active ? 'text-indigo-100' : 'text-slate-400'}`}>{live ? `${monthTotal} mục hiện tại` : group ? `${group.files.length} bản Drive` : 'Không có dữ liệu Drive'}</p></button>})}<span aria-hidden="true" className="shrink-0" style={{ width: 'calc(50% - 4.25rem)' }} /></nav></div>
            <p className="mt-1 text-center text-[10px] font-semibold text-slate-400">Vuốt ngang để đổi tháng</p>
          </section>
        )}

        <section className="mt-4 rounded-3xl border border-indigo-100 bg-indigo-50/80 p-4 dark:border-indigo-500/20 dark:bg-indigo-500/10">
          <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">Tổng quan {monthLabel(selectedBrowseMonth)} · {selectedBrowseMonth === currentMonthKey ? 'Drive + Firestore' : 'Drive'}</p><h2 className="mt-1 text-xl font-black">{monthTotal} mục dữ liệu · {employeeCount} nhân viên</h2><p className="mt-1 text-[11px] leading-4 text-indigo-700/80 dark:text-indigo-200/80">Tổng tháng gồm cả lịch đã tạo trước cho những ngày sắp tới.</p></div>{activeFilterCount > 0 && <button type="button" onClick={clearFilters} className="shrink-0 rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">Xóa lọc</button>}</div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{Object.entries(monthCounts).filter(([, count]) => count > 0).map(([collection, count]) => <div key={collection} className="rounded-2xl bg-white p-3 shadow-sm dark:bg-slate-900"><p className="text-xs font-semibold text-muted-foreground">{collectionLabels[collection] || collection}</p><p className="mt-1 text-xl font-black">{count}</p></div>)}</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void exportMonthWord()} disabled={exportingMonth || !monthTotal} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-3 text-sm font-bold text-white disabled:opacity-50">{exportingMonth ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Xuất Word</button>
            <button type="button" onClick={() => setShowWeeklyDetails((current) => !current)} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-3 text-sm font-bold text-slate-700 shadow-sm dark:bg-slate-900 dark:text-slate-200"><Eye className="h-4 w-4" /> {showWeeklyDetails ? 'Ẩn chi tiết' : 'Xem chi tiết'}</button>
          </div>
        </section>

        {loading || filtering ? (
          <div className="grid min-h-56 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>
        ) : activeFilterCount > 0 ? (
          <section className="mt-4 space-y-3">
            {filteredEmployeeGroups.map((group) => (
              <article key={group.employee} className="mobile-card overflow-hidden">
                <header className="flex items-center gap-3 border-b border-slate-100 p-4 dark:border-white/10"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-600 text-sm font-black text-white">{group.employee.trim().charAt(0).toLocaleUpperCase('vi')}</div><div className="min-w-0 flex-1"><h3 className="truncate font-black">{group.employee}</h3><p className="mt-1 text-xs text-muted-foreground">{group.results.length} hoạt động trong {monthLabel(selectedBrowseMonth).toLocaleLowerCase('vi')}</p></div></header>
                <div className="divide-y divide-slate-100 px-4 dark:divide-white/10">{group.results.map((result) => <details key={result.key} className="py-1"><summary className="flex cursor-pointer list-none items-center gap-3 py-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10"><Database className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-extrabold">{collectionLabels[result.collection] || result.collection}</p>{result.status && <Badge variant={result.status === 'Approved' ? 'success' : result.status === 'Rejected' ? 'destructive' : 'outline'}>{readableValue('status', result.status)}</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">{result.collection === 'workSchedules' ? `${result.records.length} ca · ${weekRange(result.weekKey)}` : result.date || weekRange(result.weekKey)}</p></div><ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /></summary><div className="space-y-2 pb-3">{result.records.map((record) => <div key={record.path} className="rounded-2xl bg-slate-50 p-3 text-sm dark:bg-slate-800">{readableFields(record).map((field) => <p key={field.label} className="mt-1 first:mt-0"><span className="font-bold">{field.label}:</span> {field.value}</p>)}</div>)}</div></details>)}</div>
              </article>
            ))}
            {!filterResults.length && <div className="mobile-card p-8 text-center"><Database className="mx-auto h-8 w-8 text-slate-400" /><h2 className="mt-3 font-extrabold">Không tìm thấy dữ liệu</h2><p className="mt-1 text-sm text-muted-foreground">Thử bỏ tên nhân viên hoặc chọn loại dữ liệu khác.</p></div>}
          </section>
        ) : showWeeklyDetails ? (
          <section className="mt-4 space-y-3">
            <div className="flex items-end justify-between gap-3 px-1"><div><h2 className="font-black">Các bản lưu trong {monthLabel(selectedBrowseMonth).toLocaleLowerCase('vi')}</h2><p className="mt-1 text-xs text-muted-foreground">Bản tháng chứa khoản phạt và ứng lương; bản tuần chứa lịch làm.</p></div><Badge variant="outline">{browseGroup?.files.length || 0} bản</Badge></div>
            {browseGroup?.files.map((file) => {
                    const weekKey = sourceWeekKey(file.archiveKey)
                    const weekNumber = browseGroup.weekKeys.indexOf(weekKey) + 1
                    const monthly = file.archiveKind === 'monthly'
                    return <div key={file.id} className="mobile-card overflow-hidden"><button type="button" onClick={() => void openArchive(file)} className="flex w-full items-center gap-3 p-4 text-left"><div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${monthly ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10' : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10'}`}><CalendarDays className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-extrabold">{monthly ? 'Bản chốt tháng' : `Tuần ${weekNumber}`}</h3>{file.archiveKey.includes('-test-') && <Badge variant="outline">Bản thử</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">{monthly ? monthLabel(file.archiveKey) : weekRange(weekKey)} · {bytes(file.size)}</p></div>{selected?.id === file.id && loadingFile ? <Loader2 className="h-5 w-5 animate-spin text-indigo-600" /> : <ChevronDown className={`h-5 w-5 text-slate-400 transition ${selected?.id === file.id ? 'rotate-180' : ''}`} />}</button>{selected?.id === file.id && archive && archiveDetails(archive, file)}</div>
                  })}
            {!browseGroup && <div className="mobile-card p-8 text-center"><CalendarDays className="mx-auto h-8 w-8 text-slate-300" /><h2 className="mt-3 font-extrabold">Tháng này chưa có dữ liệu</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Khi có bản lưu tuần, dữ liệu sẽ tự xuất hiện tại đây.</p></div>}
          </section>
        ) : null}

        <details className="group mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <summary className="flex cursor-pointer list-none items-center gap-3 p-4"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10"><FlaskConical className="h-4 w-4" /></div><div className="min-w-0 flex-1"><h2 className="text-sm font-extrabold">Công cụ kiểm thử</h2><p className="mt-0.5 text-xs text-muted-foreground">Tạo bản thử bằng ngày lùi khi cần kiểm tra.</p></div><ChevronDown className="h-5 w-5 text-slate-400 transition group-open:rotate-180" /></summary>
          <div className="border-t border-slate-100 p-4 dark:border-white/10"><p className="text-xs leading-5 text-muted-foreground">Tạo bù tháng trước dùng đúng quy trình Drive → xác minh → reset. File test tuần không xóa Firebase.</p><button type="button" onClick={() => void createPreviousMonthArchive()} disabled={archivingMonth || isPreviewMode} className="mt-3 flex min-h-12 w-full items-center justify-center rounded-2xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-50">{archivingMonth ? 'Đang lưu tháng trước...' : 'Lưu tháng trước ngay'}</button><input type="date" value={testDate} onChange={(event) => setTestDate(event.target.value)} className="mobile-field mt-3 min-w-0 !px-4 text-sm" /><button type="button" onClick={() => void createTestArchive()} disabled={creatingTest || isPreviewMode} className="mt-2 flex min-h-12 w-full items-center justify-center rounded-2xl bg-indigo-600 px-4 text-sm font-bold text-white disabled:opacity-50">{creatingTest ? 'Đang tạo...' : 'Tạo bản thử tuần'}</button></div>
        </details>
      </PageContainer>

      {filterOpen && (
        <div className="fixed inset-0 z-[75] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setFilterOpen(false)}>
          <section role="dialog" aria-modal="true" aria-labelledby="archive-filter-title" className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] bg-white p-5 shadow-2xl dark:bg-slate-900 sm:rounded-[2rem]" onClick={(event) => event.stopPropagation()}>
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200 sm:hidden" />
            <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Tra cứu kho</p><h2 id="archive-filter-title" className="text-xl font-black">Bộ lọc</h2></div><button type="button" onClick={() => setFilterOpen(false)} aria-label="Đóng bộ lọc" className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 dark:bg-slate-800"><X className="h-5 w-5" /></button></div>

            <div className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50 p-3 dark:border-indigo-500/20 dark:bg-indigo-500/10"><p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Tháng đang xem</p><p className="mt-1 font-black">{monthLabel(selectedBrowseMonth)}</p><p className="mt-1 text-xs leading-5 text-indigo-700/80 dark:text-indigo-200/80">Đóng bảng lọc và vuốt vòng tháng để đổi thời gian.</p></div>

            <fieldset className="mt-5"><legend className="text-sm font-extrabold">Loại dữ liệu</legend><div className="mt-2 flex flex-wrap gap-2">{filterCollections.map(([key, label]) => <button key={key} type="button" onClick={() => setDraftCollection(key)} className={`min-h-10 rounded-full border px-3 text-xs font-bold transition ${draftCollection === key ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}>{label}</button>)}</div></fieldset>

            <label className="mt-5 block text-sm font-extrabold">Nhân viên <span className="font-normal text-muted-foreground">(không bắt buộc)</span><input value={draftEmployee} onChange={(event) => setDraftEmployee(event.target.value)} className="mobile-field mt-2" placeholder="Nhập tên hoặc mã nhân viên" /></label>

            <div className="mt-6 grid grid-cols-[auto_1fr] gap-2"><button type="button" onClick={() => { setDraftCollection('all'); setDraftEmployee('') }} className="min-h-12 rounded-2xl border border-slate-200 px-4 text-sm font-bold dark:border-slate-700">Đặt lại</button><button type="button" onClick={applyFilters} disabled={!selectedBrowseMonth} className="min-h-12 rounded-2xl bg-indigo-600 px-4 text-sm font-bold text-white disabled:opacity-50">Áp dụng bộ lọc</button></div>
          </section>
        </div>
      )}
    </main>
  )
}
