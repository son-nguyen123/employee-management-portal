'use client'

import { useEffect, useState } from 'react'
import { Clock3, Loader2, MailCheck, ShieldCheck, UserPlus } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { useAuth, useUserRole } from '@/lib/hooks/useAuth'
import {
  getAuditReceiptSettings,
  getAccountRegistrationWindow,
  updateAuditReceiptSettings,
  updateAccountRegistrationWindow,
} from '@/lib/services/managementSettingsService'

type ReceiptSettings = {
  emailEnabled: boolean
  auditTrailEnabled: boolean
  emailEnvironmentEnabled: boolean
  emailConfigured: boolean
}

export default function AdminSettingsPage() {
  const { authUser, isPreviewMode } = useAuth()
  const role = useUserRole()
  const [settings, setSettings] = useState<ReceiptSettings>({
    emailEnabled: false,
    auditTrailEnabled: true,
    emailEnvironmentEnabled: false,
    emailConfigured: false,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [registration, setRegistration] = useState<{ isOpen: boolean; closesAt: string | null }>({ isOpen: false, closesAt: null })
  const [registrationSaving, setRegistrationSaving] = useState(false)

  useEffect(() => {
    if (!authUser) return
    if (isPreviewMode) {
      setLoading(false)
      return
    }
    void Promise.all([getAuditReceiptSettings(), getAccountRegistrationWindow()])
      .then(([receipt, accountWindow]) => { setSettings(receipt); setRegistration(accountWindow) })
      .catch(() => setMessage('Chưa tải được cài đặt email biên nhận.'))
      .finally(() => setLoading(false))
  }, [authUser, isPreviewMode])

  const toggleEmail = async () => {
    const nextEnabled = !settings.emailEnabled
    setSaving(true)
    setMessage('')
    try {
      if (isPreviewMode) {
        setSettings((current) => ({ ...current, emailEnabled: nextEnabled }))
      } else {
        setSettings(await updateAuditReceiptSettings(nextEnabled))
      }
      setMessage(nextEnabled
        ? 'Đã bật email biên nhận cho các thao tác mới.'
        : 'Đã tắt gửi email; các email đang chờ cũng đã được hủy.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể lưu cài đặt.')
    } finally {
      setSaving(false)
    }
  }

  const toggleRegistration = async () => {
    setRegistrationSaving(true)
    setMessage('')
    try {
      const next = isPreviewMode
        ? { isOpen: !registration.isOpen, closesAt: !registration.isOpen ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : new Date().toISOString() }
        : await updateAccountRegistrationWindow(!registration.isOpen)
      setRegistration(next)
      setMessage(next.isOpen ? 'Đã mở tạo tài khoản trong 1 giờ.' : 'Đã đóng tạo tài khoản mới.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể cập nhật cổng tạo tài khoản.')
    } finally {
      setRegistrationSaving(false)
    }
  }

  if ((!role || !['admin', 'manager'].includes(role)) && !isPreviewMode) return null

  return (
    <main className="min-h-screen pb-8">
      <Header title="Cài đặt" subtitle="Email biên nhận và tính minh bạch dữ liệu" />
      <PageContainer>
        {message && <p className="mb-4 rounded-2xl bg-indigo-50 p-3 text-sm font-semibold text-indigo-800">{message}</p>}
        <section className="mobile-card p-4">
          <div className="flex items-center gap-3">
            <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${settings.emailEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <MailCheck className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-extrabold">Email biên nhận nhân viên</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {settings.emailEnabled && settings.emailConfigured
                  ? 'Đang bật · chỉ gửi khi có thao tác mới'
                  : settings.emailConfigured
                    ? 'Đang tắt · không gửi email cho nhân viên'
                    : 'Đang tắt · Gmail chưa được kết nối'}
              </p>
            </div>
            <button type="button" disabled={loading || saving || (!settings.emailEnabled && !settings.emailConfigured)} onClick={() => void toggleEmail()} className={`min-h-11 rounded-xl px-4 text-xs font-extrabold text-white disabled:opacity-45 ${settings.emailEnabled ? 'bg-rose-600' : 'bg-emerald-600'}`}>
              {saving ? 'Đang lưu...' : settings.emailEnabled ? 'Tắt gửi' : 'Bật gửi'}
            </button>
          </div>
        </section>
        {role === 'admin' && (
          <section className="mt-4 overflow-hidden rounded-3xl border border-fuchsia-200 bg-transparent shadow-sm dark:border-fuchsia-500/30">
            <div className="flex items-center gap-3 p-4">
              <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${registration.isOpen ? 'bg-fuchsia-100 text-fuchsia-700' : 'bg-slate-100 text-slate-500'}`}>
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserPlus className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-extrabold">Mở tạo tài khoản trong 1 giờ</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {registration.isOpen && registration.closesAt
                    ? `Đang mở · tự đóng lúc ${new Date(registration.closesAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
                    : 'Đang đóng · nhân viên mới chưa thể đăng ký'}
                </p>
              </div>
              <button type="button" disabled={loading || registrationSaving} onClick={() => void toggleRegistration()} className={`min-h-11 rounded-xl px-4 text-xs font-extrabold text-white disabled:opacity-45 ${registration.isOpen ? 'bg-rose-600' : 'bg-fuchsia-600'}`}>
                {registrationSaving ? <Loader2 className="mx-2 h-4 w-4 animate-spin" /> : registration.isOpen ? 'Đóng cổng' : 'Mở trong 1 giờ'}
              </button>
            </div>
            <div className="flex items-start gap-2 border-t border-fuchsia-100 px-4 py-3 text-xs leading-5 text-muted-foreground dark:border-fuchsia-500/20">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-fuchsia-600" />
              <span>Trong thời gian mở, mọi người có thể tạo hồ sơ. Tài khoản vẫn chờ admin duyệt trước khi dùng tiện ích.</span>
            </div>
          </section>
        )}
        <section className="mt-4 flex gap-3 rounded-3xl border border-indigo-100 bg-indigo-50 p-4 text-indigo-900">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h2 className="font-extrabold">Nhật ký kiểm chứng vẫn luôn bật</h2>
            <p className="mt-1 text-sm leading-6">Tắt email chỉ dừng gửi thư cho nhân viên, không làm mất lịch sử thao tác và dấu kiểm chứng đã lưu.</p>
          </div>
        </section>
      </PageContainer>
    </main>
  )
}
