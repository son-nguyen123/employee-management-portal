'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth, useUserRole } from '@/lib/hooks/useAuth'
import { getUnreadNotificationCount } from '@/lib/services/notificationService'
import { mockNotifications } from '@/lib/services/mockData'
import {
  Calendar, Clock, DollarSign, AlertCircle, FileText, BookOpen,
  Bell, User, LogOut, Sun, Moon
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BottomNav } from '@/components/layout/bottom-nav'
import { SkeletonLoader } from '@/components/ui/skeleton-loader'

export default function Page() {
  const router = useRouter()
  const { authUser, isLoading, isPreviewMode, logout } = useAuth()
  const userRole = useUserRole()
  const { theme, setTheme } = useTheme()
  const [notificationCount, setNotificationCount] = useState(0)
  const [dataLoading, setDataLoading] = useState(true)

  // Redirect if not authenticated
  useEffect(() => {
    if (!isLoading && !authUser) {
      router.push('/auth/login')
    }
  }, [authUser, isLoading, router])

  // Load notification count
  useEffect(() => {
    if (!authUser) return

    const loadNotifications = async () => {
      try {
        if (isPreviewMode) {
          // Use mock data in demo mode
          const unreadCount = mockNotifications.filter(n => !n.isRead).length
          setNotificationCount(unreadCount)
        } else {
          const count = await getUnreadNotificationCount(authUser.uid)
          setNotificationCount(count)
        }
      } catch (error) {
        console.error('Error loading notifications:', error)
      } finally {
        setDataLoading(false)
      }
    }

    loadNotifications()
  }, [authUser, isPreviewMode])

  if (isLoading || dataLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <SkeletonLoader variant="card" count={6} />
      </div>
    )
  }

  if (!authUser) return null
  const features = [
    {
      id: 'schedule',
      title: 'Work Schedule',
      description: 'View and manage your work shifts',
      icon: Calendar,
      href: '/schedule',
      color: 'from-purple-500 to-purple-600',
    },
    {
      id: 'rules',
      title: 'Company Rules',
      description: 'Read our company guidelines',
      icon: BookOpen,
      href: '/rules',
      color: 'from-blue-500 to-blue-600',
    },
    {
      id: 'penalties',
      title: 'Penalties',
      description: 'Check your penalty history',
      icon: AlertCircle,
      href: '/penalties',
      color: 'from-red-500 to-red-600',
    },
    {
      id: 'leave',
      title: 'Leave Request',
      description: 'Submit a leave request',
      icon: FileText,
      href: '/leave-request',
      color: 'from-green-500 to-green-600',
    },
    {
      id: 'salary',
      title: 'Salary Advance',
      description: 'Request a salary advance',
      icon: DollarSign,
      href: '/salary-advance',
      color: 'from-pink-500 to-pink-600',
    },
    {
      id: 'late',
      title: 'Late Arrival Request',
      description: 'Request to arrive late',
      icon: Clock,
      href: '/late-arrival',
      color: 'from-cyan-500 to-cyan-600',
    },
  ]

  const bottomNavItems = [
    { href: '/', icon: '🏠', label: 'Home' },
    { href: '/notifications', icon: '🔔', label: 'Notifications', badge: notificationCount || undefined },
    { href: '/profile', icon: '👤', label: 'Profile' },
  ]

  if (userRole === 'admin') {
    bottomNavItems.push({ href: '/admin/dashboard', icon: '⚙️', label: 'Admin' })
  }

  return (
    <main className="min-h-screen bg-background pb-24 md:pb-0">
      {/* Sticky Header */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border/40 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Welcome back!</h1>
              <p className="text-sm text-muted-foreground">{authUser.displayName || authUser.email}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="p-2 hover:bg-muted rounded-lg transition-colors"
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? (
                  <Sun className="w-5 h-5" />
                ) : (
                  <Moon className="w-5 h-5" />
                )}
              </button>
              <button
                onClick={async () => {
                  await logout()
                  router.push('/auth/login')
                }}
                className="p-2 hover:bg-muted rounded-lg transition-colors text-destructive"
                aria-label="Sign out"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-2xl mx-auto px-4 py-6 md:py-8">
        {/* Features Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
          {features.map((feature) => {
            const Icon = feature.icon
            return (
              <Link key={feature.id} href={feature.href}>
                <Card
                  interactive
                  variant="elevated"
                  className="h-full p-6 relative overflow-hidden group"
                >
                  {/* Background gradient accent */}
                  <div
                    className={`absolute -right-8 -top-8 h-32 w-32 bg-gradient-to-br ${feature.color} opacity-10 rounded-full blur-2xl group-hover:opacity-20 transition-opacity duration-300`}
                  />

                  {/* Icon background */}
                  <div className={`inline-flex p-3 rounded-2xl bg-gradient-to-br ${feature.color} mb-4 shadow-lg`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>

                  {/* Content */}
                  <h3 className="text-lg font-bold mb-1">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground mb-4">{feature.description}</p>

                  {/* Arrow indicator */}
                  <div className="flex items-center text-primary font-medium text-sm group-hover:translate-x-1 transition-transform duration-300">
                    <span>Explore</span>
                    <svg
                      className="w-4 h-4 ml-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
          <Card className="p-6">
            <p className="text-sm text-muted-foreground mb-1">Total Pending</p>
            <p className="text-3xl font-bold">0</p>
            <Badge variant="success" size="sm" className="mt-2">No pending requests</Badge>
          </Card>
          <Card className="p-6">
            <p className="text-sm text-muted-foreground mb-1">Unread Notifications</p>
            <p className="text-3xl font-bold">{notificationCount}</p>
            <Badge variant="outline" size="sm" className="mt-2">View all</Badge>
          </Card>
        </div>
      </div>

      {/* Bottom Navigation */}
      <BottomNav items={bottomNavItems} />
    </main>
  )
}
