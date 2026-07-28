'use client'

import React from 'react'
import { ChevronLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface HeaderProps {
  title: string
  subtitle?: string
  showBackButton?: boolean
  rightAction?: React.ReactNode
  className?: string
}

const Header = React.forwardRef<HTMLDivElement, HeaderProps>(
  (
    {
      title,
      subtitle,
      showBackButton = true,
      rightAction,
      className = '',
    },
    ref
  ) => {
    const router = useRouter()

    return (
      <div
        ref={ref}
        className={`sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border/40 ${className}`}
      >
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3 flex-1">
            {showBackButton && (
              <button
                onClick={() => router.back()}
                className="p-2 hover:bg-muted rounded-lg transition-colors duration-200"
                aria-label="Go back"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <div>
              <h1 className="text-lg font-semibold leading-none">{title}</h1>
              {subtitle && (
                <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
              )}
            </div>
          </div>
          {rightAction && <div className="ml-auto">{rightAction}</div>}
        </div>
      </div>
    )
  }
)
Header.displayName = 'Header'

export { Header }
