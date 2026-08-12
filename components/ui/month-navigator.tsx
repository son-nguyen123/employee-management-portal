'use client'

import { Archive, ChevronLeft, ChevronRight, Database, Layers3, Loader2 } from 'lucide-react'
import type { MonthDataSource } from '@/lib/services/monthDataService'

function shiftMonth(value: string, offset: number): string {
  const [year, month] = value.split('-').map(Number)
  const next = new Date(year, month - 1 + offset, 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
}

export function MonthNavigator({ value, onChange, loading = false, count, countLabel, source = 'firestore' }: {
  value: string
  onChange: (month: string) => void
  loading?: boolean
  count?: number
  countLabel?: string
  source?: MonthDataSource
}) {
  const SourceIcon = source === 'merged' ? Layers3 : source === 'drive' ? Archive : Database
  const sourceLabel = source === 'merged' ? 'Firebase + Drive' : source === 'drive' ? 'Drive' : 'Firebase'
  return (
    <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => onChange(shiftMonth(value, -1))} aria-label="Tháng trước" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><ChevronLeft className="h-4 w-4" /></button>
        <label className="relative min-w-0 cursor-pointer px-3 text-center">
          <span className="flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Dữ liệu theo tháng {loading && <Loader2 className="h-3 w-3 animate-spin" />}</span>
          <span className="mt-0.5 block text-sm font-black">Tháng {Number(value.slice(5))}/{value.slice(0, 4)}</span>
          <input type="month" value={value} onChange={(event) => event.target.value && onChange(event.target.value)} aria-label="Chọn tháng dữ liệu" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </label>
        <button type="button" onClick={() => onChange(shiftMonth(value, 1))} aria-label="Tháng sau" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><ChevronRight className="h-4 w-4" /></button>
      </div>
      {typeof count === 'number' && (
        <div className="mt-1 flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/70">
          <span className="flex min-w-0 items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-300"><SourceIcon className="h-3.5 w-3.5 shrink-0 text-indigo-500" />{loading ? 'Đang tải dữ liệu' : sourceLabel}</span>
          <span className="shrink-0 rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-black text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200">{loading ? '…' : `${count} ${countLabel || 'mục'}`}</span>
        </div>
      )}
    </div>
  )
}
