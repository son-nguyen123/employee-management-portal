'use client'

import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Badge } from '../ui/badge'

interface NavItem {
  href: string
  icon: React.ReactNode
  label: string
  badge?: number | string
}

interface BottomNavProps {
  items: NavItem[]
  className?: string
}

const BottomNav = React.forwardRef<HTMLDivElement, BottomNavProps>(
  ({ items, className = '' }, ref) => {
    const pathname = usePathname()
    const router = useRouter()
    const hrefKey = items.map((item) => item.href).join('|')
    const [mounted, setMounted] = useState(false)
    const [navigating, setNavigating] = useState(false)
    const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => setMounted(true), [])

    useEffect(() => () => {
      if (navigationTimer.current) clearTimeout(navigationTimer.current)
    }, [])

    useEffect(() => {
      setNavigating(false)
      if (navigationTimer.current) {
        clearTimeout(navigationTimer.current)
        navigationTimer.current = null
      }
    }, [pathname])

    useEffect(() => {
      if (!mounted) return
      const hrefs = hrefKey.split('|').filter(Boolean)
      const prefetch = () => hrefs.forEach((href) => router.prefetch(href))
      const idle = window.setTimeout(prefetch, 500)
      return () => window.clearTimeout(idle)
    }, [hrefKey, mounted, router])

    const startNavigation = (href: string) => {
      if (href === pathname || href.startsWith(`${pathname}/`)) return
      setNavigating(true)
      if (navigationTimer.current) clearTimeout(navigationTimer.current)
      navigationTimer.current = setTimeout(() => {
        setNavigating(false)
        navigationTimer.current = null
      }, 10000)
    }

    if (!mounted) return null

    return createPortal(
      <>
        {navigating && (
          <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden bg-indigo-100/70 dark:bg-indigo-950/70" role="status" aria-label="Đang mở trang">
            <span className="block h-full w-1/3 animate-[nav-progress_1.1s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-fuchsia-500 via-indigo-600 to-sky-500" />
          </div>
        )}
        <div
        data-app-bottom-navigation
        ref={ref}
        className={`fixed isolate touch-manipulation inset-x-0 bottom-0 z-[60] [transform:translate3d(0,0,0)] border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_20px_rgba(15,23,42,0.07)] [backface-visibility:hidden] dark:border-white/10 dark:bg-slate-950 md:inset-x-auto md:bottom-5 md:left-1/2 md:w-[min(40rem,calc(100vw-3rem))] md:-translate-x-1/2 md:rounded-[1.75rem] md:border md:bg-white/95 md:pb-0 md:shadow-[0_20px_55px_rgba(15,23,42,0.2)] md:backdrop-blur-xl md:dark:bg-slate-950/95 xl:inset-y-0 xl:left-0 xl:w-[15.5rem] xl:translate-x-0 xl:rounded-none xl:border-y-0 xl:border-l-0 xl:border-r xl:bg-white xl:shadow-[12px_0_40px_rgba(15,23,42,0.06)] xl:dark:bg-slate-950 ${className}`}
      >
        <div className="hidden px-5 pt-6 xl:flex xl:items-center xl:gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-500 via-rose-500 to-violet-600 text-lg font-black text-white shadow-lg shadow-fuchsia-600/20">T</div>
          <div>
            <p className="font-black tracking-tight">Trí Candy</p>
            <p className="text-xs font-semibold text-muted-foreground">Không gian nhân sự</p>
          </div>
        </div>
        <nav className="mx-auto grid h-[4.5rem] max-w-md grid-flow-col auto-cols-fr px-2 pt-1 md:h-[4.75rem] md:max-w-none md:gap-2 md:px-4 md:py-2 xl:mt-7 xl:h-auto xl:grid-flow-row xl:grid-cols-1 xl:auto-rows-[3.5rem] xl:gap-2 xl:px-4 xl:py-0">
          {items.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                onPointerEnter={() => router.prefetch(item.href)}
                onFocus={() => router.prefetch(item.href)}
                onClick={() => startNavigation(item.href)}
                className={`group relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 transition-all duration-200 md:flex-row md:gap-2.5 md:px-4 xl:justify-start xl:rounded-xl xl:px-3 ${
                  isActive
                    ? 'text-indigo-600 dark:text-indigo-300 md:bg-indigo-50 md:shadow-inner md:dark:bg-indigo-500/15'
                    : 'text-muted-foreground hover:bg-slate-50 hover:text-foreground dark:hover:bg-white/5'
                }`}
              >
                <div className={`relative grid h-8 min-w-11 place-items-center rounded-full transition md:min-w-8 ${isActive ? 'bg-indigo-50 shadow-inner dark:bg-indigo-500/15 md:bg-transparent md:shadow-none md:dark:bg-transparent' : ''}`}>
                  {item.icon}
                  {!!item.badge && (
                    <Badge
                      variant="destructive"
                      size="sm"
                      className="absolute -right-1.5 -top-1.5 z-20 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-black"
                    >
                      {item.badge}
                    </Badge>
                  )}
                </div>
                <span className={`max-w-full truncate text-[11px] md:text-sm ${isActive ? 'font-extrabold' : 'font-semibold'}`}>{item.label}</span>
              </Link>
            )
          })}
        </nav>
        <div className="absolute inset-x-4 bottom-5 hidden rounded-2xl border border-slate-200/80 bg-slate-50 p-3 xl:block dark:border-white/10 dark:bg-slate-900">
          <div className="flex items-center gap-2 text-xs font-bold"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Hệ thống hoạt động</div>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Lịch làm và yêu cầu được đồng bộ tự động.</p>
        </div>
        </div>
      </>,
      document.body
    )
  }
)
BottomNav.displayName = 'BottomNav'

export { BottomNav }
