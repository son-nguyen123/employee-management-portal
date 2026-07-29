'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, CalendarDays, ChevronDown, Database, ExternalLink, FlaskConical, Loader2, RefreshCw, Search } from 'lucide-react'
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

function recordSummary(record: ArchivedRecord, employeeNames: Map<string, string>) {
  const data = record.data || {}
  const employeeId = typeof data.employeeId === 'string' ? data.employeeId : ''
  const employee = employeeNames.get(employeeId) || employeeId || record.id
  const status = typeof data.status === 'string' ? data.status : ''
  const date = displayDate(data.date || data.leaveDate || data.penaltyDate || data.createdAt)
  return { employee, status, date }
}

export default function AdminArchivePage() {
  const { authUser, isPreviewMode } = useAuth()
  const role = useUserRole()
  const [files, setFiles] = useState<ArchiveFileSummary[]>([])
  const [selected, setSelected] = useState<ArchiveFileSummary | null>(null)
  const [archive, setArchive] = useState<WeeklyArchivePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingFile, setLoadingFile] = useState(false)
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [testDate, setTestDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 7)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  })
  const [creatingTest, setCreatingTest] = useState(false)

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

  const openArchive = async (file: ArchiveFileSummary) => {
    setSelected(file)
    setArchive(null)
    setLoadingFile(true)
    setMessage('')
    try {
      setArchive(await readArchiveFile(file.id))
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
      setMessage(`Đã tạo bản lưu thử có ${result.documentCount} mục. Firestore không bị xóa.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể tạo bản lưu thử.')
    } finally {
      setCreatingTest(false)
    }
  }

  const visibleFiles = files.filter((file) =>
    `${file.archiveKey} ${file.name}`.toLowerCase().includes(search.trim().toLowerCase())
  )
  const employeeNames = useMemo(() => new Map(
    (archive?.records?.employeeProfiles || []).map((record) => {
      const fullName = typeof record.data.fullName === 'string' ? record.data.fullName : record.id
      const employeeCode = typeof record.data.employeeCode === 'string' ? record.data.employeeCode : ''
      return [record.id, employeeCode ? `${fullName} · ${employeeCode}` : fullName]
    })
  ), [archive])

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
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-wider text-indigo-300">Lưu trữ dài hạn</p>
              <h1 className="mt-1 text-xl font-black">{files.length} tuần đã lưu</h1>
              <p className="mt-1 text-xs leading-5 text-slate-300">Dữ liệu được đọc từ Drive; việc xem kho không khôi phục hay thay đổi Firestore.</p>
            </div>
            <button type="button" onClick={() => void loadFiles()} disabled={loading} aria-label="Tải lại kho dữ liệu" className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
          </div>
        </section>

        <section className="mt-4 rounded-3xl border border-indigo-100 bg-white p-4 shadow-sm dark:border-indigo-500/20 dark:bg-slate-900">
          <div className="flex items-start gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10"><FlaskConical className="h-5 w-5" /></div><div><h2 className="font-extrabold">Kiểm thử bằng ngày lùi</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Chọn một ngày thuộc tuần muốn kiểm tra. Hệ thống tạo file test thật trên Drive nhưng không xóa dữ liệu Firebase.</p></div></div>
          <div className="mt-4 grid grid-cols-[1fr_auto] gap-2"><input type="date" value={testDate} onChange={(event) => setTestDate(event.target.value)} className="mobile-field" /><button type="button" onClick={() => void createTestArchive()} disabled={creatingTest || isPreviewMode} className="min-h-12 rounded-2xl bg-indigo-600 px-4 text-sm font-bold text-white disabled:opacity-50">{creatingTest ? 'Đang tạo...' : 'Tạo bản thử'}</button></div>
        </section>

        {message && <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">{message}</p>}

        <label className="relative mt-5 block">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="mobile-field pl-11" placeholder="Tìm theo tuần, ví dụ 2026-07-20" />
        </label>

        {loading ? (
          <div className="grid min-h-56 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>
        ) : (
          <section className="mt-4 space-y-3">
            {visibleFiles.map((file) => (
              <button key={file.id} type="button" onClick={() => void openArchive(file)} className={`mobile-card flex w-full items-center gap-3 p-4 text-left transition ${selected?.id === file.id ? 'ring-2 ring-indigo-500' : ''}`}>
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10"><CalendarDays className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-extrabold">Tuần {new Date(`${file.archiveKey}T12:00:00`).toLocaleDateString('vi-VN')}</h2>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{file.name} · {bytes(file.size)}</p>
                </div>
                {selected?.id === file.id && loadingFile ? <Loader2 className="h-5 w-5 animate-spin text-indigo-600" /> : <ChevronDown className="h-5 w-5 text-slate-400" />}
              </button>
            ))}
            {!visibleFiles.length && !message && <div className="mobile-card p-8 text-center"><Database className="mx-auto h-8 w-8 text-slate-400" /><h2 className="mt-3 font-extrabold">Chưa có bản lưu</h2><p className="mt-1 text-sm text-muted-foreground">Bản lưu tuần sẽ xuất hiện sau khi tác vụ lưu trữ chạy thành công.</p></div>}
          </section>
        )}

        {archive && selected && (
          <section className="mt-6">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div><p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Chi tiết bản lưu</p><h2 className="text-xl font-black">Tuần {displayDate(archive.weekStart)}</h2></div>
              {selected.webViewLink && <a href={selected.webViewLink} target="_blank" rel="noreferrer" className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-bold dark:border-slate-700"><ExternalLink className="h-4 w-4" /> Mở Drive</a>}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.entries(archive.counts || {}).filter(([key]) => key !== 'employeeProfiles').map(([key, count]) => <article key={key} className="mobile-card p-3"><p className="text-xl font-black">{count}</p><p className="mt-1 text-xs font-semibold text-muted-foreground">{collectionLabels[key] || key}</p></article>)}
            </div>
            <div className="mt-4 space-y-3">
              {Object.entries(archive.records || {}).filter(([key]) => key !== 'employeeProfiles').map(([key, records]) => (
                <details key={key} className="mobile-card overflow-hidden">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4"><span className="font-extrabold">{collectionLabels[key] || key}</span><Badge variant="outline">{records.length} mục</Badge></summary>
                  <div className="divide-y divide-slate-100 border-t border-slate-100 px-4 dark:divide-white/10 dark:border-white/10">
                    {records.map((record) => {
                      const summary = recordSummary(record, employeeNames)
                      return <details key={record.path} className="py-3"><summary className="cursor-pointer list-none"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-bold">{summary.employee}</p><p className="mt-1 text-xs text-muted-foreground">{summary.date || record.id}</p></div>{summary.status && <Badge variant={summary.status === 'Approved' ? 'success' : summary.status === 'Rejected' ? 'destructive' : 'outline'}>{summary.status}</Badge>}</div></summary><pre className="mt-3 max-h-72 overflow-auto rounded-2xl bg-slate-950 p-3 text-[11px] leading-5 text-slate-200">{JSON.stringify(record.data, null, 2)}</pre></details>
                    })}
                    {!records.length && <p className="py-4 text-sm text-muted-foreground">Không có dữ liệu trong nhóm này.</p>}
                  </div>
                </details>
              ))}
            </div>
          </section>
        )}
      </PageContainer>
    </main>
  )
}
