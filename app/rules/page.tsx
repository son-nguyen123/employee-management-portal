'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ChevronLeft, ChevronDown } from 'lucide-react'

export default function RulesPage() {
  const [expandedRules, setExpandedRules] = useState<{ [key: string]: boolean }>({})

  const rules = [
    {
      id: 'punctuality',
      icon: '⏰',
      title: 'Punctuality & Attendance',
      sections: [
        {
          heading: 'Work Hours',
          content:
            'Standard working hours are 9:00 AM to 6:00 PM, Monday through Friday. Shift timings may vary based on role and department assignments.',
        },
        {
          heading: 'Late Arrival',
          content:
            'Arriving more than 15 minutes late without prior notification is considered a violation. Repeat late arrivals may result in financial penalties and formal warnings.',
        },
        {
          heading: 'Absences',
          content:
            'All absences must be reported at least 24 hours in advance. Unauthorized absences will be marked as unexcused and may result in disciplinary action.',
        },
      ],
    },
    {
      id: 'conduct',
      icon: '🤝',
      title: 'Professional Conduct',
      sections: [
        {
          heading: 'Workplace Behavior',
          content:
            'All employees must maintain professional conduct at all times. Respectful communication and collaboration are essential in our workplace.',
        },
        {
          heading: 'Dress Code',
          content:
            'Business casual attire is required unless otherwise specified. Appropriate footwear and accessories are mandatory.',
        },
        {
          heading: 'Harassment Policy',
          content:
            'Zero tolerance for harassment, discrimination, or bullying of any kind. Any violations should be reported to HR immediately.',
        },
      ],
    },
    {
      id: 'communication',
      icon: '📞',
      title: 'Communication Standards',
      sections: [
        {
          heading: 'Email Etiquette',
          content:
            'Use professional language in all communications. Respond to emails within 24 hours. Do not use company email for personal matters.',
        },
        {
          heading: 'Phone Protocol',
          content:
            'Answer calls professionally using the company greeting. Keep conversations brief and productive during work hours.',
        },
        {
          heading: 'Meetings',
          content: 'Arrive on time for all scheduled meetings. Give advance notice if you cannot attend. Come prepared with necessary documents.',
        },
      ],
    },
    {
      id: 'data',
      icon: '🔒',
      title: 'Data & Confidentiality',
      sections: [
        {
          heading: 'Confidential Information',
          content:
            'Do not share company proprietary information, client data, or trade secrets with anyone outside the organization.',
        },
        {
          heading: 'Password Security',
          content:
            'Maintain strong passwords and change them regularly. Never share your password with anyone, including managers or IT staff.',
        },
        {
          heading: 'Document Security',
          content:
            'Lock your computer when stepping away. Use secure disposal methods for sensitive documents. Report any security breaches immediately.',
        },
      ],
    },
    {
      id: 'equipment',
      icon: '💻',
      title: 'Company Equipment',
      sections: [
        {
          heading: 'Equipment Responsibility',
          content:
            'You are responsible for company-provided equipment including laptops, phones, and ID cards. Report any damage or loss immediately.',
        },
        {
          heading: 'Personal Use',
          content:
            'Minimal personal use of company equipment is permitted during breaks. Do not use equipment for illegal or inappropriate activities.',
        },
        {
          heading: 'Return Policy',
          content:
            'All equipment must be returned in working condition upon resignation or transfer. Failure to do so may result in financial charges.',
        },
      ],
    },
    {
      id: 'leaves',
      icon: '🏖️',
      title: 'Leave Policies',
      sections: [
        {
          heading: 'Paid Leave',
          content:
            'Employees receive 15 days of paid annual leave. Casual leave and earned leave must be applied for minimum 3 days in advance.',
        },
        {
          heading: 'Sick Leave',
          content:
            'Sick leave must be reported within 1 hour of your scheduled start time. Medical certificates may be required for absences exceeding 2 days.',
        },
        {
          heading: 'Leave Approval',
          content:
            'All leave requests are subject to manager approval and business requirements. Emergency leaves should be discussed with your manager.',
        },
      ],
    },
  ]

  const toggleRule = (id: string) => {
    setExpandedRules((prev) => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200/50 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/" className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
            <ChevronLeft className="w-6 h-6 text-slate-700" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Company Rules</h1>
            <p className="text-xs text-slate-500">Read our policies and guidelines</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Info Banner */}
        <div className="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-2xl p-4 mb-8 border border-blue-100">
          <p className="text-sm text-slate-700">
            <span className="font-semibold">📌 Important:</span> All employees must familiarize themselves with these rules. Violations may result in disciplinary action.
          </p>
        </div>

        {/* Rules Sections */}
        <div className="space-y-3">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="rounded-2xl bg-white border border-slate-100 overflow-hidden shadow-sm hover:shadow-md transition-all duration-300"
            >
              {/* Header */}
              <button
                onClick={() => toggleRule(rule.id)}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors group"
              >
                <div className="flex items-center gap-4 text-left">
                  <span className="text-3xl flex-shrink-0">{rule.icon}</span>
                  <div>
                    <h3 className="font-bold text-slate-900 group-hover:text-purple-600 transition-colors">{rule.title}</h3>
                    <p className="text-xs text-slate-500 mt-1">{rule.sections.length} sections</p>
                  </div>
                </div>
                <ChevronDown
                  className={`w-5 h-5 text-slate-400 transition-transform duration-300 flex-shrink-0 ${
                    expandedRules[rule.id] ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {/* Content */}
              {expandedRules[rule.id] && (
                <div className="border-t border-slate-100 px-6 py-6 bg-gradient-to-br from-slate-50 to-transparent space-y-4">
                  {rule.sections.map((section, index) => (
                    <div key={index}>
                      <h4 className="font-semibold text-slate-900 mb-2">{section.heading}</h4>
                      <p className="text-sm text-slate-700 leading-relaxed">{section.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer Info */}
        <div className="mt-8 bg-white rounded-3xl p-6 sm:p-8 shadow-md border border-slate-100">
          <h2 className="font-bold text-slate-900 mb-4">Questions or Concerns?</h2>
          <p className="text-sm text-slate-700 mb-4">
            If you have any questions about these rules or need clarification, please contact our HR department.
          </p>
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-semibold">Email:</span> hr@company.com
            </p>
            <p>
              <span className="font-semibold">Phone:</span> +1 (555) 123-4567
            </p>
            <p>
              <span className="font-semibold">Office Hours:</span> Monday - Friday, 9:00 AM - 5:00 PM
            </p>
          </div>
        </div>

        {/* Acknowledgment */}
        <div className="mt-8">
          <label className="flex items-start gap-3 p-4 rounded-2xl bg-purple-50 border border-purple-100 cursor-pointer hover:bg-purple-100 transition-colors">
            <input
              type="checkbox"
              className="w-5 h-5 mt-1 rounded border-purple-300 text-purple-600 cursor-pointer"
              defaultChecked
            />
            <span className="text-sm text-slate-700">
              I have read and understood all company rules and guidelines. I agree to comply with these policies.
            </span>
          </label>
        </div>
      </div>
    </div>
  )
}
