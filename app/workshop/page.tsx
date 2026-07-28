import { CalendarClock, CheckCircle2, Factory, Hammer, RefreshCw, Sparkles, UsersRound } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'

export default function WorkshopPage() {
  return (
    <main className="min-h-screen pb-8">
      <Header title="Công việc trong xưởng" subtitle="Theo dõi nhiệm vụ và tiến độ trong ngày" />
      <PageContainer>
        <section className="relative overflow-hidden rounded-[2rem] bg-slate-950 p-6 text-white shadow-xl shadow-slate-950/20">
          <div className="absolute -right-16 -top-16 h-52 w-52 rounded-full bg-amber-400/20 blur-3xl" />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-300">Khu vực sản xuất</p>
              <h1 className="mt-2 text-3xl font-black leading-tight">Công việc rõ ràng, phối hợp nhịp nhàng</h1>
              <p className="mt-3 max-w-sm text-sm leading-6 text-slate-300">Nhiệm vụ theo ca và hướng dẫn thực hiện sẽ xuất hiện tại đây.</p>
            </div>
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-amber-400 text-slate-950"><Factory className="h-7 w-7" /></div>
          </div>
        </section>

        <section className="mt-4 grid grid-cols-3 gap-2">
          {[
            { label: 'Theo ca', icon: CalendarClock, tone: 'text-sky-600 bg-sky-50 dark:bg-sky-500/10' },
            { label: 'Theo nhóm', icon: UsersRound, tone: 'text-violet-600 bg-violet-50 dark:bg-violet-500/10' },
            { label: 'Tiến độ', icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10' },
          ].map(({ label, icon: Icon, tone }) => (
            <div key={label} className="mobile-card p-3 text-center">
              <div className={`mx-auto grid h-10 w-10 place-items-center rounded-2xl ${tone}`}><Icon className="h-5 w-5" /></div>
              <p className="mt-2 text-xs font-extrabold">{label}</p>
            </div>
          ))}
        </section>

        <section className="mobile-card mt-4 flex min-h-[300px] flex-col items-center justify-center px-6 text-center">
          <div className="relative">
            <div className="grid h-20 w-20 place-items-center rounded-[1.75rem] bg-amber-50 text-amber-600 dark:bg-amber-500/15"><Hammer className="h-9 w-9" /></div>
            <Sparkles className="absolute -right-3 -top-3 h-6 w-6 text-indigo-500" />
          </div>
          <h2 className="mt-6 text-xl font-black">Chưa có công việc được giao</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Danh sách công việc trong xưởng đang được cập nhật. Khi quản lý phân công, nhiệm vụ sẽ hiển thị theo từng ca.
          </p>
          <div className="mt-6 flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <RefreshCw className="h-3.5 w-3.5" /> Tự động cập nhật
          </div>
        </section>
      </PageContainer>
    </main>
  )
}
