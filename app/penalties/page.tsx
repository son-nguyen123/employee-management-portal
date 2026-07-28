'use client'

import Link from 'next/link'
import { ChevronLeft, AlertCircle } from 'lucide-react'

export default function PenaltiesPage() {
  const penalties = [
    {
      id: 1,
      title: 'Probation Period',
      reason: 'Under 3 months employment',
      date: 'Ongoing',
      status: 'Active',
      emoji: '🔔',
      color: 'from-blue-50 to-cyan-50',
      borderColor: 'border-blue-100',
    },
    {
      id: 2,
      title: 'Late Arrival Penalty',
      reason: 'Arrived 25 minutes late on 2024-07-15',
      date: '2024-07-15',
      status: 'Completed',
      amount: '-$50',
      emoji: '⏰',
      color: 'from-yellow-50 to-amber-50',
      borderColor: 'border-yellow-100',
    },
    {
      id: 3,
      title: 'Attendance Warning',
      reason: 'Excessive absences in June 2024',
      date: '2024-06-30',
      status: 'Completed',
      emoji: '⚠️',
      color: 'from-orange-50 to-red-50',
      borderColor: 'border-orange-100',
    },
    {
      id: 4,
      title: 'Late Submission',
      reason: 'Project deadline missed by 2 days',
      date: '2024-05-20',
      status: 'Completed',
      amount: '-$100',
      emoji: '📋',
      color: 'from-red-50 to-rose-50',
      borderColor: 'border-red-100',
    },
  ]

  const activePenalties = penalties.filter((p) => p.status === 'Active').length
  const totalPenalties = penalties.filter((p) => p.status === 'Completed' && p.amount).length

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200/50 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/" className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
            <ChevronLeft className="w-6 h-6 text-slate-700" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Your Penalties</h1>
            <p className="text-xs text-slate-500">View your penalty history</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <div className="rounded-2xl bg-gradient-to-br from-blue-50 to-cyan-50 p-6 border border-blue-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-600 font-medium">Active Penalties</p>
                <p className="text-3xl font-bold text-slate-900 mt-1">{activePenalties}</p>
              </div>
              <AlertCircle className="w-8 h-8 text-blue-500" />
            </div>
          </div>

          <div className="rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 p-6 border border-slate-200">
            <div>
              <p className="text-xs text-slate-600 font-medium">Financial Impact</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">-$150</p>
            </div>
          </div>
        </div>

        {/* Info Banner */}
        {activePenalties > 0 && (
          <div className="bg-gradient-to-r from-yellow-50 to-amber-50 rounded-2xl p-4 mb-8 border border-yellow-100">
            <p className="text-sm text-slate-700">
              <span className="font-semibold">⚠️ Active Penalties:</span> You have {activePenalties} active penalty. Improve your attendance and punctuality to avoid further action.
            </p>
          </div>
        )}

        {/* Penalties List */}
        <div className="space-y-4">
          {penalties.map((penalty) => (
            <div
              key={penalty.id}
              className={`rounded-2xl bg-gradient-to-br ${penalty.color} p-5 border ${penalty.borderColor} hover:shadow-md transition-all duration-300`}
            >
              <div className="flex gap-4">
                {/* Icon */}
                <div className="text-3xl flex-shrink-0">{penalty.emoji}</div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-1">
                    <h3 className="font-bold text-slate-900">{penalty.title}</h3>
                    <div className="flex items-center gap-2">
                      {penalty.amount && <span className="text-sm font-bold text-red-600">{penalty.amount}</span>}
                      <span
                        className={`text-xs font-bold px-3 py-1 rounded-full ${
                          penalty.status === 'Active'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {penalty.status}
                      </span>
                    </div>
                  </div>

                  <p className="text-sm text-slate-700 mb-2">{penalty.reason}</p>
                  <p className="text-xs text-slate-600">{penalty.date}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Tips Section */}
        <div className="mt-8 bg-white rounded-3xl p-6 sm:p-8 shadow-md border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900 mb-4">How to Avoid Penalties</h2>

          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="text-2xl flex-shrink-0">⏰</div>
              <div>
                <p className="font-semibold text-slate-900">Arrive On Time</p>
                <p className="text-sm text-slate-600">Be punctual for your shifts to avoid late arrival penalties</p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="text-2xl flex-shrink-0">📅</div>
              <div>
                <p className="font-semibold text-slate-900">Maintain Attendance</p>
                <p className="text-sm text-slate-600">Attend work consistently and use proper leave request procedures</p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="text-2xl flex-shrink-0">📝</div>
              <div>
                <p className="font-semibold text-slate-900">Follow Guidelines</p>
                <p className="text-sm text-slate-600">Review company rules regularly and adhere to all policies</p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="text-2xl flex-shrink-0">💬</div>
              <div>
                <p className="font-semibold text-slate-900">Communicate</p>
                <p className="text-sm text-slate-600">Inform your manager in advance if you&apos;ll miss work or be late</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
