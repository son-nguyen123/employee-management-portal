import 'server-only'

function envNumber(name: string, fallback: number, min = 0): number {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback
}

export const workflowPolicy = {
  scheduleDeadlineHour: envNumber('SCHEDULE_DEADLINE_HOUR', 18, 0),
  scheduleLatePenalty: envNumber('PENALTY_LATE_SCHEDULE_AMOUNT', 1_000),
  leaveNoticeHours: envNumber('LEAVE_NOTICE_HOURS', 24, 1),
  leaveLatePenalty: envNumber('PENALTY_LATE_LEAVE_AMOUNT', 0),
  lateNoticeMinutes: 60,
  lateNoticePenalty: envNumber('PENALTY_LATE_NOTICE_AMOUNT', 500),
}
