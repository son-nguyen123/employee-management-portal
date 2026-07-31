'use client'

import { useState } from 'react'
import { CheckCircle2, Loader2, MessageSquareText, Send } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { StaffBanner } from '@/components/staff/staff-banner'
import { submitStaffRequest } from '@/lib/services/staffRequestService'

export default function StaffNotePage() {
  const { authUser, isPreviewMode } = useAuth()
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!authUser || !content.trim()) return
    setSubmitting(true)
    setMessage('')
    try {
      if (!isPreviewMode) await submitStaffRequest({ type: 'note', content: content.trim() })
      setContent('')
      setMessage('Đã gửi ghi chú cho quản lý.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể gửi ghi chú. Vui lòng thử lại.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen pb-28">
      <Header title="Ghi chú cho quản lý" subtitle="Gửi một lời nhắn riêng cần quản lý xem" />
      <PageContainer>
        <StaffBanner icon={MessageSquareText} tone="cyan" eyebrow="Lời nhắn riêng" title="Bạn muốn quản lý biết điều gì?" description="Gửi một ghi chú ngắn để quản lý nắm được việc cần lưu ý trong tuần này." note="Ghi chú sẽ xuất hiện trong danh sách yêu cầu của quản lý." />
        <section className="overflow-hidden rounded-[1.75rem] border border-cyan-100 bg-white shadow-sm dark:border-cyan-500/20 dark:bg-slate-900">
          <form onSubmit={submit} className="p-4">
            <label className="text-sm font-extrabold">
              Nội dung ghi chú
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                maxLength={1000}
                className="mobile-field mt-2 min-h-40 py-3"
                placeholder="Ví dụ: tuần này em cần đổi giờ, em có việc cần quản lý lưu ý..."
                required
              />
            </label>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>Ghi chú sẽ xuất hiện trong danh sách yêu cầu của quản lý.</span>
              <span>{content.length}/1000</span>
            </div>
            <button type="submit" disabled={submitting || !content.trim()} className="mobile-primary-button mt-5 w-full bg-cyan-600 disabled:opacity-50">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {submitting ? 'Đang gửi...' : 'Gửi ghi chú'}
            </button>
          </form>
        </section>
        {message && (
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-emerald-50 p-4 text-sm font-bold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
            <CheckCircle2 className="h-5 w-5 shrink-0" /> {message}
          </div>
        )}
      </PageContainer>
    </main>
  )
}
