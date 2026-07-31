'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, CreditCard, IdCard, Landmark, Link as LinkIcon, Loader2, LogOut, Phone, Save, UserRound } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import { createEmployee, updateEmployee } from '@/lib/services/employeeService'
import { updateUserProfile } from '@/lib/services/authService'

export default function ProfileSetupPage() {
  const router = useRouter()
  const { authUser, employee, isLoading, refreshEmployee, logout } = useAuth()
  const [form, setForm] = useState({
    fullName: '',
    employeeCode: '',
    phone: '',
    photoURL: '',
    facebookUrl: '',
    bankName: '',
    bankAccountName: '',
    bankAccountNumber: '',
  })
  const [saving, setSaving] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!isLoading && !authUser) router.replace('/auth/login')
    if (!authUser) return
    setForm({
      fullName: employee?.fullName || authUser.displayName || '',
      employeeCode: employee?.employeeCode || '',
      phone: employee?.phone || '',
      photoURL: employee?.photoURL || authUser.photoURL || '',
      facebookUrl: employee?.facebookUrl || '',
      bankName: employee?.bankName || '',
      bankAccountName: employee?.bankAccountName || '',
      bankAccountNumber: employee?.bankAccountNumber || '',
    })
  }, [authUser, employee, isLoading, router])

  const setValue = (field: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [field]: value }))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!authUser) return
    const values = Object.fromEntries(
      Object.entries(form).map(([key, value]) => [key, value.trim()])
    ) as typeof form
    if (['fullName', 'employeeCode', 'phone', 'photoURL', 'facebookUrl'].some((key) => !values[key as keyof typeof values])) {
      setMessage('Vui lòng hoàn thiện đầy đủ thông tin cá nhân.')
      return
    }
    if (!/^https?:\/\//i.test(values.photoURL) || !/^https?:\/\//i.test(values.facebookUrl)) {
      setMessage('Link ảnh đại diện và Facebook phải bắt đầu bằng http:// hoặc https://.')
      return
    }
    const hasAnyBankValue = Boolean(values.bankName || values.bankAccountName || values.bankAccountNumber)
    if (hasAnyBankValue && !(values.bankName && values.bankAccountName && values.bankAccountNumber)) {
      setMessage('Nếu thêm tài khoản nhận lương, vui lòng điền đủ ngân hàng, tên chủ tài khoản và số tài khoản.')
      return
    }
    if (hasAnyBankValue && !/^\d{6,24}$/.test(values.bankAccountNumber.replace(/\s/g, ''))) {
      setMessage('Số tài khoản chỉ gồm 6–24 chữ số.')
      return
    }
    values.bankAccountNumber = values.bankAccountNumber.replace(/\s/g, '')
    setSaving(true)
    setMessage('')
    try {
      if (employee) {
        await updateEmployee(authUser.uid, values)
      } else {
        await createEmployee(authUser.uid, {
          ...values,
          email: authUser.email || '',
          joinDate: new Date(),
          role: 'employee',
          status: 'active',
        })
      }
      await updateUserProfile(values.fullName, values.photoURL)
      await refreshEmployee()
      router.replace('/')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Chưa thể lưu hồ sơ. Vui lòng thử lại.')
    } finally {
      setSaving(false)
    }
  }

  const switchAccount = async () => {
    setSigningOut(true)
    setMessage('')
    try {
      await logout()
      router.replace('/auth/login')
    } catch {
      setMessage('Chưa thể đăng xuất. Vui lòng thử lại.')
      setSigningOut(false)
    }
  }

  if (isLoading || !authUser) {
    return <main className="grid min-h-screen place-items-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></main>
  }

  const fields = [
    { key: 'photoURL' as const, label: 'Ảnh đại diện', placeholder: 'https://.../avatar.jpg', icon: Camera },
    { key: 'fullName' as const, label: 'Họ và tên', placeholder: 'Nguyễn Văn An', icon: UserRound },
    { key: 'employeeCode' as const, label: 'Mã nhân viên', placeholder: 'NV-001', icon: IdCard },
    { key: 'phone' as const, label: 'Số điện thoại', placeholder: '0901 234 567', icon: Phone },
    { key: 'facebookUrl' as const, label: 'Facebook', placeholder: 'https://facebook.com/ten-cua-ban', icon: LinkIcon },
  ]
  const bankOptions = [
    'Vietcombank', 'VietinBank', 'BIDV', 'Agribank', 'Techcombank', 'MB Bank',
    'ACB', 'VPBank', 'TPBank', 'Sacombank', 'HDBank', 'VIB', 'MSB', 'OCB',
    'SeABank', 'SHB', 'Eximbank', 'LienVietPostBank', 'Nam A Bank', 'VietBank',
    'VietABank', 'Bac A Bank', 'BaoViet Bank', 'KienlongBank', 'PVcomBank',
    'NCB', 'PGBank', 'SaigonBank', 'GPBank', 'OceanBank', 'Shinhan Bank',
  ]

  return (
    <main className="min-h-screen bg-gradient-to-b from-indigo-50 via-background to-background px-3 py-7 dark:from-indigo-950/30">
      <section className="mx-auto max-w-md overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-xl shadow-indigo-950/10 dark:border-white/10 dark:bg-slate-900">
        <div className="bg-slate-950 p-6 text-center text-white">
          <div className="mx-auto grid h-16 w-16 place-items-center overflow-hidden rounded-3xl bg-indigo-600">
            {form.photoURL ? <img src={form.photoURL} alt="" className="h-full w-full object-cover" /> : <UserRound className="h-7 w-7" />}
          </div>
          <h1 className="mt-4 text-2xl font-black">Hoàn thiện hồ sơ</h1>
          <p className="mt-1 text-sm leading-6 text-slate-300">Chỉ cần làm một lần để quản lý nhận diện đúng tài khoản của bạn.</p>
        </div>

        <form onSubmit={submit} className="space-y-4 p-5">
          {message && <p className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{message}</p>}
          {fields.map(({ key, label, placeholder, icon: Icon }) => (
            <label key={key} className="block text-sm font-bold">
              {label}
              <div className="relative mt-2">
                <Icon className="absolute left-4 top-3.5 h-5 w-5 text-muted-foreground" />
                <input value={form[key]} onChange={(event) => setValue(key, event.target.value)} className="mobile-field !pl-12" placeholder={placeholder} disabled={saving || signingOut} required />
              </div>
            </label>
          ))}
          <div className="rounded-3xl border border-indigo-100 bg-gradient-to-b from-indigo-50/80 to-white p-4 dark:border-indigo-500/20 dark:from-indigo-500/10 dark:to-slate-900">
            <div className="mb-4 flex items-center gap-2">
              <Landmark className="h-5 w-5 text-indigo-600" />
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-extrabold">Tài khoản nhận lương</h2><span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-indigo-600 shadow-sm dark:bg-slate-900">Không bắt buộc</span></div><p className="mt-1 text-xs text-muted-foreground">Chỉ cần nhập khi bạn muốn nhận lương hoặc ứng lương qua ngân hàng.</p></div>
            </div>
            <label className="block text-sm font-bold">
              Ngân hàng
              <select value={form.bankName} onChange={(event) => setValue('bankName', event.target.value)} className="mobile-field mt-2" disabled={saving || signingOut}>
                <option value="">Chọn ngân hàng</option>
                {bankOptions.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
              </select>
            </label>
            <label className="mt-4 block text-sm font-bold">
              Tên chủ tài khoản
              <div className="relative mt-2">
                <UserRound className="absolute left-4 top-3.5 h-5 w-5 text-muted-foreground" />
                <input value={form.bankAccountName} onChange={(event) => setValue('bankAccountName', event.target.value)} className="mobile-field !pl-12 uppercase" placeholder="NGUYỄN VĂN AN" disabled={saving || signingOut} />
              </div>
            </label>
            <label className="mt-4 block text-sm font-bold">
              Số tài khoản
              <div className="relative mt-2">
                <CreditCard className="absolute left-4 top-3.5 h-5 w-5 text-muted-foreground" />
                <input value={form.bankAccountNumber} onChange={(event) => setValue('bankAccountNumber', event.target.value.replace(/[^\d\s]/g, ''))} inputMode="numeric" className="mobile-field !pl-12" placeholder="Nhập số tài khoản" disabled={saving || signingOut} />
              </div>
            </label>
          </div>
          <button type="submit" disabled={saving} className="mobile-primary-button mt-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Đang lưu...' : 'Lưu và tiếp tục'}
          </button>
          <button
            type="button"
            onClick={switchAccount}
            disabled={saving || signingOut}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 font-bold text-slate-700 transition active:scale-[0.98] disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            {signingOut ? 'Đang đăng xuất...' : 'Đăng xuất / dùng tài khoản khác'}
          </button>
        </form>
      </section>
    </main>
  )
}
