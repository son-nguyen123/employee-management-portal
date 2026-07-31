import { BellRing, BookOpenText, CalendarClock, CheckCircle2, Clock3, ShieldCheck, WalletCards } from 'lucide-react'
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

        <section className="mt-4 space-y-3">
          {[
            {
              title: 'Xin nghỉ đúng hạn',
              note: 'Gửi trước giờ bắt đầu ca ít nhất 24 giờ.',
              approved: 'Duyệt: không khấu trừ',
              rejected: 'Từ chối: khấu trừ 500đ',
              icon: CheckCircle2,
              tone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10',
            },
            {
              title: 'Xin nghỉ trễ hạn',
              note: 'Gửi dưới 24 giờ trước ca, bao gồm gửi trong ngày làm.',
              approved: 'Duyệt: khấu trừ 500đ',
              rejected: 'Từ chối: khấu trừ 1.000đ',
              icon: Clock3,
              tone: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10',
            },
            {
              title: 'Đăng ký lịch tuần trễ hạn',
              note: 'Gửi bảng lịch sau thời hạn đăng ký của tuần.',
              approved: 'Khấu trừ cố định 500đ',
              rejected: 'Không phụ thuộc kết quả duyệt',
              icon: CalendarClock,
              tone: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10',
            },
            {
              title: 'Đổi hoặc hủy ca trong ngày',
              note: 'Yêu cầu thay đổi ca đã duyệt của chính ngày hôm đó.',
              approved: 'Khấu trừ cố định 1.000đ',
              rejected: 'Ca cũ vẫn được giữ nếu yêu cầu bị từ chối',
              icon: WalletCards,
              tone: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10',
            },
          ].map(({ title, note, approved, rejected, icon: Icon, tone }) => (
            <article key={title} className="mobile-card p-4">
              <div className="flex items-start gap-3">
                <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${tone}`}><Icon className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1"><h2 className="font-black">{title}</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">{note}</p></div>
              </div>
              <div className="mt-3 grid gap-2 rounded-2xl bg-slate-50 p-3 text-sm dark:bg-slate-800">
                <p className="font-bold">{approved}</p>
                <p className="text-muted-foreground">{rejected}</p>
              </div>
            </article>
          ))}
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-3 text-xs leading-5 text-indigo-800 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-200">
            Khoản khấu trừ của yêu cầu nghỉ chỉ được chốt khi quản lý Duyệt hoặc Từ chối. Yêu cầu đang chờ xử lý chưa bị trừ tiền.
          </div>
        </section>
      </PageContainer>
    </main>
  )
}
