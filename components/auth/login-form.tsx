'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Mail, Lock, AlertCircle, Loader2 } from 'lucide-react'
import { signIn, signInWithGoogle } from '@/lib/services/authService'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'

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
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-background to-background px-3 pb-44 pt-8 dark:from-indigo-950/30">
      <Card className="mx-auto w-full max-w-md rounded-[2rem] border-white/80 shadow-xl shadow-indigo-950/10">
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
                  className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-background hover:border-border/80 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
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
                  className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-background hover:border-border/80 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                  required
                  disabled={loading}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 px-4 rounded-lg bg-primary text-primary-foreground font-medium transition-all duration-200 hover:shadow-lg hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2"
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
              className="w-full py-2 px-4 rounded-lg border border-border bg-background font-medium transition-colors hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
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

          <div className="mt-6 pt-6 border-t border-border/50">
            <p className="text-xs text-muted-foreground text-center mb-4">
              Tài khoản mẫu để kiểm tra:
            </p>
            <div className="space-y-2 text-xs">
              <div className="p-2 rounded bg-muted/50">
                <Badge variant="outline" className="mb-1">Quản lý</Badge>
                <p className="font-mono">admin@example.com</p>
                <p className="font-mono">password123</p>
              </div>
              <div className="p-2 rounded bg-muted/50">
                <Badge variant="outline" className="mb-1">Nhân viên</Badge>
                <p className="font-mono">emp@example.com</p>
                <p className="font-mono">password123</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
