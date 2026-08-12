import { vietnamWeekContaining } from '@/lib/archive/retention'

export function decisionReviewIsEditable(reviewedAt: Date | null, now = new Date()): boolean {
  if (!reviewedAt || Number.isNaN(reviewedAt.getTime())) return false
  const currentWeek = vietnamWeekContaining(now)
  return reviewedAt >= currentWeek.start && reviewedAt < currentWeek.end
}
