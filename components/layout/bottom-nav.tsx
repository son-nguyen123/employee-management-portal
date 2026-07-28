'use client'

import React from 'react'
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

    return (
      <div
        ref={ref}
        className={`fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200/70 bg-white/90 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_35px_rgba(15,23,42,0.08)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/90 md:hidden ${className}`}
      >
        <nav className="mx-auto grid h-[4.5rem] max-w-md grid-flow-col auto-cols-fr px-2 pt-1">
          {items.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 transition-all duration-200 ${
                  isActive
                    ? 'text-indigo-600 dark:text-indigo-300'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <div className={`grid h-8 min-w-11 place-items-center rounded-full transition ${isActive ? 'bg-indigo-50 shadow-inner dark:bg-indigo-500/15' : ''}`}>
                  {item.icon}
                </div>
                <span className={`max-w-full truncate text-[11px] ${isActive ? 'font-extrabold' : 'font-semibold'}`}>{item.label}</span>
                {item.badge && (
                  <Badge
                    variant="destructive"
                    size="sm"
                    className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center p-0 text-xs"
                  >
                    {item.badge}
                  </Badge>
                )}
              </Link>
            )
          })}
        </nav>
      </div>
    )
  }
)
BottomNav.displayName = 'BottomNav'

export { BottomNav }
