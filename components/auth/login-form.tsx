'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Mail, Lock, AlertCircle, Loader2 } from 'lucide-react'
import { signIn, signInWithGoogle } from '@/lib/services/authService'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { AuthShell } from '@/components/auth/auth-shell'

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await signIn(email, password)
      router.push('/')
    } catch (err: any) {
      const errorMessage =
        err?.code === 'auth/user-not-found'
          ? 'Không tìm thấy tài khoản'
          : err?.code === 'auth/wrong-password'
            ? 'Mật khẩu không chính xác'
            : 'Không thể đăng nhập'
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setError('')
    setLoading(true)

    try {
      await signInWithGoogle()
      router.push('/')
    } catch (err: any) {
      setError(
        err?.code === 'auth/popup-closed-by-user'
          ? 'Bạn đã hủy đăng nhập Google'
          : 'Không thể đăng nhập bằng Google'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell eyebrow="Đăng nhập an toàn">
      <Card className="w-full rounded-[2rem] border-0 bg-white shadow-xl shadow-slate-900/10 sm:border sm:border-slate-200 dark:bg-slate-900">
        <CardHeader className="space-y-2 text-center">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
              <span className="text-xl font-bold text-primary-foreground">NS</span>
            </div>
          </div>
          <CardTitle className="text-2xl">Chào mừng trở lại</CardTitle>
          <CardDescription>
            Đăng nhập để tiếp tục quản lý công việc
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="flex items-gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <AlertCircle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Địa chỉ email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 w-5 h-5 text-muted-foreground" />
                <input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mobile-field !pl-12"
                  required
                  disabled={loading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                Mật khẩu
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 w-5 h-5 text-muted-foreground" />
                <input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mobile-field !pl-12"
                  required
                  disabled={loading}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mobile-primary-button"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
            </button>

            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Hoặc</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white font-bold transition active:scale-[.98] disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
            >
              Tiếp tục bằng Google
            </button>

            <div className="text-center text-sm">
              <span className="text-muted-foreground">Bạn chưa có tài khoản? </span>
              <Link
                href="/auth/signup"
                className="text-primary font-medium hover:underline"
              >
                Đăng ký
              </Link>
            </div>
          </form>

        </CardContent>
      </Card>
    </AuthShell>
  )
}
