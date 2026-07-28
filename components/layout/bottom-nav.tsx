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
        className={`fixed bottom-0 left-0 right-0 z-50 md:hidden bg-background border-t border-border/40 backdrop-blur supports-[backdrop-filter]:bg-background/60 ${className}`}
      >
        <nav className="flex items-center justify-around px-2">
          {items.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center py-3 px-4 gap-1 transition-all duration-200 relative ${
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <div className="text-xl">{item.icon}</div>
                <span className="text-xs font-medium">{item.label}</span>
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
