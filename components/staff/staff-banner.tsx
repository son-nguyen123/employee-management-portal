import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

type BannerTone = 'indigo' | 'amber' | 'emerald' | 'sky' | 'rose' | 'cyan' | 'violet'

const toneClasses: Record<BannerTone, { surface: string; icon: string; note: string; copy: string }> = {
  indigo: { surface: 'from-indigo-700 via-indigo-800 to-violet-900', icon: 'text-indigo-200', note: 'bg-white/10 text-indigo-50', copy: 'text-indigo-100' },
  amber: { surface: 'from-amber-500 via-orange-600 to-rose-700', icon: 'text-amber-100', note: 'bg-black/15 text-amber-50', copy: 'text-amber-50' },
  emerald: { surface: 'from-emerald-600 via-teal-600 to-cyan-800', icon: 'text-emerald-100', note: 'bg-black/10 text-emerald-50', copy: 'text-emerald-50' },
  sky: { surface: 'from-sky-600 via-blue-600 to-indigo-700', icon: 'text-sky-100', note: 'bg-black/10 text-sky-50', copy: 'text-sky-50' },
  rose: { surface: 'from-rose-600 via-pink-600 to-fuchsia-800', icon: 'text-rose-100', note: 'bg-black/10 text-rose-50', copy: 'text-rose-50' },
  cyan: { surface: 'from-cyan-600 via-sky-600 to-blue-800', icon: 'text-cyan-100', note: 'bg-black/10 text-cyan-50', copy: 'text-cyan-50' },
  violet: { surface: 'from-violet-700 via-purple-700 to-fuchsia-800', icon: 'text-violet-100', note: 'bg-black/10 text-violet-50', copy: 'text-violet-50' },
}

export function StaffBanner({
  icon: Icon,
  tone,
  eyebrow,
  title,
  description,
  note,
  action,
}: {
  icon: LucideIcon
  tone: BannerTone
  eyebrow: string
  title: string
  description: string
  note?: string
  action?: ReactNode
}) {
  const colors = toneClasses[tone]
  return (
    <section className={`mb-5 overflow-hidden rounded-[2rem] bg-gradient-to-br ${colors.surface} p-5 text-white shadow-xl shadow-slate-950/15`}>
      <div className="flex items-start justify-between gap-4">
        <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15 ${colors.icon}`}>
          <Icon className="h-7 w-7" />
        </div>
        {action}
      </div>
      <p className={`mt-5 text-xs font-bold uppercase tracking-[0.16em] ${colors.copy}`}>{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-black leading-tight">{title}</h2>
      <p className={`mt-2 text-sm leading-6 ${colors.copy}`}>{description}</p>
      {note && <p className={`mt-4 rounded-2xl p-3 text-xs font-semibold leading-5 ${colors.note}`}>{note}</p>}
    </section>
  )
}
