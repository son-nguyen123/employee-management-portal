'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  BookOpenText,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  CalendarPlus,
  Settings,
  Archive,
  LayoutDashboard,
  History,
  LogOut,
  Moon,
  ShieldCheck,
  Sun,
  UserPlus,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { useAuth, useUserRole } from '@/lib/hooks/useAuth'
import { getAllEmployees } from '@/lib/services/employeeService'
import { getAllSchedules, getEmployeeSchedules, getSchedulesByDateRange } from '@/lib/services/scheduleService'
import { getPreviewSchedules } from '@/lib/services/previewWorkflow'
import { getWeeklyScheduleTarget } from '@/lib/services/managementSettingsService'
import { SkeletonLoader } from '@/components/ui/skeleton-loader'
import { profileImageUrl } from '@/lib/utils/profileImage'

const staffFeatures = [
  { title: 'Đăng ký lịch làm', note: 'Chọn ca cho tuần tiếp theo', href: '/schedule', icon: CalendarDays, tone: 'bg-indigo-600' },
  { title: 'Xin đi trễ', note: 'Gửi yêu cầu theo ca đã đăng ký', href: '/late-arrival', icon: Clock3, tone: 'bg-amber-500' },
  { title: 'Xin nghỉ', note: 'Chọn ca đã duyệt và lý do nghỉ', href: '/leave-request', icon: ClipboardList, tone: 'bg-emerald-600' },
  { title: 'Ứng lương / yêu cầu', note: 'Ứng lương hoặc gửi đề nghị khác', href: '/salary-advance', icon: CircleDollarSign, tone: 'bg-sky-600' },
  { title: 'Khoản phạt', note: 'Xem lịch sử và nguồn phát sinh', href: '/penalties', icon: AlertTriangle, tone: 'bg-rose-600' },
  { title: 'Đổi / thêm ca', note: 'Đổi ca cũ hoặc đăng ký làm thêm', href: '/schedule?mode=change', icon: CalendarPlus, tone: 'bg-fuchsia-600' },
  { title: 'Điều khoản công ty', note: 'Quy định và hướng dẫn chung', href: '/rules', icon: BookOpenText, tone: 'bg-violet-600' },
]

export default function Page() {
  const router = useRouter()
  const { authUser, employee, isLoading, isPreviewMode, logout } = useAuth()
  const role = useUserRole()
  const { theme, setTheme } = useTheme()
  const [adminStats, setAdminStats] = useState({ confirmed: 0, total: 0, pending: 0 })
  const [schedulePrompt, setSchedulePrompt] = useState<{ visible: boolean; isNew: boolean; href: string }>({ visible: false, isNew: false, href: '/schedule' })
  const [employeeModeOpen, setEmployeeModeOpen] = useState(false)

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
    if (!authUser || (role !== 'admin' && role !== 'manager')) return
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
            pending: new Set(schedules.filter((item) => ['Pending', 'Editing'].includes(item.status) && inRegistrationWeek(new Date(item.date))).map((item) => item.employeeId)).size,
          })
          return
        }
        const weekKey = `${nextMonday.getFullYear()}-${String(nextMonday.getMonth() + 1).padStart(2, '0')}-${String(nextMonday.getDate()).padStart(2, '0')}`
        const [employees, schedules, target] = await Promise.all([
          getAllEmployees(),
          getAllSchedules(),
          getWeeklyScheduleTarget(weekKey),
        ])
        setAdminStats({
          confirmed: new Set(schedules.filter((item) => item.status !== 'Cancelled' && inRegistrationWeek(item.date)).map((item) => item.employeeId)).size,
          total: target.expectedEmployees || employees.filter((item) => item.status === 'active').length,
          pending: new Set(schedules.filter((item) => ['Pending', 'Registered', 'Editing'].includes(item.status) && inRegistrationWeek(item.date)).map((item) => item.employeeId)).size,
        })
      } catch {
        // The main dashboard still works if management statistics are unavailable.
      }
    }
    loadAdminStats()
  }, [authUser, isPreviewMode, role])

  useEffect(() => {
    if (!authUser || !employee) {
      setSchedulePrompt({ visible: false, isNew: false, href: '/schedule' })
      return
    }

    const loadRegistrationWeek = async () => {
      const now = new Date()
      const monday = new Date(now)
      const useCurrentWeek = now.getDay() === 1
      const daysUntilNextMonday = useCurrentWeek ? 0 : ((8 - now.getDay()) % 7) || 7
      monday.setDate(now.getDate() + daysUntilNextMonday)
      monday.setHours(0, 0, 0, 0)
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      sunday.setHours(23, 59, 59, 999)
      const joined = employee.joinDate instanceof Date ? employee.joinDate : employee.joinDate.toDate()
      const appearsNew = Date.now() - joined.getTime() <= 45 * 24 * 60 * 60 * 1000

      try {
        const allSchedules = isPreviewMode
          ? getPreviewSchedules().filter((item) => item.employeeId === authUser.uid)
          : await getEmployeeSchedules(authUser.uid)
        const schedules = isPreviewMode
          ? allSchedules.filter((item) => {
              const date = item.date instanceof Date
                ? item.date
                : typeof item.date === 'string'
                  ? new Date(item.date)
                  : item.date.toDate()
              return date >= monday && date <= sunday
            })
          : await getSchedulesByDateRange(authUser.uid, monday, sunday)
        setSchedulePrompt({
          visible: !schedules.some((item) => item.status !== 'Cancelled'),
          isNew: appearsNew && !allSchedules.some((item) => item.status !== 'Cancelled'),
          href: useCurrentWeek ? '/schedule?week=current' : '/schedule',
        })
      } catch {
        setSchedulePrompt({ visible: false, isNew: false, href: '/schedule' })
      }
    }

    void loadRegistrationWeek()
  }, [authUser, employee, isPreviewMode])

  if (isLoading) {
    return <div className="mx-auto min-h-screen max-w-2xl p-4"><SkeletonLoader variant="card" count={6} /></div>
  }
  if (!authUser) return null

  const displayName = employee?.fullName || authUser.displayName || 'Nhân viên'
  const avatarURL = profileImageUrl(employee?.photoURL || authUser.photoURL)
  const isAdmin = role === 'admin' || role === 'manager'
  const adminFeatures = [
    { title: 'Điều hành', note: `${adminStats.pending} lịch chờ duyệt · yêu cầu khác`, href: '/admin/dashboard#schedules', icon: ShieldCheck },
    { title: 'Nhân sự tuần tới', note: 'Xem người làm theo từng ngày và ca', href: '/admin/next-week', icon: CalendarRange },
    { title: 'Quản lý phạt', note: 'Nhân viên · danh sách khoản phạt', href: '/admin/requests?view=penalties', icon: LayoutDashboard },
    { title: 'Danh sách ứng lương', note: 'Xem yêu cầu và tài khoản nhận tiền', href: '/admin/salary-advances', icon: CircleDollarSign },
    { title: 'Lịch sử xử lý', note: 'Xem và sửa quyết định trong tuần', href: '/admin/history', icon: History },
    { title: 'Danh sách nhân viên', note: 'Tên, mã nhân viên và số điện thoại', href: '/admin/dashboard?view=employees#employees', icon: UsersRound },
    { title: 'Kho dữ liệu', note: 'Xem lịch sử đã lưu trên Google Drive', href: '/admin/archive', icon: Archive },
    { title: 'Cài đặt', note: 'Email biên nhận và cấu hình quản lý', href: '/admin/settings', icon: Settings },
  ]
  const collapsibleStaffFeatures = staffFeatures.slice(1)

  return (
    <main className="min-h-screen pb-24 md:pb-8">
      <section
        className="overflow-hidden rounded-b-[2rem] border-b border-pink-200/70 bg-pink-50 px-4 pb-7 pt-[max(1rem,env(safe-area-inset-top))] text-slate-950 shadow-sm"
        style={{
          backgroundImage: "linear-gradient(115deg, rgba(255,255,255,.96), rgba(253,230,245,.82)), url('/tricandy-logo-hd.png')",
          backgroundPosition: 'center, right -70px top -25px',
          backgroundRepeat: 'no-repeat',
          backgroundSize: 'cover, 360px auto',
        }}
      >
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl border-2 border-white bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white shadow-md shadow-fuchsia-900/10 dark:border-white/15">
                {avatarURL
                  ? <img src={avatarURL} alt={`Ảnh đại diện của ${displayName}`} width={48} height={48} loading="eager" fetchPriority="high" decoding="async" className="h-full w-full object-cover" />
                  : isAdmin ? <ShieldCheck className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}
              </div>
              <div>
                <p className="text-xs font-bold text-fuchsia-600">{isAdmin ? 'Tài khoản quản lý · Trí Candy' : 'Trí Candy'}</p>
                <h1 className="max-w-[190px] truncate text-lg font-bold">{displayName}</h1>
              </div>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="grid h-11 w-11 place-items-center rounded-2xl bg-white/85 text-slate-700 shadow-sm ring-1 ring-fuchsia-100"
                aria-label="Đổi giao diện sáng tối"
              >
                {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>
              <button
                onClick={async () => { await logout(); router.push('/auth/login') }}
                className="grid h-11 w-11 place-items-center rounded-2xl bg-white/85 text-rose-500 shadow-sm ring-1 ring-rose-100"
                aria-label="Đăng xuất"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="mt-6 rounded-3xl bg-gradient-to-br from-fuchsia-600 via-rose-500 to-violet-600 p-5 text-white shadow-xl shadow-fuchsia-950/20">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-indigo-100">{isAdmin ? 'Tiến độ gửi lịch tuần này' : 'Lịch làm việc tuần này'}</p>
                <p className="mt-1 text-2xl font-extrabold">
                  {isAdmin ? `${adminStats.confirmed}/${adminStats.total} nhân viên` : '4 ca đã đăng ký'}
                </p>
                <p className="mt-1 text-sm text-indigo-100">
                  {isAdmin ? 'nhân viên đã gửi bảng lịch' : 'Đang chờ quản lý xác nhận'}
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
        {schedulePrompt.visible && (
          <Link
            href={schedulePrompt.href}
            className="mb-5 flex items-center gap-3 rounded-3xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-950 shadow-sm transition active:scale-[0.99] dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-100"
          >
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-600 text-white">
              <UserPlus className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-extrabold">
                {schedulePrompt.isNew ? 'Có vẻ bạn là thành viên mới' : 'Có vẻ bạn chưa có lịch'}
              </p>
              <p className="text-xs text-indigo-700 dark:text-indigo-200">Tuần kế tiếp chưa có lịch · Thêm lịch ngay</p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0" />
          </Link>
        )}

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

        {isAdmin ? (
          <section>
            <button
              type="button"
              onClick={() => setEmployeeModeOpen((current) => !current)}
              aria-expanded={employeeModeOpen}
              aria-controls="employee-mode-actions"
              className={`mobile-card flex min-h-20 w-full items-center gap-3 border-indigo-100 bg-gradient-to-r from-indigo-50/95 via-white to-sky-50/90 p-3 text-left shadow-md shadow-indigo-950/5 transition duration-300 active:scale-[0.99] dark:border-indigo-500/25 dark:from-indigo-500/15 dark:via-slate-900 dark:to-sky-500/10 ${employeeModeOpen ? 'border-indigo-200 from-indigo-100/90 to-sky-100/80 ring-4 ring-indigo-500/5 dark:border-indigo-500/40 dark:from-indigo-500/20 dark:to-sky-500/15' : ''}`}
            >
              <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl transition duration-300 ${employeeModeOpen ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15'}`}>
                <UserRound className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-indigo-600">Chế độ nhân viên</p>
                <h2 className="mt-0.5 font-extrabold">Các tiện ích dành cho bạn</h2>
                <p className="mt-1 truncate text-xs text-muted-foreground">Xin nghỉ · Đi trễ · Ứng lương · Tiện ích khác</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-slate-500">
                <span className="hidden sm:inline">{employeeModeOpen ? 'Thu gọn' : 'Mở'}</span>
                <ChevronDown className={`h-5 w-5 transition-transform duration-300 ${employeeModeOpen ? 'rotate-180 text-indigo-600' : ''}`} />
              </div>
            </button>

            <div id="employee-mode-actions" aria-hidden={!employeeModeOpen} className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${employeeModeOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
              <div className="overflow-hidden">
                <div className="grid grid-cols-2 gap-3 pt-3">
                  {collapsibleStaffFeatures.map(({ title, note, href, icon: Icon, tone }) => (
                    <Link
                      key={title}
                      href={href}
                      tabIndex={employeeModeOpen ? undefined : -1}
                      className="mobile-card flex min-h-[108px] flex-col p-3 transition active:scale-[0.98]"
                    >
                      <div className={`grid h-10 w-10 place-items-center rounded-xl text-white ${tone}`}><Icon className="h-4.5 w-4.5" /></div>
                      <div className="mt-auto pt-3"><h3 className="text-sm font-extrabold leading-tight">{title}</h3><p className="mt-1 truncate text-[11px] text-muted-foreground">{note}</p></div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section>
            <div className="mb-3"><p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-600">Tiện ích</p><h2 className="text-xl font-extrabold tracking-tight">Bạn muốn làm gì?</h2></div>
            <div className="grid grid-cols-2 gap-3">
              {staffFeatures.map(({ title, note, href, icon: Icon, tone }, index) => (
                <Link key={title} href={href} className={`mobile-card flex min-h-[148px] flex-col p-4 transition active:scale-[0.98] ${index === 0 ? 'col-span-2 min-h-[118px]' : ''}`}>
                  <div className={`grid h-11 w-11 place-items-center rounded-2xl text-white ${tone}`}><Icon className="h-5 w-5" /></div>
                  <div className="mt-auto pt-4"><h3 className="font-extrabold leading-tight">{title}</h3><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{note}</p></div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

    </main>
  )
}
