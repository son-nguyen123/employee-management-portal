'use client'

import { useEffect, useState } from 'react'
import { Bell, CheckCheck, Loader2 } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { useAuth } from '@/lib/hooks/useAuth'
import {
  markAllNotificationsAsRead,
  markNotificationAsRead,
  subscribeToEmployeeNotifications,
} from '@/lib/services/notificationService'
import type { Notification } from '@/lib/models/types'

export default function NotificationsPage() {
  const { authUser, isPreviewMode } = useAuth()
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

  const markOne = async (item: Notification) => {
    if (!item.id || item.isRead) return
    if (isPreviewMode) {
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, isRead: true } : row))
      return
    }
    try {
      await markNotificationAsRead(item.id)
    } catch {
      setMessage('Chưa thể đánh dấu thông báo đã đọc.')
    }
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
        {!!items.some((item) => !item.isRead) && (
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
                  onClick={() => void markOne(item)}
                  className={`mobile-card flex w-full gap-3 p-4 text-left ${!item.isRead ? 'border-indigo-200 bg-indigo-50/50 dark:bg-indigo-500/5' : ''}`}
                >
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15"><Bell className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-extrabold">{item.title}</h2>
                      {!item.isRead && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-indigo-600" />}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{item.message}</p>
                    <p className="mt-2 text-xs font-semibold text-indigo-600">{createdAt.toLocaleString('vi-VN')}</p>
                  </div>
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
