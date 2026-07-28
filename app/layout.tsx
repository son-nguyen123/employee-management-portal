import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { ThemeProvider } from '@/components/providers/theme-provider'
import { SkipLoginFAB } from '@/components/demo/skip-login-fab'
import { AuthProvider } from '@/lib/hooks/useAuth'
import './globals.css'

export const metadata: Metadata = {
  title: 'Employee Portal - Premium Management System',
  description: 'Modern, premium employee management system with real-time scheduling, requests, and analytics',
  generator: 'v0.app',
  applicationName: 'Employee Portal',
  keywords: ['employee', 'management', 'scheduling', 'requests', 'hr'],
  authors: [{ name: 'Your Company' }],
  creator: 'Your Company',
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
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <AuthProvider>
            <SkipLoginFAB />
            {children}
            {process.env.NODE_ENV === 'production' && <Analytics />}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
