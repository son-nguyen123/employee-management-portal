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
import { getUserFeatureSettings, getWeeklyScheduleTarget } from '@/lib/services/managementSettingsService'
import { subscribeToManagementPendingItems } from '@/lib/services/notificationService'
import { AppLoadingScreen } from '@/components/ui/app-loading-screen'
import { profileImageUrl } from '@/lib/utils/profileImage'
import { defaultUserFeatureSettings, type UserFeatureKey, type UserFeatureSettings } from '@/lib/models/userFeatureSettings'

const staffFeatures = [
  { key: 'schedule', title: 'Đăng ký lịch làm', note: 'Chọn ca cho tuần tiếp theo', href: '/schedule', icon: CalendarDays, tone: 'bg-indigo-600' },
  { key: 'lateArrival', title: 'Xin đi trễ', note: 'Gửi yêu cầu theo ca đã đăng ký', href: '/late-arrival', icon: Clock3, tone: 'bg-amber-500' },
  { key: 'leave', title: 'Xin nghỉ', note: 'Chọn ca đã duyệt và lý do nghỉ', href: '/leave-request', icon: ClipboardList, tone: 'bg-emerald-600' },
  { key: 'salaryAdvance', title: 'Ứng lương / yêu cầu', note: 'Ứng lương nhanh', href: '/salary-advance', icon: CircleDollarSign, tone: 'bg-sky-600' },
  { key: 'penalties', title: 'Khoản phạt', note: 'Xem khoản phạt', href: '/penalties', icon: AlertTriangle, tone: 'bg-rose-600' },
  { key: 'shiftChanges', title: 'Đổi / thêm ca', note: 'Đổi ca cũ hoặc đăng ký làm thêm', href: '/schedule?mode=change', icon: CalendarPlus, tone: 'bg-fuchsia-600' },
  { key: 'companyRules', title: 'Điều khoản công ty', note: 'Quy định và hướng dẫn chung', href: '/rules', icon: BookOpenText, tone: 'bg-violet-600' },
]

export default function Page() {
  const router = useRouter()
  const { authUser, employee, isLoading, isPreviewMode, logout } = useAuth()
  const role = useUserRole()
  const { theme, setTheme } = useTheme()
  const [adminStats, setAdminStats] = useState({ confirmed: 0, total: 0, pending: 0, actionable: 0, otherPending: 0 })
  const [schedulePrompt, setSchedulePrompt] = useState<{ visible: boolean; isNew: boolean; href: string }>({ visible: false, isNew: false, href: '/schedule' })
  const [employeeModeOpen, setEmployeeModeOpen] = useState(false)
  const [enabledUserFeatures, setEnabledUserFeatures] = useState<UserFeatureSettings | null>(null)

  useEffect(() => {
    if (isPreviewMode) {
      setEnabledUserFeatures(authUser ? { ...defaultUserFeatureSettings } : null)
      return
    }

    // Firebase auth resolves before the employee profile subscription. A new
    // account can therefore reach this page briefly without a profile that
    // the workflow API can authenticate yet. Do not treat that race as “all
    // features enabled”; wait for the profile and then fetch the authoritative
    // admin setting.
    if (!authUser || !employee || employee.uid !== authUser.uid) {
      setEnabledUserFeatures(null)
      return
    }

    let active = true
    setEnabledUserFeatures(null)
    void getUserFeatureSettings({ force: true })
      .then((settings) => {
        if (active) setEnabledUserFeatures(settings)
      })
      .catch((error) => {
        // Showing disabled features after a failed read is safer than showing
        // actions that the admin explicitly turned off. The next profile/auth
        // refresh can retry the request.
        console.error('Error fetching user feature settings:', error)
        if (active) setEnabledUserFeatures(null)
      })
    return () => { active = false }
  }, [authUser?.uid, employee?.uid, employee?.status, isPreviewMode])

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
    if (!authUser || (role !== 'admin' && role !== 'manager' && role !== 'director')) return
    const unsubscribePending = isPreviewMode || role === 'director' ? () => undefined : subscribeToManagementPendingItems((items) => {
      const visible = items.filter((item) => item.type !== 'account' || role === 'admin')
      setAdminStats((current) => ({
        ...current,
        actionable: visible.length,
        otherPending: visible.filter((item) => item.type !== 'schedule').length,
      }))
    })
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
          setAdminStats((current) => ({
            confirmed: new Set(schedules.filter((item) => item.status === 'Approved' && inRegistrationWeek(new Date(item.date))).map((item) => item.employeeId)).size,
            total: employeeIds.size,
            pending: new Set(schedules.filter((item) => item.underMinimumWarning && inRegistrationWeek(new Date(item.date))).map((item) => item.employeeId)).size,
            actionable: current.actionable,
            otherPending: current.otherPending,
          }))
          return
        }
        const weekKey = `${nextMonday.getFullYear()}-${String(nextMonday.getMonth() + 1).padStart(2, '0')}-${String(nextMonday.getDate()).padStart(2, '0')}`
        const [employees, schedules, target] = await Promise.all([
          getAllEmployees(),
          getAllSchedules(),
          getWeeklyScheduleTarget(weekKey),
        ])
        const fixedForNextWeek = employees.filter((employee) => {
          if (employee.status !== 'active' || employee.scheduleMode !== 'fixed') return false
          const effective = employee.scheduleModeEffectiveWeekStart || ''
          const needsSetup = employee.fixedScheduleNeedsSetupWeekStart || ''
          return (!effective || effective <= weekKey) && (!needsSetup || weekKey < needsSetup)
        })
        const confirmed = new Set(schedules.filter((item) => item.status !== 'Cancelled' && inRegistrationWeek(item.date)).map((item) => item.employeeId))
        fixedForNextWeek.forEach((employee) => confirmed.add(employee.uid))
        setAdminStats((current) => ({
          confirmed: confirmed.size,
          total: target.expectedEmployees || employees.filter((item) => item.status === 'active').length,
          pending: new Set(schedules.filter((item) => item.underMinimumWarning && inRegistrationWeek(item.date)).map((item) => item.employeeId)).size,
          actionable: current.actionable,
          otherPending: current.otherPending,
        }))
      } catch {
        // The main dashboard still works if management statistics are unavailable.
      }
    }
    loadAdminStats()
    return unsubscribePending
  }, [authUser, isPreviewMode, role])

  useEffect(() => {
    if (!authUser || !employee) {
      setSchedulePrompt({ visible: false, isNew: false, href: '/schedule' })
      return
    }

    const loadRegistrationWeek = async () => {
      const now = new Date()
      const weekday = now.getDay() || 7
      const currentMonday = new Date(now)
      currentMonday.setDate(now.getDate() - weekday + 1)
      currentMonday.setHours(0, 0, 0, 0)
      const currentSunday = new Date(currentMonday)
      currentSunday.setDate(currentMonday.getDate() + 6)
      currentSunday.setHours(23, 59, 59, 999)
      const nextMonday = new Date(currentMonday)
      nextMonday.setDate(currentMonday.getDate() + 7)
      const nextSunday = new Date(nextMonday)
      nextSunday.setDate(nextMonday.getDate() + 6)
      nextSunday.setHours(23, 59, 59, 999)
      const joined = employee.joinDate instanceof Date ? employee.joinDate : employee.joinDate.toDate()
      const appearsNew = Date.now() - joined.getTime() <= 45 * 24 * 60 * 60 * 1000

      try {
        const allSchedules = isPreviewMode
          ? getPreviewSchedules().filter((item) => item.employeeId === authUser.uid)
          : await getEmployeeSchedules(authUser.uid)
        const currentSchedules = isPreviewMode
          ? allSchedules.filter((item) => {
              const date = item.date instanceof Date
                ? item.date
                : typeof item.date === 'string'
                  ? new Date(item.date)
                  : item.date.toDate()
              return date >= currentMonday && date <= currentSunday
            })
          : await getSchedulesByDateRange(authUser.uid, currentMonday, currentSunday)
        const nextSchedules = isPreviewMode
          ? allSchedules.filter((item) => {
              const date = item.date instanceof Date
                ? item.date
                : typeof item.date === 'string'
                  ? new Date(item.date)
                  : item.date.toDate()
              return date >= nextMonday && date <= nextSunday
            })
          : await getSchedulesByDateRange(authUser.uid, nextMonday, nextSunday)
        const hasCurrentWeek = currentSchedules.some((item) => item.status !== 'Cancelled')
        const hasNextWeek = nextSchedules.some((item) => item.status !== 'Cancelled')
        const shouldUseCurrentWeek = weekday >= 1 && weekday <= 5
        const targetHasSchedule = shouldUseCurrentWeek ? hasCurrentWeek : hasNextWeek
        setSchedulePrompt({
          visible: !targetHasSchedule,
          isNew: appearsNew && !allSchedules.some((item) => item.status !== 'Cancelled'),
          href: shouldUseCurrentWeek ? '/schedule?week=current' : '/schedule',
        })
      } catch {
        setSchedulePrompt({ visible: false, isNew: false, href: '/schedule' })
      }
    }

    void loadRegistrationWeek()
  }, [authUser, employee, isPreviewMode])

  if (isLoading) {
    return <AppLoadingScreen />
  }
  if (!authUser) return null

  if (employee && role === 'employee' && employee.status !== 'active') {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 px-4 dark:bg-slate-950">
        <section className="w-full max-w-md rounded-[2rem] border border-fuchsia-100 bg-transparent p-6 text-center shadow-xl shadow-fuchsia-950/5 dark:border-fuchsia-500/20">
          <div className={`mx-auto grid h-16 w-16 place-items-center rounded-3xl ${employee.status === 'inactive' ? 'bg-rose-100 text-rose-600' : 'bg-fuchsia-100 text-fuchsia-600'}`}><ShieldCheck className="h-8 w-8" /></div>
          <h1 className="mt-5 text-2xl font-black">{employee.status === 'inactive' ? 'Tài khoản đã bị vô hiệu hóa' : 'Hồ sơ đang chờ admin duyệt'}</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{employee.status === 'inactive' ? 'Vui lòng liên hệ quản lý nếu bạn cho rằng đây là nhầm lẫn.' : 'Bạn đã tạo tài khoản thành công. Các tiện ích sẽ mở ngay sau khi admin chấp nhận hồ sơ.'}</p>
          <button type="button" onClick={async () => { await logout(); router.push('/auth/login') }} className="mt-6 min-h-12 w-full rounded-2xl bg-slate-950 font-extrabold text-white dark:bg-white dark:text-slate-950">Đăng xuất</button>
        </section>
      </main>
    )
  }

  const displayName = employee?.fullName || authUser.displayName || 'Nhân viên'
  const avatarURL = profileImageUrl(employee?.photoURL || authUser.photoURL)
  const isAdmin = role === 'admin' || role === 'manager' || role === 'director'
  const adminFeatures = [
    { title: 'Điều hành', note: `${Math.max(0, adminStats.actionable - adminStats.otherPending)} lịch · ${adminStats.otherPending} yêu cầu khác`, href: '/admin/dashboard#schedules', icon: ShieldCheck },
    { title: 'Nhân sự tuần tới', note: 'Xem người làm theo từng ngày và ca', href: '/admin/next-week', icon: CalendarRange },
    { title: 'Quản lý phạt', note: 'Nhân viên · danh sách khoản phạt', href: '/admin/requests?view=penalties', icon: LayoutDashboard },
    { title: 'Danh sách ứng lương', note: 'Xem yêu cầu và tài khoản nhận tiền', href: '/admin/salary-advances', icon: CircleDollarSign },
    { title: 'Lịch sử xử lý', note: 'Xem và sửa quyết định trong tuần', href: '/admin/history', icon: History },
    { title: 'Danh sách nhân viên', note: 'Tên, mã nhân viên và số điện thoại', href: '/admin/dashboard?view=employees#employees', icon: UsersRound },
    { title: 'Kho dữ liệu', note: 'Xem lịch sử đã lưu trên Google Drive', href: '/admin/archive', icon: Archive },
    { title: 'Cài đặt', note: 'Email biên nhận và cấu hình quản lý', href: '/admin/settings', icon: Settings },
  ]
  // Management accounts can use the same self-service utilities as staff.
  // Keep schedule registration here as the first card so managers do not
  // need to leave management mode to submit their own availability.
  const featureSettings = authUser
    ? (isPreviewMode ? defaultUserFeatureSettings : enabledUserFeatures)
    : null
  const featuresReady = featureSettings !== null
  const isFeatureEnabled = (key: UserFeatureKey) => featureSettings?.[key] === true
  const visibleStaffFeatures = featuresReady
    ? staffFeatures.filter(({ key }) => isFeatureEnabled(key as UserFeatureKey))
    : []
  const collapsibleStaffFeatures = visibleStaffFeatures

  return (
    <main className="min-h-screen pb-24 md:pb-10">
      <section className="home-hero overflow-hidden rounded-b-[2rem] border-b border-pink-200/70 bg-pink-50 px-4 pb-7 pt-[max(1rem,env(safe-area-inset-top))] text-slate-950 shadow-sm md:mx-auto md:mt-5 md:w-[calc(100%-2.5rem)] md:max-w-6xl md:rounded-[2rem] md:border md:px-5 md:py-5 md:shadow-lg md:shadow-slate-950/5 lg:mt-7 lg:px-7 lg:py-7">
        <div className="mx-auto max-w-2xl md:grid md:max-w-none md:grid-cols-[0.82fr_1.18fr] md:items-stretch md:gap-4 lg:gap-5">
          <div className="flex items-center justify-between md:rounded-[1.6rem] md:border md:border-white/80 md:bg-white/65 md:p-4 md:shadow-sm md:backdrop-blur-sm lg:p-5">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl border-2 border-white bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white shadow-md shadow-fuchsia-900/10 dark:border-white/15 md:h-14 md:w-14">
                {avatarURL
                  ? <img src={avatarURL} alt={`Ảnh đại diện của ${displayName}`} width={48} height={48} loading="eager" fetchPriority="high" decoding="async" className="h-full w-full object-cover" />
                  : isAdmin ? <ShieldCheck className="h-5 w-5" /> : <UserRound className="h-5 w-5" />}
              </div>
              <div>
                <p className="text-xs font-bold text-fuchsia-600">
                  <span className="md:hidden lg:inline">{isAdmin ? 'Tài khoản quản lý · Trí Candy' : 'Xin chào, thành viên Trí Candy'}</span>
                  <span className="hidden md:inline lg:hidden">{isAdmin ? 'Tài khoản quản lý' : 'Trí Candy'}</span>
                </p>
                <h1 className="max-w-[190px] truncate text-lg font-bold md:mt-1 md:max-w-[210px] md:text-xl lg:max-w-[230px]">{displayName}</h1>
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

          <div className="mt-6 rounded-3xl bg-gradient-to-br from-violet-600 via-fuchsia-600 to-rose-500 p-5 text-white shadow-xl shadow-fuchsia-950/20 md:mt-0 md:p-5 md:shadow-lg md:shadow-fuchsia-950/15 lg:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-indigo-100">{isAdmin ? 'Tiến độ gửi lịch tuần này' : 'Lịch làm việc tuần này'}</p>
                <p className="mt-1 text-2xl font-extrabold md:text-xl lg:text-2xl">
                  {isAdmin ? `${adminStats.confirmed}/${adminStats.total} nhân viên` : '4 ca đã đăng ký'}
                </p>
                <p className="mt-1 text-sm text-indigo-100">
                  {isAdmin ? 'nhân viên đã xác nhận bảng lịch' : 'Tự động xác nhận · có thể sửa lại'}
                </p>
              </div>
              <div className="rounded-2xl bg-white/15 px-3 py-2 text-center">
                <span className="block text-xl font-black">{isAdmin ? String(adminStats.pending).padStart(2, '0') : '02'}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider">{isAdmin ? 'Cần lưu ý' : 'Thông báo'}</span>
              </div>
            </div>
            <Link href={isAdmin ? '/admin/dashboard#schedules' : '/schedule'} className="mt-5 flex min-h-11 items-center justify-between rounded-2xl bg-white px-4 text-sm font-bold text-indigo-700">
              {isAdmin ? 'Mở bảng đăng ký lịch' : 'Xem lịch của tôi'}
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-2xl px-3 py-5 sm:px-6 md:max-w-4xl md:py-7 lg:w-[calc(100%-2.5rem)] lg:max-w-6xl lg:px-0 lg:pb-12 lg:pt-7">
        {schedulePrompt.visible && featureSettings?.schedule && (
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
              <p className="text-xs text-indigo-700 dark:text-indigo-200">{schedulePrompt.isNew ? 'Nhân viên mới: chọn lịch từ đầu tuần hiện tại' : schedulePrompt.href === '/schedule?week=current' ? 'Tuần này chưa có lịch · Thêm lịch ngay' : 'Tuần kế tiếp chưa có lịch · Thêm lịch ngay'}</p>
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
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">{adminStats.actionable} mục mới</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
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
                <p className="mt-1 truncate text-xs text-muted-foreground">Đăng ký lịch · Xin nghỉ · Đi trễ · Ứng lương</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-slate-500">
                <span className="hidden sm:inline">{employeeModeOpen ? 'Thu gọn' : 'Mở'}</span>
                <ChevronDown className={`h-5 w-5 transition-transform duration-300 ${employeeModeOpen ? 'rotate-180 text-indigo-600' : ''}`} />
              </div>
            </button>

            <div id="employee-mode-actions" aria-hidden={!employeeModeOpen} className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${employeeModeOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
              <div className="overflow-hidden">
                <div className="grid grid-cols-2 gap-3 pt-3 md:grid-cols-3 lg:grid-cols-4">
                  {collapsibleStaffFeatures.map(({ key, title, note, href, icon: Icon, tone }) => (
                    <Link
                      key={title}
                      href={href}
                      tabIndex={employeeModeOpen ? undefined : -1}
                      className={`mobile-card flex min-h-[108px] flex-col p-3 transition active:scale-[0.98] ${key === 'schedule' ? 'col-span-2 min-h-[140px] md:col-span-2 lg:col-span-2' : ''}`}
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
            <div className="mb-4 flex items-center gap-3">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-gradient-to-br from-fuchsia-500 to-indigo-600 shadow-sm shadow-fuchsia-500/40" />
              <h2 className="shrink-0 text-lg font-black tracking-tight">Tiện ích của bạn</h2>
              <span className="h-px flex-1 bg-gradient-to-r from-fuchsia-300 via-indigo-200 to-transparent" />
            </div>
            {!featuresReady ? (
              <div aria-label="Đang tải tiện ích" className="grid grid-cols-2 gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-4">
                {Array.from({ length: 7 }).map((_, index) => <div key={index} className={`mobile-card min-h-[148px] animate-pulse bg-slate-100/80 p-4 dark:bg-slate-800/60 ${index === 0 ? 'col-span-2 min-h-[118px] md:min-h-[132px] lg:col-span-2' : ''}`} />)}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-4">
                {visibleStaffFeatures.map(({ key, title, note, href, icon: Icon, tone }) => (
                  <Link key={key} href={href} className={`mobile-card group flex min-h-[148px] flex-col p-4 transition duration-200 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-950/5 active:scale-[0.98] md:min-h-[132px] md:p-5 lg:min-h-[136px] ${key === 'schedule' ? 'col-span-2 min-h-[118px] md:min-h-[132px] md:flex-row md:items-center md:gap-5 md:border-indigo-200/80 md:bg-gradient-to-r md:from-indigo-50 md:via-white md:to-fuchsia-50 dark:md:from-indigo-500/15 dark:md:via-slate-900 dark:md:to-fuchsia-500/10 lg:col-span-2 lg:min-h-[136px]' : ''}`}>
                    <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white shadow-sm ${tone} ${key === 'schedule' ? 'md:h-14 md:w-14' : ''}`}><Icon className="h-5 w-5" /></div>
                    <div className={`mt-auto pt-4 ${key === 'schedule' ? 'md:mt-0 md:pt-0' : ''}`}><h3 className="font-extrabold leading-tight lg:text-[15px]">{title}</h3><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{note}</p></div>
                    <ChevronRight className="ml-auto hidden h-5 w-5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-500 md:block" />
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

    </main>
  )
}
