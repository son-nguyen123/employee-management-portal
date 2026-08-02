'use client'

import React from 'react'
import { ChevronLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface HeaderProps {
  title: string
  subtitle?: string
  showBackButton?: boolean
  backHref?: string
  rightAction?: React.ReactNode
  className?: string
}

const Header = React.forwardRef<HTMLDivElement, HeaderProps>(
  (
    {
      title,
      subtitle,
      showBackButton = true,
      backHref,
      rightAction,
      className = '',
    },
    ref
  ) => {
    const router = useRouter()

    return (
      <div
        ref={ref}
        className={`sticky top-0 z-40 border-b border-slate-200/70 bg-white/90 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/90 ${className}`}
      >
        <div className="mx-auto flex max-w-2xl items-center justify-between px-3 py-3 sm:px-5 md:max-w-4xl lg:max-w-5xl">
          <div className="flex items-center gap-3 flex-1">
            {showBackButton && (
              <button
                onClick={() => backHref ? router.replace(backHref) : router.back()}
                className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 transition-colors active:bg-slate-200 dark:bg-slate-800"
                aria-label="Quay lại"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <div>
              <h1 className="text-lg font-bold leading-tight tracking-tight">{title}</h1>
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
