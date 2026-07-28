'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { ShieldCheck, UserRound } from 'lucide-react'
import { enablePreviewMode } from '@/lib/config/demo'

export function SkipLoginFAB() {
  const pathname = usePathname()
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    setIsVisible(
      process.env.NODE_ENV === 'development' &&
        (pathname === '/auth/login' || pathname === '/auth/signup')
    )
  }, [pathname])

  if (!isVisible) return null

  const enterPreview = (role: 'admin' | 'employee') => {
    enablePreviewMode(role)
    window.location.assign('/')
  }

  return (
    <aside className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-sm rounded-3xl border border-white/80 bg-white/95 p-3 shadow-2xl shadow-indigo-950/15 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/95">
      <div className="mb-2 px-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-indigo-600">
          Chế độ phát triển
        </p>
        <p className="text-xs text-muted-foreground">Truy cập nhanh để kiểm tra giao diện</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => enterPreview('admin')}
          className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-2 text-sm font-semibold text-white transition active:scale-[0.98] dark:bg-white dark:text-slate-900"
        >
          <ShieldCheck className="h-4 w-4" />
          Vai quản lý
        </button>
        <button
          type="button"
          onClick={() => enterPreview('employee')}
          className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-2 text-sm font-semibold text-white transition active:scale-[0.98]"
        >
          <UserRound className="h-4 w-4" />
          Vai nhân viên
        </button>
      </div>
    </aside>
  )
}
