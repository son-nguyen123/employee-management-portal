'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  CalendarDays,
  ChevronDown,
  Database,
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
  type ArchiveFileSummary,
  type ArchivedRecord,
  type WeeklyArchivePayload,
} from '@/lib/services/archiveService'

const collectionLabels: Record<string, string> = {
  workSchedules: 'Lịch làm',
  leaveRequests: 'Xin nghỉ',
  lateRequests: 'Đi trễ',
  salaryAdvances: 'Ứng lương',
  penalties: 'Khoản phạt',
  employeeProfiles: 'Hồ sơ tham chiếu',
}

const filterCollections = [
  ['all', 'Tất cả'],
  ['workSchedules', 'Lịch làm'],
  ['leaveRequests', 'Xin nghỉ'],
  ['lateRequests', 'Đi trễ'],
  ['salaryAdvances', 'Ứng lương'],
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

function localMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function fileTouchesMonth(file: ArchiveFileSummary, targetMonth: string) {
  const start = new Date(`${sourceWeekKey(file.archiveKey)}T12:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return localMonthKey(start) === targetMonth || localMonthKey(end) === targetMonth
}

function recordBelongsToMonth(collection: string, data: Record<string, unknown>, targetMonth: string) {
  const [year, month] = targetMonth.split('-').map(Number)
  const monthStart = new Date(year, month - 1, 1)
  const monthEnd = new Date(year, month, 1)
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

function canonicalFiles(files: ArchiveFileSummary[]) {
  const byWeek = new Map<string, ArchiveFileSummary>()
  files.forEach((file) => {
    const week = sourceWeekKey(file.archiveKey)
    const current = byWeek.get(week)
    if (!current || (current.archiveKey.includes('-test-') && !file.archiveKey.includes('-test-'))) {
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
  const [filterOpen, setFilterOpen] = useState(false)
  const [draftMonth, setDraftMonth] = useState('')
  const [draftCollection, setDraftCollection] = useState<FilterCollection>('all')
  const [draftEmployee, setDraftEmployee] = useState('')
  const [appliedFilter, setAppliedFilter] = useState<AppliedFilter | null>(null)
  const [filterResults, setFilterResults] = useState<FilterResult[]>([])
  const [filtering, setFiltering] = useState(false)
  const [openMonths, setOpenMonths] = useState<Set<string>>(() => new Set())

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
    files.forEach((file) => groups.set(monthKey(file), [...(groups.get(monthKey(file)) || []), file]))
    return [...groups.entries()]
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([key, entries]) => ({
        key,
        files: entries.sort((left, right) => right.archiveKey.localeCompare(left.archiveKey)),
        weekKeys: [...new Set(entries.map((file) => sourceWeekKey(file.archiveKey)))].sort(),
      }))
  }, [files])

  const filterMonths = useMemo(() => {
    const months = new Set<string>()
    files.forEach((file) => {
      const start = new Date(`${sourceWeekKey(file.archiveKey)}T12:00:00`)
      const end = new Date(start)
      end.setDate(end.getDate() + 6)
      months.add(localMonthKey(start))
      months.add(localMonthKey(end))
    })
    return [...months].sort((left, right) => right.localeCompare(left))
  }, [files])

  useEffect(() => {
    if (!draftMonth && filterMonths[0]) setDraftMonth(filterMonths[0])
    if (monthGroups[0]) setOpenMonths((current) => current.size ? current : new Set([monthGroups[0].key]))
  }, [draftMonth, filterMonths, monthGroups])

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
        }, ...current])
      }
      setMessage(`Đã tạo bản lưu thử có ${result.documentCount} mục. Firestore không bị xóa.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể tạo bản lưu thử.')
    } finally {
      setCreatingTest(false)
    }
  }

  const applyFilters = async () => {
    if (!draftMonth) return
    const nextFilter = { month: draftMonth, collection: draftCollection, employee: draftEmployee.trim() }
    setFilterOpen(false)
    setFiltering(true)
    setMessage('')
    try {
      const monthFiles = canonicalFiles(files.filter((file) => fileTouchesMonth(file, draftMonth)))
      const loaded = await Promise.all(monthFiles.map(async (file) => ({ file, archive: await getArchive(file) })))
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
      loaded.forEach(({ file, archive: payload }) => {
        Object.entries(payload.records || {}).forEach(([collection, records]) => {
          if (collection === 'employeeProfiles' || (nextFilter.collection !== 'all' && collection !== nextFilter.collection)) return
          records.forEach((record) => {
            if (!recordBelongsToMonth(collection, record.data, nextFilter.month)) return
            const summary = recordSummary(record, employeeNames)
            const dataText = `${summary.employee} ${summary.employeeId} ${String(record.data.employeeCode || '')} ${String(record.data.employeeName || '')}`.toLocaleLowerCase('vi')
            if (query && !dataText.includes(query)) return
            const batchKey = typeof record.data.batchKey === 'string' ? record.data.batchKey : ''
            const resultKey = collection === 'workSchedules'
              ? `${collection}:${payload.weekStart}:${batchKey || summary.employeeId || record.id}`
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
                status: summary.status,
                date: summary.date,
                weekStart: payload.weekStart,
                weekKey: sourceWeekKey(file.archiveKey),
              })
            }
          })
        })
      })
      setFilterResults([...grouped.values()].sort((left, right) => `${right.weekStart}${right.date}`.localeCompare(`${left.weekStart}${left.date}`)))
      setAppliedFilter(nextFilter)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể lọc dữ liệu trong tháng này.')
    } finally {
      setFiltering(false)
    }
  }

  const clearFilters = () => {
    setAppliedFilter(null)
    setFilterResults([])
    setDraftCollection('all')
    setDraftEmployee('')
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
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Chi tiết tuần</p>
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
                  return <details key={record.path} className="py-3"><summary className="cursor-pointer list-none"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-bold">{summary.employee}</p><p className="mt-1 text-xs text-muted-foreground">{summary.date || record.id}</p></div>{summary.status && <Badge variant={summary.status === 'Approved' ? 'success' : summary.status === 'Rejected' ? 'destructive' : 'outline'}>{summary.status}</Badge>}</div></summary><pre className="mt-3 max-h-72 overflow-auto rounded-2xl bg-slate-950 p-3 text-[11px] leading-5 text-slate-200">{JSON.stringify(record.data, null, 2)}</pre></details>
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
    <main className="min-h-screen pb-8">
      <Header title="Kho dữ liệu" subtitle="Lịch sử đã lưu an toàn trên Google Drive" />
      <PageContainer maxWidth="2xl">
        <section className="overflow-hidden rounded-[1.75rem] bg-slate-950 p-5 text-white shadow-xl shadow-slate-950/15">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-indigo-600"><Archive className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-wider text-indigo-300">Lưu trữ dài hạn</p><h1 className="mt-1 text-xl font-black">{files.length} bản · {monthGroups.length} tháng</h1><p className="mt-1 text-xs leading-5 text-slate-300">Mỗi bản theo tuần Thứ Hai–Chủ Nhật; tháng có thể gồm 4 hoặc 5 tuần.</p></div>
            <button type="button" onClick={() => void loadFiles()} disabled={loading} aria-label="Tải lại kho dữ liệu" className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/10 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
          </div>
        </section>

        <section className="mt-4 rounded-3xl border border-indigo-100 bg-white p-4 shadow-sm dark:border-indigo-500/20 dark:bg-slate-900">
          <div className="flex items-start gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10"><FlaskConical className="h-5 w-5" /></div><div><h2 className="font-extrabold">Kiểm thử bằng ngày lùi</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Tạo file test thật trên Drive nhưng không xóa dữ liệu Firebase.</p></div></div>
          <div className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2"><input type="date" value={testDate} onChange={(event) => setTestDate(event.target.value)} className="mobile-field min-w-0 !px-4 text-sm" /><button type="button" onClick={() => void createTestArchive()} disabled={creatingTest || isPreviewMode} className="min-h-12 shrink-0 whitespace-nowrap rounded-2xl bg-indigo-600 px-4 text-sm font-bold text-white disabled:opacity-50">{creatingTest ? 'Đang tạo...' : 'Tạo bản thử'}</button></div>
        </section>

        {message && <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">{message}</p>}

        <div className="mt-5 flex items-center justify-between gap-3">
          <div><p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Tra cứu</p><h2 className="text-xl font-black">{appliedFilter ? `${filterResults.length} kết quả` : 'Theo tháng'}</h2></div>
          <button type="button" onClick={() => setFilterOpen(true)} className="flex min-h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold shadow-sm dark:border-slate-700 dark:bg-slate-900"><SlidersHorizontal className="h-4 w-4" /> Lọc {appliedFilter && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-indigo-600 px-1 text-[10px] text-white">{1 + Number(appliedFilter.collection !== 'all') + Number(Boolean(appliedFilter.employee))}</span>}</button>
        </div>

        {appliedFilter && <div className="mt-3 flex gap-2 overflow-x-auto pb-1"><span className="shrink-0 rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white">{monthLabel(appliedFilter.month)}</span>{appliedFilter.collection !== 'all' && <span className="shrink-0 rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-200">{collectionLabels[appliedFilter.collection]}</span>}{appliedFilter.employee && <span className="shrink-0 rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-200">{appliedFilter.employee}</span>}<button type="button" onClick={clearFilters} className="shrink-0 px-2 text-xs font-bold text-slate-500">Xóa lọc</button></div>}

        {loading || filtering ? (
          <div className="grid min-h-56 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>
        ) : appliedFilter ? (
          <section className="mt-4 space-y-3">
            {filterResults.map((result) => (
              <details key={result.key} className="mobile-card overflow-hidden">
                <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10"><Database className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-extrabold">{result.employee}</p><Badge variant="outline">{collectionLabels[result.collection] || result.collection}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{result.collection === 'workSchedules' ? `${result.records.length} ca · ${weekRange(result.weekKey)}` : result.date || weekRange(result.weekKey)}</p></div>
                  <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" />
                </summary>
                <div className="border-t border-slate-100 p-3 dark:border-white/10"><pre className="max-h-80 overflow-auto rounded-2xl bg-slate-950 p-3 text-[11px] leading-5 text-slate-200">{JSON.stringify(result.records.map((record) => record.data), null, 2)}</pre></div>
              </details>
            ))}
            {!filterResults.length && <div className="mobile-card p-8 text-center"><Database className="mx-auto h-8 w-8 text-slate-400" /><h2 className="mt-3 font-extrabold">Không tìm thấy dữ liệu</h2><p className="mt-1 text-sm text-muted-foreground">Thử bỏ tên nhân viên hoặc chọn loại dữ liệu khác.</p></div>}
          </section>
        ) : (
          <section className="mt-4 space-y-3">
            {monthGroups.map((group) => (
              <details key={group.key} open={openMonths.has(group.key)} onToggle={(event) => { const isOpen = event.currentTarget.open; setOpenMonths((current) => { const next = new Set(current); if (isOpen) next.add(group.key); else next.delete(group.key); return next }) }} className="mobile-card overflow-hidden">
                <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-indigo-600 text-sm font-black text-white">T{Number(group.key.slice(5))}</div>
                  <div className="min-w-0 flex-1"><h2 className="font-black">{monthLabel(group.key)}</h2><p className="mt-1 text-xs text-muted-foreground">{group.weekKeys.length} tuần · {group.files.length} bản lưu</p></div>
                  <ChevronDown className="h-5 w-5 text-slate-400" />
                </summary>
                <div className="space-y-2 border-t border-slate-100 p-3 dark:border-white/10">
                  {group.files.map((file) => {
                    const weekKey = sourceWeekKey(file.archiveKey)
                    const weekNumber = group.weekKeys.indexOf(weekKey) + 1
                    return <div key={file.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900"><button type="button" onClick={() => void openArchive(file)} className="flex w-full items-center gap-3 p-3 text-left"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10"><CalendarDays className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-extrabold">Tuần {weekNumber}</h3>{file.archiveKey.includes('-test-') && <Badge variant="outline">Bản thử</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">{weekRange(weekKey)} · {bytes(file.size)}</p></div>{selected?.id === file.id && loadingFile ? <Loader2 className="h-5 w-5 animate-spin text-indigo-600" /> : <ChevronDown className="h-5 w-5 text-slate-400" />}</button>{selected?.id === file.id && archive && archiveDetails(archive, file)}</div>
                  })}
                </div>
              </details>
            ))}
            {!monthGroups.length && !message && <div className="mobile-card p-8 text-center"><Database className="mx-auto h-8 w-8 text-slate-400" /><h2 className="mt-3 font-extrabold">Chưa có bản lưu</h2><p className="mt-1 text-sm text-muted-foreground">Bản lưu tuần sẽ xuất hiện sau khi tác vụ lưu trữ chạy thành công.</p></div>}
          </section>
        )}
      </PageContainer>

      {filterOpen && (
        <div className="fixed inset-0 z-[75] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setFilterOpen(false)}>
          <section role="dialog" aria-modal="true" aria-labelledby="archive-filter-title" className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] bg-white p-5 shadow-2xl dark:bg-slate-900 sm:rounded-[2rem]" onClick={(event) => event.stopPropagation()}>
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200 sm:hidden" />
            <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Tra cứu kho</p><h2 id="archive-filter-title" className="text-xl font-black">Bộ lọc</h2></div><button type="button" onClick={() => setFilterOpen(false)} aria-label="Đóng bộ lọc" className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 dark:bg-slate-800"><X className="h-5 w-5" /></button></div>

            <label className="mt-5 block text-sm font-extrabold">Tháng<select value={draftMonth} onChange={(event) => setDraftMonth(event.target.value)} className="mobile-field mt-2">{filterMonths.map((key) => <option key={key} value={key}>{monthLabel(key)}</option>)}</select></label>

            <fieldset className="mt-5"><legend className="text-sm font-extrabold">Loại dữ liệu</legend><div className="mt-2 flex flex-wrap gap-2">{filterCollections.map(([key, label]) => <button key={key} type="button" onClick={() => setDraftCollection(key)} className={`min-h-10 rounded-full border px-3 text-xs font-bold transition ${draftCollection === key ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}>{label}</button>)}</div></fieldset>

            <label className="mt-5 block text-sm font-extrabold">Nhân viên <span className="font-normal text-muted-foreground">(không bắt buộc)</span><input value={draftEmployee} onChange={(event) => setDraftEmployee(event.target.value)} className="mobile-field mt-2" placeholder="Nhập tên hoặc mã nhân viên" /></label>

            <div className="mt-6 grid grid-cols-[auto_1fr] gap-2"><button type="button" onClick={() => { setDraftCollection('all'); setDraftEmployee('') }} className="min-h-12 rounded-2xl border border-slate-200 px-4 text-sm font-bold dark:border-slate-700">Đặt lại</button><button type="button" onClick={() => void applyFilters()} disabled={!draftMonth} className="min-h-12 rounded-2xl bg-indigo-600 px-4 text-sm font-bold text-white disabled:opacity-50">Xem kết quả</button></div>
          </section>
        </div>
      )}
    </main>
  )
}
