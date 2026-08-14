'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  BellRing,
  BookOpenText,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Database,
  Info,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import { Header } from '@/components/layout/header'
import { PageContainer } from '@/components/layout/page-container'
import { AppLoadingScreen } from '@/components/ui/app-loading-screen'
import { useAuth, useUserRole } from '@/lib/hooks/useAuth'

const managementRoles = ['admin', 'manager', 'director']

const workflowSections = [
  {
    eyebrow: '01 · LỊCH LÀM',
    title: 'Theo dõi đúng mốc tuần',
    icon: CalendarDays,
    tone: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
    items: [
      ['Nhân viên đăng ký', 'Từ thứ Bảy, nhân viên nhập lịch cho tuần kế tiếp. Bảng đăng ký trong Điều hành dùng để kiểm tra người đã gửi và các ca cần lưu ý.'],
      ['Nhân sự tuần này', 'Mở mục này vào đầu tuần để xem người làm và người trực của tuần đang chạy; không dùng mục này để đoán danh sách tuần kế tiếp.'],
      ['Tự động duyệt và hủy lịch', 'Lịch đạt điều kiện có thể được hệ thống tự duyệt. Admin vẫn mở từng nhân viên để kiểm tra, từ chối hoặc hủy ca khi có trường hợp không phù hợp.'],
      ['Chủ nhật ngoại lệ', 'Nếu được bật cho phép gửi lại, nhân viên có thể sửa lịch trong Chủ nhật mà không bị trừ tiền. Qua 00:00 thứ Hai, lịch gửi trễ áp dụng luật bình thường.'],
    ],
  },
  {
    eyebrow: '02 · YÊU CẦU',
    title: 'Xử lý và kiểm tra sau khi duyệt',
    icon: ClipboardCheck,
    tone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
    items: [
      ['Điều hành', 'Dùng để xem các yêu cầu đang chờ, mở chi tiết nhân viên và duyệt hoặc từ chối. Khi từ chối, nên ghi lý do ngắn để nhân viên hiểu và gửi lại đúng cách.'],
      ['Lịch sử xử lý', 'Giữ tuần hiện tại và tuần trước. Tuần hiện tại được phép sửa thao tác nhầm; tuần trước chỉ để đối chiếu và không còn nút sửa.'],
      ['Thông báo', 'Mỗi quyết định quan trọng sẽ tạo thông báo cho nhân viên. Nếu nhân viên phản hồi hoặc gửi lại, hãy mở lại đúng yêu cầu thay vì tạo bản ghi mới thủ công.'],
      ['Đổi xưởng và chế độ làm việc', 'Yêu cầu đổi xưởng, đổi cố định/xoay ca và đổi/thêm ca đều xử lý trong khu vực yêu cầu của nhân viên đó. Xưởng hiện tại chỉ đổi sau khi được duyệt.'],
    ],
  },
  {
    eyebrow: '03 · ỨNG LƯƠNG VÀ PHẠT',
    title: 'Đọc dữ liệu theo tháng',
    icon: CircleDollarSign,
    tone: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
    items: [
      ['Ứng lương', 'Mở Danh sách ứng lương, chọn tháng ở thanh tháng phía trên. Tháng hiện tại là nơi theo dõi yêu cầu mới; tháng cũ là dữ liệu đã duyệt/từ chối để đối chiếu. Director chỉ xem danh sách đã được admin duyệt.'],
      ['Quy tắc ngày 24–25', 'Nếu công tắc giới hạn trong Cài đặt đang bật, nhân viên chỉ gửi ứng lương vào ngày 24 và 25. Admin vẫn có quyền xử lý các yêu cầu đã gửi.'],
      ['Quản lý phạt', 'Mở mục phạt rồi chuyển tháng để xem chi tiết từng khoản, người bị phạt và tổng số tiền. Tháng hiện tại kết hợp dữ liệu Firebase với bản lưu nếu đã có; tháng cũ tra cứu từ Drive.'],
      ['Không xóa để sửa số liệu', 'Muốn chỉnh thao tác nhầm, dùng Lịch sử xử lý hoặc nút sửa của đúng nghiệp vụ. Không tự xóa bản ghi Firebase vì bản lưu Drive và nhật ký kiểm chứng cần được giữ liên kết.'],
    ],
  },
  {
    eyebrow: '04 · LƯU TRỮ VÀ RESET',
    title: 'Biết dữ liệu đang nằm ở đâu',
    icon: Database,
    tone: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
    items: [
      ['Lưu tuần', 'Sau khi chốt tuần, hệ thống tạo bản lưu tuần trên Google Drive. Dữ liệu Firebase chỉ được dọn sau khi bản lưu đã được xác minh; nếu lưu lỗi, dữ liệu Firebase vẫn còn.'],
      ['Lưu tháng', 'Khoản phạt và ứng lương được gom theo tháng trên Drive. Khi mở Kho dữ liệu, chọn tháng để xem tổng quan, lọc theo loại dữ liệu/nhân viên hoặc xuất báo cáo.'],
      ['Thanh tháng', 'Thanh tháng luôn nằm trên cùng mỗi màn hình dữ liệu. Mặc định là tháng hiện tại hoặc tháng mới nhất có dữ liệu; tháng không có bản lưu sẽ hiển thị trạng thái rỗng, không phải lỗi tải.'],
      ['Cache hiển thị', 'Cache chỉ là lớp tăng tốc cho tháng hiện tại và tháng trước, có tự hết hạn và cập nhật lại khi dữ liệu thay đổi. Nó không thay thế Firebase hay Google Drive.'],
    ],
  },
]

export default function AdminGuidePage() {
  const router = useRouter()
  const { authUser, employee, isLoading, isPreviewMode } = useAuth()
  const role = useUserRole()
  const canAccess = isPreviewMode || managementRoles.includes(role || '')

  useEffect(() => {
    if (isLoading) return
    if (!authUser) {
      router.replace('/auth/login')
      return
    }
    if (employee && !canAccess) router.replace('/')
  }, [authUser, canAccess, employee, isLoading, router])

  if (isLoading || !authUser || !canAccess) return <AppLoadingScreen />

  return (
    <main className="min-h-screen pb-8">
      <Header title="Hướng dẫn sử dụng" subtitle="Sổ tay nghiệp vụ dành cho quản lý" showBackButton={false} />
      <PageContainer>
        <section className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-5 text-white shadow-xl shadow-indigo-950/15 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15 backdrop-blur-sm"><BookOpenText className="h-6 w-6" /></div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/75">Cẩm nang vận hành</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight">Mở đúng mục, xem đúng mốc</h2>
              <p className="mt-2 text-sm leading-6 text-white/85">Trang này tóm tắt cách app vận hành để admin kiểm tra, xử lý và tra cứu dữ liệu mà không nhầm giữa tuần đang chạy, tuần đăng ký và tháng lưu trữ.</p>
            </div>
          </div>
          <div className="mt-5 flex items-center gap-2 rounded-2xl bg-white/12 px-3 py-2.5 text-xs font-bold text-white/90">
            <Info className="h-4 w-4 shrink-0" />
            <span>Luôn ưu tiên mở đúng màn hình nghiệp vụ trước khi thao tác dữ liệu.</span>
          </div>
        </section>

        <section className="mt-6 space-y-3">
          {workflowSections.map(({ eyebrow, title, icon: Icon, tone, items }) => (
            <article key={title} className="mobile-card overflow-hidden">
              <header className="flex items-center gap-3 border-b border-slate-100 p-4 dark:border-white/10">
                <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${tone}`}><Icon className="h-5 w-5" /></div>
                <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{eyebrow}</p><h2 className="mt-1 text-lg font-black">{title}</h2></div>
              </header>
              <div className="divide-y divide-slate-100 dark:divide-white/10">
                {items.map(([label, detail]) => (
                  <div key={label} className="flex gap-3 p-4">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    <div className="min-w-0"><h3 className="text-sm font-extrabold">{label}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{detail}</p></div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>

        <section className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-3xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-500/20 dark:bg-sky-500/10">
            <div className="flex items-center gap-3"><Settings className="h-5 w-5 text-sky-600" /><h2 className="font-black text-sky-950 dark:text-sky-100">Cài đặt cần nhớ</h2></div>
            <p className="mt-2 text-sm leading-5 text-sky-900/75 dark:text-sky-100/75">Mở đăng ký tài khoản 1 giờ, giới hạn ngày ứng lương, bật tắt tiện ích user và email biên nhận.</p>
          </div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">
            <div className="flex items-center gap-3"><ShieldCheck className="h-5 w-5 text-amber-600" /><h2 className="font-black">Nguyên tắc an toàn</h2></div>
            <p className="mt-2 text-sm leading-5 text-amber-900/75 dark:text-amber-100/75">Không xóa dữ liệu để xử lý nhanh. Nếu có thao tác nhầm, xem lịch sử và sửa đúng bản ghi; kho Drive là lớp đối chiếu dài hạn.</p>
          </div>
        </section>

        <section className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-slate-900/70">
          <div className="flex items-start gap-3"><BellRing className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" /><div><h2 className="font-black">Nếu chưa chắc nên vào đâu</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Lịch làm → Điều hành hoặc Nhân sự tuần này. Yêu cầu cá nhân → Điều hành. Số liệu phạt/ứng lương cũ → màn hình tương ứng và thanh tháng. Bản lưu tổng hợp → Kho dữ liệu.</p></div></div>
        </section>
      </PageContainer>
    </main>
  )
}
