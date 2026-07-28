'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, IdCard, Link as LinkIcon, Loader2, Phone, Save, UserRound } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import { createEmployee, updateEmployee } from '@/lib/services/employeeService'
import { updateUserProfile } from '@/lib/services/authService'

export default function ProfileSetupPage() {
  const router = useRouter()
  const { authUser, employee, isLoading, refreshEmployee } = useAuth()
  const [form, setForm] = useState({
    fullName: '',
    employeeCode: '',
    phone: '',
    photoURL: '',
    facebookUrl: '',
  })
  const [saving, setSaving] = useState(false)
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
    if (Object.values(values).some((value) => !value)) {
      setMessage('Vui lòng hoàn thiện đủ 5 thông tin trước khi tiếp tục.')
      return
    }
    if (!/^https?:\/\//i.test(values.photoURL) || !/^https?:\/\//i.test(values.facebookUrl)) {
      setMessage('Link ảnh đại diện và Facebook phải bắt đầu bằng http:// hoặc https://.')
      return
    }
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
                <input value={form[key]} onChange={(event) => setValue(key, event.target.value)} className="mobile-field pl-12" placeholder={placeholder} disabled={saving} required />
              </div>
            </label>
          ))}
          <button type="submit" disabled={saving} className="mobile-primary-button mt-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Đang lưu...' : 'Lưu và tiếp tục'}
          </button>
        </form>
      </section>
    </main>
  )
}
