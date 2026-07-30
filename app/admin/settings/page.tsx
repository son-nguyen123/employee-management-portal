'use client'

import { useEffect, useState } from 'react'
import { Loader2, MailCheck, ShieldCheck } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { useAuth, useUserRole } from '@/lib/hooks/useAuth'
import {
  getAuditReceiptSettings,
  updateAuditReceiptSettings,
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

  useEffect(() => {
    if (!authUser) return
    if (isPreviewMode) {
      setLoading(false)
      return
    }
    void getAuditReceiptSettings()
      .then(setSettings)
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
