'use client'

import { useEffect, useState } from 'react'
import {
  Bell,
  CalendarDays,
  CheckCheck,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileText,
  Loader2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { useAuth, useUserRole } from '@/lib/hooks/useAuth'
import {
  markAllNotificationsAsRead,
  markNotificationAsRead,
  subscribeToEmployeeNotifications,
  subscribeToManagementPendingItems,
  type ManagementPendingItem,
} from '@/lib/services/notificationService'
import type { Notification } from '@/lib/models/types'

const managementMeta = {
  schedule: { icon: CalendarDays, color: 'bg-indigo-600' },
  leave: { icon: FileText, color: 'bg-emerald-600' },
  late: { icon: Clock3, color: 'bg-amber-500' },
  salary: { icon: CircleDollarSign, color: 'bg-sky-600' },
}

export default function NotificationsPage() {
  const router = useRouter()
  const { authUser, isPreviewMode } = useAuth()
  const role = useUserRole()
  const isManagement = role === 'admin' || role === 'manager'
  const [items, setItems] = useState<Notification[]>([])
  const [pendingItems, setPendingItems] = useState<ManagementPendingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [weekView, setWeekView] = useState<'current' | 'previous'>('current')

  const weekWindow = (view: typeof weekView) => {
    const now = new Date()
    const monday = new Date(now)
    const weekday = monday.getDay() || 7
    monday.setDate(monday.getDate() - weekday + 1 + (view === 'previous' ? -7 : 0))
    monday.setHours(0, 0, 0, 0)
    const end = new Date(monday)
    end.setDate(monday.getDate() + 7)
    return { start: monday, end }
  }
  const visibleItems = items.filter((item) => {
    const createdAt = item.createdAt instanceof Date ? item.createdAt : item.createdAt.toDate()
    const window = weekWindow(weekView)
    return createdAt >= window.start && createdAt < window.end
  })
  const visiblePendingItems = pendingItems.filter((item) => {
    const window = weekWindow(weekView)
    return item.createdAt >= window.start && item.createdAt < window.end
  })
  const visibleManagementHistory = visibleItems.filter((item) => {
    const text = `${item.title} ${item.message}`.toLocaleLowerCase('vi')
    return !text.includes('chờ') &&
      !text.includes('đang sửa') &&
      text.includes('nhân viên:')
  })

  useEffect(() => {
    if (!authUser) return

    if (isPreviewMode) {
      if (isManagement) {
        setPendingItems([{
          id: 'preview-request',
          type: 'leave',
          employeeId: 'preview-employee',
          employeeName: 'Nguyễn Minh An',
          employeeCode: 'NV-001',
          title: 'Yêu cầu xin nghỉ',
          detail: new Date().toLocaleDateString('vi-VN'),
          reason: 'Có việc gia đình',
          createdAt: new Date(),
          href: '/admin/requests',
        }])
      } else {
        setItems([{
          id: 'preview-notification',
          employeeId: authUser.uid,
          title: 'Lịch làm đã được xử lý',
          message: 'Ca làm của bạn đã được duyệt.',
          type: 'success',
          isRead: false,
          createdAt: new Date(),
        }])
      }
      setLoading(false)
      return
    }

    if (isManagement) {
      const unsubscribePending = subscribeToManagementPendingItems(
        (pending) => {
          setPendingItems(pending)
          setLoading(false)
          setMessage('')
        },
        () => {
          setMessage('Chưa thể tải các việc đang chờ xử lý. Vui lòng thử lại.')
          setLoading(false)
        }
      )
      const unsubscribeNotifications = subscribeToEmployeeNotifications(authUser.uid, (notifications) => {
        setItems(notifications)
        setLoading(false)
      })
      return () => {
        unsubscribePending()
        unsubscribeNotifications()
      }
    }

    return subscribeToEmployeeNotifications(authUser.uid, (notifications) => {
      setItems(notifications)
      setLoading(false)
    })
  }, [authUser, isManagement, isPreviewMode])

  const destinationFor = (item: Notification) => {
    if (isManagement) return '/admin/history'
    const content = `${item.title} ${item.message}`.toLocaleLowerCase('vi')
    if (content.includes('nghỉ')) return '/leave-request'
    if (content.includes('trễ')) return '/late-arrival'
    if (content.includes('ứng lương')) return '/salary-advance'
    if (content.includes('phạt')) return '/penalties'
    return '/schedule'
  }

  const openNotification = async (item: Notification) => {
    if (item.id && !item.isRead) {
      if (isPreviewMode) {
        setItems((current) => current.map((row) =>
          row.id === item.id ? { ...row, isRead: true } : row
        ))
      } else {
        try {
          await markNotificationAsRead(item.id)
        } catch {
          setMessage('Chưa thể đánh dấu thông báo đã đọc.')
        }
      }
    }
    router.push(destinationFor(item))
  }

  const markAll = async () => {
    if (!authUser) return
    if (isPreviewMode) {
      setItems((current) => current.map((item) => ({ ...item, isRead: true })))
      return
    }
    try {
      await markAllNotificationsAsRead(authUser.uid)
    } catch {
      setMessage('Chưa thể đánh dấu tất cả thông báo.')
    }
  }

  return (
    <main className="min-h-screen">
      <Header
        title="Thông báo"
        subtitle={isManagement ? 'Yêu cầu mới và kết quả xử lý theo tuần' : 'Cập nhật từ quản lý và hệ thống'}
      />
      <PageContainer>
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
            <button type="button" onClick={() => setWeekView('current')} className={`min-h-11 rounded-xl text-sm font-bold ${weekView === 'current' ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-950' : 'text-muted-foreground'}`}>Tuần này</button>
            <button type="button" onClick={() => setWeekView('previous')} className={`min-h-11 rounded-xl text-sm font-bold ${weekView === 'previous' ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-950' : 'text-muted-foreground'}`}>Tuần trước</button>
        </div>
        {!isManagement && !!visibleItems.some((item) => !item.isRead) && (
          <button
            onClick={markAll}
            className="mb-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-indigo-200 text-sm font-bold text-indigo-600"
          >
            <CheckCheck className="h-4 w-4" /> Đánh dấu tất cả đã đọc
          </button>
        )}
        {message && (
          <p className="mb-4 rounded-2xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">
            {message}
          </p>
        )}
        {loading ? (
          <div className="grid min-h-48 place-items-center">
            <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
          </div>
        ) : isManagement ? (
          <div className="space-y-3">
            {visiblePendingItems.map((item) => {
              const meta = managementMeta[item.type]
              const Icon = meta.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => router.push(item.href)}
                  className="mobile-card w-full overflow-hidden text-left"
                >
                  <div className="flex items-start gap-3 p-4">
                    <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white ${meta.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="font-extrabold">{item.title}</h2>
                        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-amber-700">
                          Cần xử lý
                        </span>
                      </div>
                      <p className="mt-1 font-bold text-slate-800 dark:text-slate-100">
                        {item.employeeName}
                        {item.employeeCode ? ` · ${item.employeeCode}` : ''}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
                      {item.reason && (
                        <p className="mt-2 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          <span className="font-bold">Lý do:</span> {item.reason}
                        </p>
                      )}
                      <p className="mt-2 text-xs font-semibold text-indigo-600">
                        Gửi lúc {item.createdAt.toLocaleString('vi-VN')}
                      </p>
                    </div>
                    <ChevronRight className="mt-3 h-5 w-5 shrink-0 text-slate-400" />
                  </div>
                </button>
              )
            })}
            {visibleManagementHistory.map((item) => {
              const createdAt = item.createdAt instanceof Date ? item.createdAt : item.createdAt.toDate()
              return (
                <button key={item.id} type="button" onClick={() => void openNotification(item)} className="mobile-card flex w-full gap-3 p-4 text-left">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10"><CheckCheck className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1"><h2 className="font-extrabold">{item.title}</h2><p className="mt-1 text-sm text-muted-foreground">{item.message}</p><p className="mt-2 text-xs font-semibold text-emerald-600">{createdAt.toLocaleString('vi-VN')}</p></div>
                  <ChevronRight className="mt-3 h-5 w-5 shrink-0 text-slate-400" />
                </button>
              )
            })}
            {!visiblePendingItems.length && !visibleManagementHistory.length && (
              <div className="mobile-card p-8 text-center">
                <CheckCheck className="mx-auto h-8 w-8 text-emerald-600" />
                <h2 className="mt-3 font-extrabold">{weekView === 'current' ? 'Tuần này chưa có thông báo' : 'Tuần trước không có thông báo'}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Yêu cầu mới và kết quả xử lý sẽ xuất hiện tại đây.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {visibleItems.map((item) => {
              const createdAt = item.createdAt instanceof Date ? item.createdAt : item.createdAt.toDate()
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void openNotification(item)}
                  className={`mobile-card flex w-full gap-3 p-4 text-left ${
                    !item.isRead ? 'border-indigo-200 bg-indigo-50/50 dark:bg-indigo-500/5' : ''
                  }`}
                >
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15">
                    <Bell className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-extrabold">{item.title}</h2>
                      {!item.isRead && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-indigo-600" />}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{item.message}</p>
                    <p className="mt-2 text-xs font-semibold text-indigo-600">
                      {createdAt.toLocaleString('vi-VN')}
                    </p>
                  </div>
                  <ChevronRight className="mt-3 h-5 w-5 shrink-0 text-slate-400" />
                </button>
              )
            })}
            {!visibleItems.length && (
              <div className="mobile-card p-8 text-center font-bold">{weekView === 'current' ? 'Tuần này chưa có thông báo.' : 'Tuần trước không có thông báo.'}</div>
            )}
          </div>
        )}
      </PageContainer>
    </main>
  )
}
