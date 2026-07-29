'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { AlertCircle, Loader2, Lock, Mail } from 'lucide-react'
import { signInWithGoogle, signUp } from '@/lib/services/authService'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { AuthShell } from '@/components/auth/auth-shell'
import { useAuth } from '@/lib/hooks/useAuth'

export function SignupForm() {
  const router = useRouter()
  const { authUser } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loadingAction, setLoadingAction] = useState<'password' | 'google' | null>(null)
  const loading = loadingAction !== null

  useEffect(() => {
    if (authUser) router.replace('/profile/setup')
  }, [authUser, router])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (!email.includes('@')) return setError('Email không hợp lệ')
    if (password.length < 6) return setError('Mật khẩu phải có ít nhất 6 ký tự')
    setLoadingAction('password')
    try {
      await signUp(email, password)
      router.push('/profile/setup')
    } catch (err: any) {
      setError(
        err?.code === 'auth/email-already-in-use'
          ? 'Email này đã được sử dụng'
          : err?.code === 'auth/weak-password'
            ? 'Mật khẩu chưa đủ mạnh'
            : err?.code === 'auth/operation-not-allowed'
              ? 'Đăng ký email chưa được bật trong Firebase Authentication.'
              : err?.code === 'auth/network-request-failed'
                ? 'Mạng không ổn định. Vui lòng kiểm tra kết nối rồi thử lại.'
                : 'Không thể tạo tài khoản. Vui lòng thử lại.'
      )
    } finally {
      setLoadingAction(null)
    }
  }

  const fields = [
    { id: 'email', label: 'Địa chỉ email', type: 'email', value: email, set: setEmail, placeholder: 'ban@example.com', icon: Mail },
    { id: 'password', label: 'Mật khẩu', type: 'password', value: password, set: setPassword, placeholder: 'Ít nhất 6 ký tự', icon: Lock },
  ]

  const handleGoogle = async () => {
    setError('')
    setLoadingAction('google')
    try {
      await signInWithGoogle()
      router.push('/profile/setup')
    } catch (err: any) {
      setError(
        err?.code === 'auth/popup-closed-by-user'
          ? 'Bạn đã đóng cửa sổ đăng nhập Google.'
          : err?.code === 'auth/sign-in-incomplete'
            ? 'Đăng nhập Google chưa hoàn tất. Vui lòng thử lại.'
            : err?.code === 'auth/popup-blocked'
              ? 'Trình duyệt đang chặn cửa sổ Google. Vui lòng cho phép cửa sổ bật lên rồi thử lại.'
              : err?.code === 'auth/unauthorized-domain'
                ? 'Tên miền hiện tại chưa được cho phép đăng nhập Google.'
                : err?.code === 'auth/operation-not-allowed'
                  ? 'Đăng nhập Google chưa được bật trong Firebase Authentication.'
                  : err?.code === 'auth/network-request-failed'
                    ? 'Mạng không ổn định. Vui lòng kiểm tra kết nối rồi thử lại.'
                    : 'Không thể đăng ký bằng Google.'
      )
    } finally {
      setLoadingAction(null)
    }
  }

  return (
    <AuthShell eyebrow="Tạo tài khoản mới">
      <Card className="w-full rounded-[2rem] border-0 bg-white shadow-xl shadow-slate-900/10 sm:border sm:border-slate-200 dark:bg-slate-900">
        <CardHeader className="text-center">
          <Image src="/tricandy-logo.png" alt="Logo Trí Candy" width={56} height={56} className="mx-auto mb-3 h-14 w-14 rounded-2xl object-cover shadow-md" priority />
          <p className="text-xs font-black uppercase tracking-[.18em] text-pink-500">Trí Candy</p>
          <CardTitle className="text-2xl">Tạo tài khoản</CardTitle>
          <CardDescription>Bắt đầu sử dụng cổng nhân viên Trí Candy</CardDescription>
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
                    className="mobile-field !pl-12"
                    required
                    disabled={loading}
                  />
                </div>
              </label>
            ))}
            <button type="submit" disabled={loading} className="mobile-primary-button">
              {loadingAction === 'password' && <Loader2 className="h-4 w-4 animate-spin" />}
              {loadingAction === 'password' ? 'Đang tạo tài khoản...' : 'Tạo tài khoản'}
            </button>
            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">Hoặc</span></div>
            </div>
            <button type="button" onClick={handleGoogle} disabled={loading} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50/70 px-4 font-bold text-indigo-700 transition active:scale-[0.98] disabled:opacity-50 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200">
              {loadingAction === 'google' && <Loader2 className="h-4 w-4 animate-spin" />}
              {loadingAction === 'google' ? 'Đang mở Google...' : 'Đăng ký Trí Candy bằng Google'}
            </button>
            <p className="text-center text-sm text-muted-foreground">
              Bạn đã có tài khoản? <Link href="/auth/login" className="font-bold text-indigo-600">Đăng nhập</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </AuthShell>
  )
}
