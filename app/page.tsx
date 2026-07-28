'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  BookOpenText,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  Factory,
  LayoutDashboard,
  LogOut,
  Moon,
  ShieldCheck,
  Sun,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { useAuth, useUserRole } from '@/lib/hooks/useAuth'
import { getAllEmployees } from '@/lib/services/employeeService'
import { getAllSchedules } from '@/lib/services/scheduleService'
import { getPreviewSchedules } from '@/lib/services/previewWorkflow'
import { SkeletonLoader } from '@/components/ui/skeleton-loader'

const staffFeatures = [
  { title: 'Đăng ký lịch làm', note: 'Chọn ca cho tuần tiếp theo', href: '/schedule', icon: CalendarDays, tone: 'bg-indigo-600' },
  { title: 'Xin đi trễ', note: 'Gửi yêu cầu theo ca đã đăng ký', href: '/late-arrival', icon: Clock3, tone: 'bg-amber-500' },
  { title: 'Xin nghỉ', note: 'Chọn ngày, ca và lý do nghỉ', href: '/leave-request', icon: ClipboardList, tone: 'bg-emerald-600' },
  { title: 'Ứng lương', note: 'Theo dõi yêu cầu trong tháng', href: '/salary-advance', icon: CircleDollarSign, tone: 'bg-sky-600' },
  { title: 'Khoản phạt', note: 'Xem lịch sử và nguồn phát sinh', href: '/penalties', icon: AlertTriangle, tone: 'bg-rose-600' },
  { title: 'Điều khoản công ty', note: 'Quy định và hướng dẫn chung', href: '/rules', icon: BookOpenText, tone: 'bg-violet-600' },
  { title: 'Công việc trong xưởng', note: 'Danh sách công việc được giao', href: '/workshop', icon: Factory, tone: 'bg-slate-700' },
]

export default function Page() {
  const router = useRouter()
  const { authUser, employee, isLoading, isPreviewMode, logout } = useAuth()
  const role = useUserRole()
  const { theme, setTheme } = useTheme()
  const [adminStats, setAdminStats] = useState({ confirmed: 0, total: 0, pending: 0 })

  useEffect(() => {
    if (!isLoading && !authUser) router.push('/auth/login')
    if (!isLoading && authUser && !isPreviewMode && (
      !employee ||
      !employee.fullName?.trim() ||
      !employee.employeeCode?.trim() ||
      !employee.phone?.trim() ||
      !employee.photoURL?.trim() ||
      !employee.facebookUrl?.trim()
    )) {
      router.replace('/profile/setup')
    }
  }, [authUser, employee, isLoading, isPreviewMode, router])

  useEffect(() => {
    if (!authUser || role !== 'admin') return
    const loadAdminStats = async () => {
      try {
        const now = new Date()
        const nextMonday = new Date(now)
        const daysUntilNextMonday = ((8 - now.getDay()) % 7) || 7
        nextMonday.setDate(now.getDate() + daysUntilNextMonday)
        nextMonday.setHours(0, 0, 0, 0)
        const nextSunday = new Date(nextMonday)
        nextSunday.setDate(nextMonday.getDate() + 6)
        nextSunday.setHours(23, 59, 59, 999)
        const inRegistrationWeek = (value: Date | { toDate(): Date }) => {
          const date = value instanceof Date ? value : value.toDate()
          return date >= nextMonday && date <= nextSunday
        }
        if (isPreviewMode) {
          const schedules = getPreviewSchedules()
          const employeeIds = new Set(schedules.map((item) => item.employeeId))
          setAdminStats({
            confirmed: new Set(schedules.filter((item) => item.status === 'Approved' && inRegistrationWeek(new Date(item.date))).map((item) => item.employeeId)).size,
            total: employeeIds.size,
            pending: new Set(schedules.filter((item) => item.status === 'Pending' && inRegistrationWeek(new Date(item.date))).map((item) => item.employeeId)).size,
          })
          return
        }
        const [employees, schedules] = await Promise.all([getAllEmployees(), getAllSchedules()])
        setAdminStats({
          confirmed: new Set(schedules.filter((item) => item.status === 'Approved' && inRegistrationWeek(item.date)).map((item) => item.employeeId)).size,
          total: employees.filter((item) => item.status === 'active').length,
          pending: new Set(schedules.filter((item) => ['Pending', 'Registered'].includes(item.status) && inRegistrationWeek(item.date)).map((item) => item.employeeId)).size,
        })
      } catch {
        // The main dashboard still works if management statistics are unavailable.
      }
    }
    loadAdminStats()
  }, [authUser, isPreviewMode, role])

  if (isLoading) {
    return <div className="mx-auto min-h-screen max-w-2xl p-4"><SkeletonLoader variant="card" count={6} /></div>
  }
  if (!authUser) return null

  const displayName = employee?.fullName || authUser.displayName || 'Nhân viên'
  const isAdmin = role === 'admin'
  const adminFeatures = [
    { title: 'Đăng ký lịch', note: `${adminStats.pending} nhân viên đang chờ xác nhận`, href: '/admin/dashboard#schedules', icon: ShieldCheck },
    { title: 'Điều hành', note: 'Phạt · xin nghỉ · đi trễ · ứng lương', href: '/admin/requests', icon: LayoutDashboard },
    { title: 'Danh sách nhân viên', note: 'Tài khoản đang hoạt động trong tháng', href: '/admin/dashboard#employees', icon: UsersRound },
  ]

  return (
    <main className="min-h-screen pb-24 md:pb-8">
      <section className="overflow-hidden rounded-b-[2rem] bg-slate-950 px-4 pb-7 pt-[max(1rem,env(safe-area-inset-top))] text-white">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10">
                {isAdmin ? <ShieldCheck className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}
              </div>
              <div>
                <p className="text-xs font-semibold text-indigo-300">{isAdmin ? 'Tài khoản quản lý' : 'Cổng nhân viên'}</p>
                <h1 className="max-w-[190px] truncate text-lg font-bold">{displayName}</h1>
              </div>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10"
                aria-label="Đổi giao diện sáng tối"
              >
                {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>
              <button
                onClick={async () => { await logout(); router.push('/auth/login') }}
                className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10 text-rose-300"
                aria-label="Đăng xuất"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="mt-6 rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-600 p-5 shadow-xl shadow-indigo-950/30">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-indigo-100">{isAdmin ? 'Xác nhận lịch tuần này' : 'Lịch làm việc tuần này'}</p>
                <p className="mt-1 text-2xl font-extrabold">
                  {isAdmin ? `${adminStats.confirmed}/${adminStats.total} nhân viên` : '4 ca đã đăng ký'}
                </p>
                <p className="mt-1 text-sm text-indigo-100">
                  {isAdmin ? 'đã được quản lý xác nhận' : 'Đang chờ quản lý xác nhận'}
                </p>
              </div>
              <div className="rounded-2xl bg-white/15 px-3 py-2 text-center">
                <span className="block text-xl font-black">{isAdmin ? String(adminStats.pending).padStart(2, '0') : '02'}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider">{isAdmin ? 'Đang chờ' : 'Thông báo'}</span>
              </div>
            </div>
            <Link href={isAdmin ? '/admin/dashboard#schedules' : '/schedule'} className="mt-5 flex min-h-11 items-center justify-between rounded-2xl bg-white px-4 text-sm font-bold text-indigo-700">
              {isAdmin ? 'Mở bảng đăng ký lịch' : 'Xem lịch của tôi'}
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-2xl px-3 py-5 sm:px-6">
        {isAdmin && (
          <section className="mb-7">
            <div className="mb-3 flex items-end justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-600">Quản trị</p>
                <h2 className="text-xl font-extrabold tracking-tight">Cần bạn xử lý</h2>
              </div>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">{adminStats.pending} mục mới</span>
            </div>
            <div className="space-y-2">
              {adminFeatures.map(({ title, note, href, icon: Icon }) => (
                <Link key={title} href={href} className="mobile-card flex min-h-20 items-center gap-3 p-3 transition active:scale-[0.99]">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold">{title}</h3>
                    <p className="truncate text-xs text-muted-foreground">{note}</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-slate-400" />
                </Link>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="mb-3">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-600">
              {isAdmin ? 'Chế độ nhân viên' : 'Tiện ích'}
            </p>
            <h2 className="text-xl font-extrabold tracking-tight">Bạn muốn làm gì?</h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {staffFeatures.map(({ title, note, href, icon: Icon, tone }, index) => (
              <Link
                key={title}
                href={href}
                className={`mobile-card flex min-h-[148px] flex-col p-4 transition active:scale-[0.98] ${index === 0 ? 'col-span-2 min-h-[118px]' : ''}`}
              >
                <div className={`grid h-11 w-11 place-items-center rounded-2xl text-white ${tone}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="mt-auto pt-4">
                  <h3 className="font-extrabold leading-tight">{title}</h3>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{note}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>

    </main>
  )
}
