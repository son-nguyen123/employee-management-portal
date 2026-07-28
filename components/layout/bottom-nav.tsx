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
        className={`fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200/70 bg-white/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/92 md:hidden ${className}`}
      >
        <nav className="mx-auto grid h-16 max-w-md grid-flow-col auto-cols-fr px-2">
          {items.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 transition-all duration-200 ${
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <div className="text-[19px] leading-none">{item.icon}</div>
                <span className="max-w-full truncate text-[11px] font-semibold">{item.label}</span>
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
