'use client'

import { Bell, CalendarDays, LayoutDashboard, UserRound } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'
import { BottomNav } from '@/components/layout/bottom-nav'

const hiddenPrefixes = ['/auth', '/profile/setup']

export function PersistentBottomNav() {
  const pathname = usePathname()
  const { authUser, isLoading } = useAuth()
  const hidden = hiddenPrefixes.some((prefix) => pathname.startsWith(prefix))

  if (isLoading || !authUser || hidden) return null

  return (
    <>
      <div className="h-[calc(5rem+env(safe-area-inset-bottom))] md:hidden" aria-hidden />
      <BottomNav items={[
        { href: '/', icon: <LayoutDashboard className="h-5 w-5" />, label: 'Trang chủ' },
        { href: '/schedule', icon: <CalendarDays className="h-5 w-5" />, label: 'Lịch làm' },
        { href: '/notifications', icon: <Bell className="h-5 w-5" />, label: 'Thông báo' },
        { href: '/profile', icon: <UserRound className="h-5 w-5" />, label: 'Cá nhân' },
      ]} />
    </>
  )
}
