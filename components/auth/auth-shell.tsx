import { CalendarCheck2, CheckCircle2, ShieldCheck } from 'lucide-react'

export function AuthShell({ children, eyebrow }: { children: React.ReactNode; eyebrow: string }) {
  return (
    <main className="min-h-[100svh] bg-white dark:bg-slate-950 lg:grid lg:grid-cols-[1.05fr_.95fr]">
      <section className="relative hidden overflow-hidden bg-slate-950 p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-16">
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-indigo-500/30 blur-3xl" />
        <div className="absolute -bottom-28 left-10 h-72 w-72 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10"><ShieldCheck className="h-6 w-6" /></div>
          <div><p className="text-xs font-bold uppercase tracking-[.22em] text-indigo-300">NS Portal</p><p className="font-extrabold">Cổng nhân viên</p></div>
        </div>
        <div className="relative max-w-xl">
          <p className="text-sm font-bold uppercase tracking-[.18em] text-indigo-300">{eyebrow}</p>
          <h1 className="mt-4 text-5xl font-black leading-[1.08]">Mọi yêu cầu công việc trong một nơi.</h1>
          <p className="mt-5 max-w-lg text-lg leading-8 text-slate-300">Đăng ký lịch, xin nghỉ, báo đi trễ và theo dõi phản hồi rõ ràng trên cả điện thoại lẫn máy tính.</p>
          <div className="mt-8 grid grid-cols-2 gap-3">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4"><CalendarCheck2 className="h-6 w-6 text-indigo-300" /><p className="mt-4 font-bold">Lịch làm minh bạch</p></div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4"><CheckCircle2 className="h-6 w-6 text-emerald-300" /><p className="mt-4 font-bold">Theo dõi từng yêu cầu</p></div>
          </div>
        </div>
        <p className="relative text-xs text-slate-500">Thiết kế tối ưu cho thao tác một tay trên điện thoại.</p>
      </section>
      <section className="flex min-h-[100svh] items-center justify-center bg-gradient-to-b from-indigo-50/80 via-white to-white px-4 py-8 dark:from-indigo-950/30 dark:via-slate-950 dark:to-slate-950 sm:px-8 lg:py-12">
        <div className="w-full max-w-md">{children}</div>
      </section>
    </main>
  )
}
