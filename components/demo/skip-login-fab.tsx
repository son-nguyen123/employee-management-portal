'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { enablePreviewMode } from '@/lib/config/demo'
import { ChevronRight } from 'lucide-react'

export function SkipLoginFAB() {
  const pathname = usePathname()
  const [showButton, setShowButton] = useState(false)

  useEffect(() => {
    setShowButton(
      process.env.NODE_ENV === 'development' &&
        (pathname === '/auth/login' || pathname === '/auth/signup')
    )
  }, [pathname])

  if (!showButton) return null

  const handleSkipLogin = () => {
    enablePreviewMode()
    window.location.assign('/')
  }

  return (
    <button
      onClick={handleSkipLogin}
      className="fixed bottom-5 right-5 z-50 group"
      aria-label="Bỏ qua đăng nhập để xem bản mẫu"
      title="Bỏ qua đăng nhập để xem bản mẫu"
    >
      <div className="relative">
        {/* Animated ring background */}
        <div className="absolute inset-0 rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors" />
        
        {/* Main button */}
        <div className="relative flex items-center justify-center w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-shadow group-hover:scale-110">
          <ChevronRight className="w-6 h-6" />
        </div>

        {/* Tooltip */}
        <div className="absolute right-full mr-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <div className="bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium px-3 py-2 rounded-lg whitespace-nowrap">
            Bỏ qua đăng nhập
            <div className="absolute left-full w-2 h-2 bg-slate-900 dark:bg-slate-100 transform rotate-45 top-1/2 -translate-y-1/2" />
          </div>
        </div>
      </div>
    </button>
  )
}
