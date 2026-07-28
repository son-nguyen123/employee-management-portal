import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { ThemeProvider } from '@/components/providers/theme-provider'
import { SkipLoginFAB } from '@/components/demo/skip-login-fab'
import { ForegroundNotificationListener } from '@/components/notifications/foreground-notification-listener'
import { AuthProvider } from '@/lib/hooks/useAuth'
import { ProfileCompletionGuard } from '@/components/auth/profile-completion-guard'
import { PersistentBottomNav } from '@/components/layout/persistent-bottom-nav'
import './globals.css'

export const metadata: Metadata = {
  title: 'Trí Candy',
  description: 'Trí Candy — đăng ký lịch làm, gửi yêu cầu và theo dõi công việc dành cho nhân viên.',
  applicationName: 'Trí Candy',
  keywords: ['Trí Candy', 'nhân viên', 'lịch làm', 'quản lý', 'xin nghỉ', 'ứng lương'],
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      { url: '/tricandy-logo.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  viewportFit: 'cover',
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#020617' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="vi" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <AuthProvider>
            <SkipLoginFAB />
            <ForegroundNotificationListener />
            <ProfileCompletionGuard>{children}</ProfileCompletionGuard>
            <PersistentBottomNav />
            {process.env.NODE_ENV === 'production' && <Analytics />}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
