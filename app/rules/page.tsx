import { BellRing, BookOpenText, CheckCircle2, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'

export default function RulesPage() {
  return (
    <main className="min-h-screen pb-8">
      <Header title="Điều khoản công ty" subtitle="Quy định dành cho toàn bộ nhân sự" />
      <PageContainer>
        <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-indigo-700 via-violet-700 to-fuchsia-700 p-6 text-white shadow-xl shadow-indigo-950/20">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
          <div className="relative">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/15 backdrop-blur"><BookOpenText className="h-7 w-7" /></div>
            <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-indigo-100">Sổ tay nội bộ</p>
            <h1 className="mt-2 text-3xl font-black leading-tight">Minh bạch để cùng làm việc tốt hơn</h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-indigo-100">
              Tất cả chính sách chính thức sẽ được công bố và lưu phiên bản tại đây.
            </p>
          </div>
        </section>

        <section className="mt-4 grid grid-cols-3 gap-2">
          {[
            { label: 'Bảo mật', icon: ShieldCheck, tone: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-500/10' },
            { label: 'Rõ ràng', icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10' },
            { label: 'Cập nhật', icon: BellRing, tone: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10' },
          ].map(({ label, icon: Icon, tone }) => (
            <div key={label} className="mobile-card p-3 text-center">
              <div className={`mx-auto grid h-10 w-10 place-items-center rounded-2xl ${tone}`}><Icon className="h-5 w-5" /></div>
              <p className="mt-2 text-xs font-extrabold">{label}</p>
            </div>
          ))}
        </section>

        <section className="mobile-card mt-4 flex min-h-[300px] flex-col items-center justify-center px-6 text-center">
          <div className="relative">
            <div className="grid h-20 w-20 place-items-center rounded-[1.75rem] bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15"><RefreshCw className="h-9 w-9" /></div>
            <Sparkles className="absolute -right-3 -top-3 h-6 w-6 text-amber-500" />
          </div>
          <h2 className="mt-6 text-xl font-black">Nội dung đang được biên soạn</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Nội dung điều khoản công ty đang được cập nhật. Bạn sẽ nhận thông báo khi phiên bản đầu tiên được công bố.
          </p>
          <span className="mt-6 rounded-full bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            Chưa yêu cầu xác nhận
          </span>
        </section>
      </PageContainer>
    </main>
  )
}
