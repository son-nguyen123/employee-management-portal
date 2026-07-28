'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, Check, Loader2, Lock, Mail, UserRound } from 'lucide-react'
import { signUp } from '@/lib/services/authService'
import { createEmployee } from '@/lib/services/employeeService'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'

export function SignupForm() {
  const router = useRouter()
  const [step, setStep] = useState<'form' | 'success'>('form')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (!name.trim()) return setError('Vui lòng nhập họ tên')
    if (!email.includes('@')) return setError('Email không hợp lệ')
    if (password.length < 6) return setError('Mật khẩu phải có ít nhất 6 ký tự')
    if (password !== confirmPassword) return setError('Mật khẩu xác nhận không khớp')
    setLoading(true)
    try {
      const authUser = await signUp(email, password, name)
      await createEmployee(authUser.uid, {
        email: authUser.email || email,
        fullName: name,
        phone: '',
        employeeCode: `NV-${Date.now()}`,
        joinDate: new Date(),
        role: 'employee',
        status: 'active',
      })
      setStep('success')
      setTimeout(() => router.push('/'), 1600)
    } catch (err: any) {
      setError(
        err?.code === 'auth/email-already-in-use'
          ? 'Email này đã được sử dụng'
          : err?.code === 'auth/weak-password'
            ? 'Mật khẩu chưa đủ mạnh'
            : 'Không thể tạo tài khoản'
      )
    } finally {
      setLoading(false)
    }
  }

  if (step === 'success') {
    return (
      <div className="grid min-h-screen place-items-center p-3">
        <Card className="w-full max-w-md rounded-[2rem]">
          <CardContent className="flex flex-col items-center py-14 text-center">
            <div className="mb-5 grid h-16 w-16 place-items-center rounded-full bg-emerald-100">
              <Check className="h-8 w-8 text-emerald-600" />
            </div>
            <h2 className="text-xl font-extrabold">Tạo tài khoản thành công!</h2>
            <p className="mt-2 text-sm text-muted-foreground">Chào mừng {name}. Đang chuyển đến trang chính...</p>
            <Badge variant="success" className="mt-5">Hoàn tất thiết lập</Badge>
          </CardContent>
        </Card>
      </div>
    )
  }

  const fields = [
    { id: 'name', label: 'Họ và tên', type: 'text', value: name, set: setName, placeholder: 'Nguyễn Văn An', icon: UserRound },
    { id: 'email', label: 'Địa chỉ email', type: 'email', value: email, set: setEmail, placeholder: 'ban@example.com', icon: Mail },
    { id: 'password', label: 'Mật khẩu', type: 'password', value: password, set: setPassword, placeholder: 'Ít nhất 6 ký tự', icon: Lock },
    { id: 'confirmPassword', label: 'Xác nhận mật khẩu', type: 'password', value: confirmPassword, set: setConfirmPassword, placeholder: 'Nhập lại mật khẩu', icon: Lock },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-background to-background px-3 pb-44 pt-8 dark:from-indigo-950/30">
      <Card className="mx-auto w-full max-w-md rounded-[2rem] border-white/80 shadow-xl shadow-indigo-950/10">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-indigo-600 text-xl font-black text-white">NS</div>
          <CardTitle className="text-2xl">Tạo tài khoản</CardTitle>
          <CardDescription>Bắt đầu sử dụng cổng nhân viên</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="flex gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </div>
            )}
            {fields.map(({ id, label, type, value, set, placeholder, icon: Icon }) => (
              <label key={id} htmlFor={id} className="block text-sm font-bold">
                {label}
                <div className="relative mt-2">
                  <Icon className="absolute left-4 top-3.5 h-5 w-5 text-muted-foreground" />
                  <input
                    id={id}
                    type={type}
                    value={value}
                    onChange={(event) => set(event.target.value)}
                    placeholder={placeholder}
                    className="mobile-field pl-12"
                    required
                    disabled={loading}
                  />
                </div>
              </label>
            ))}
            <button type="submit" disabled={loading} className="mobile-primary-button">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? 'Đang tạo tài khoản...' : 'Tạo tài khoản'}
            </button>
            <p className="text-center text-sm text-muted-foreground">
              Bạn đã có tài khoản? <Link href="/auth/login" className="font-bold text-indigo-600">Đăng nhập</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
