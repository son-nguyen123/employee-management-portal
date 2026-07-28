'use client'

import { useEffect, useState } from 'react'
import { Bell, CheckCheck, ChevronRight, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { useAuth, useUserRole } from '@/lib/hooks/useAuth'
import {
  markAllNotificationsAsRead,
  markNotificationAsRead,
  subscribeToEmployeeNotifications,
} from '@/lib/services/notificationService'
import type { Notification } from '@/lib/models/types'

export default function NotificationsPage() {
  const router = useRouter()
  const { authUser, isPreviewMode } = useAuth()
  const role = useUserRole()
  const isManagement = role === 'admin' || role === 'manager'
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!authUser) return
    if (isPreviewMode) {
      setItems([{
        id: 'preview-notification',
        employeeId: authUser.uid,
        title: 'Lịch làm đã được xử lý',
        message: 'Ca làm của bạn đã được duyệt.',
        type: 'success',
        isRead: false,
        createdAt: new Date(),
      }])
      setLoading(false)
      return
    }
    const unsubscribe = subscribeToEmployeeNotifications(authUser.uid, (notifications) => {
      setItems(notifications)
      setLoading(false)
    })
    return unsubscribe
  }, [authUser, isPreviewMode])

  const destinationFor = (item: Notification) => {
    const content = `${item.title} ${item.message}`.toLocaleLowerCase('vi')
    if (isManagement) {
      if (content.includes('lịch') || content.includes('ca làm')) return '/admin/dashboard#schedules'
      return '/admin/requests'
    }
    if (content.includes('nghỉ')) return '/leave-request'
    if (content.includes('trễ')) return '/late-arrival'
    if (content.includes('ứng lương')) return '/salary-advance'
    if (content.includes('phạt')) return '/penalties'
    return '/schedule'
  }

  const openNotification = async (item: Notification) => {
    const destination = destinationFor(item)

    // Thông báo quản lý là một việc cần xử lý. Chỉ workflow xác nhận/từ chối
    // mới đóng thông báo; việc mở để xem không làm mất dấu việc đang chờ.
    if (isManagement) {
      router.push(destination)
      return
    }

    if (item.id && !item.isRead) {
      if (isPreviewMode) {
        setItems((current) => current.map((row) => row.id === item.id ? { ...row, isRead: true } : row))
      } else {
        try {
          await markNotificationAsRead(item.id)
        } catch {
          setMessage('Chưa thể đánh dấu thông báo đã đọc.')
        }
      }
    }
    router.push(destination)
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
      <Header title="Thông báo" subtitle="Cập nhật từ quản lý và hệ thống" />
      <PageContainer>
        {!isManagement && !!items.some((item) => !item.isRead) && (
          <button onClick={markAll} className="mb-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-indigo-200 text-sm font-bold text-indigo-600">
            <CheckCheck className="h-4 w-4" /> Đánh dấu tất cả đã đọc
          </button>
        )}
        {message && <p className="mb-4 rounded-2xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{message}</p>}
        {loading ? (
          <div className="grid min-h-48 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const createdAt = item.createdAt instanceof Date ? item.createdAt : item.createdAt.toDate()
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void openNotification(item)}
                  className={`mobile-card flex w-full gap-3 p-4 text-left ${!item.isRead ? 'border-indigo-200 bg-indigo-50/50 dark:bg-indigo-500/5' : ''}`}
                >
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15"><Bell className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-extrabold">{item.title}</h2>
                      {!item.isRead && (
                        isManagement
                          ? <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-amber-700">Cần xử lý</span>
                          : <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-indigo-600" />
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{item.message}</p>
                    <p className="mt-2 text-xs font-semibold text-indigo-600">{createdAt.toLocaleString('vi-VN')}</p>
                  </div>
                  <ChevronRight className="mt-3 h-5 w-5 shrink-0 text-slate-400" />
                </button>
              )
            })}
            {!items.length && <div className="mobile-card p-8 text-center font-bold">Chưa có thông báo.</div>}
          </div>
        )}
      </PageContainer>
    </main>
  )
}
