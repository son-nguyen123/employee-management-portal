'use client'

import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
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
    const [mounted, setMounted] = useState(false)

    useEffect(() => setMounted(true), [])

    if (!mounted) return null

    return createPortal(
      <div
        ref={ref}
        className={`fixed inset-x-0 bottom-0 z-[60] [transform:translate3d(0,0,0)] border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_20px_rgba(15,23,42,0.07)] [backface-visibility:hidden] dark:border-white/10 dark:bg-slate-950 md:inset-x-auto md:bottom-5 md:left-1/2 md:w-[min(44rem,calc(100vw-3rem))] md:-translate-x-1/2 md:rounded-[1.75rem] md:border md:bg-white/95 md:pb-0 md:shadow-[0_20px_55px_rgba(15,23,42,0.2)] md:backdrop-blur-xl md:dark:bg-slate-950/95 ${className}`}
      >
        <nav className="mx-auto grid h-[4.5rem] max-w-md grid-flow-col auto-cols-fr px-2 pt-1 md:h-[4.75rem] md:max-w-none md:gap-2 md:px-4 md:py-2">
          {items.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 transition-all duration-200 md:flex-row md:gap-2.5 md:px-4 ${
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
      </div>,
      document.body
    )
  }
)
BottomNav.displayName = 'BottomNav'

export { BottomNav }
