'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'
import { Clock3, LogOut, ShieldX } from 'lucide-react'

export function ProfileCompletionGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { authUser, employee, isLoading, isPreviewMode, logout } = useAuth()
  const exempt = pathname.startsWith('/auth/') || pathname === '/profile/setup'
  const incomplete = !!authUser && !isPreviewMode && (
    !employee ||
    !employee.fullName?.trim() ||
    !employee.employeeCode?.trim() ||
    !employee.phone?.trim() ||
    !employee.photoURL?.trim() ||
    !employee.facebookUrl?.trim()
  )

  useEffect(() => {
    if (!isLoading && incomplete && !exempt) router.replace('/profile/setup')
  }, [exempt, incomplete, isLoading, router])

  if (!isLoading && incomplete && !exempt) return null
  if (!isLoading && employee?.status !== 'active' && !exempt) {
    const pending = employee?.status === 'pending'
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 p-5 dark:bg-slate-950">
        <section className="w-full max-w-sm rounded-[2rem] bg-white p-6 text-center shadow-xl dark:bg-slate-900">
          <div className={`mx-auto grid h-16 w-16 place-items-center rounded-3xl ${pending ? 'bg-amber-50 text-amber-600' : 'bg-rose-50 text-rose-600'}`}>
            {pending ? <Clock3 className="h-7 w-7" /> : <ShieldX className="h-7 w-7" />}
          </div>
          <h1 className="mt-5 text-2xl font-black">{pending ? 'Đang chờ quản lý duyệt' : 'Tài khoản đã bị vô hiệu hóa'}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{pending ? `Hồ sơ ${employee.fullName} · ${employee.employeeCode} đã được gửi. Bạn chỉ có thể dùng app sau khi quản lý bấm chấp nhận.` : 'Liên hệ quản lý nếu bạn cho rằng đây là nhầm lẫn.'}</p>
          <button type="button" onClick={() => void logout()} className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 font-bold text-white dark:bg-white dark:text-slate-950"><LogOut className="h-4 w-4" /> Đăng xuất</button>
        </section>
      </main>
    )
  }
  return <>{children}</>
}
