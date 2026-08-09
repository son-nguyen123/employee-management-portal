import 'server-only'

function envNumber(name: string, fallback: number, min = 0): number {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback
}

export const workflowPolicy = {
  minimumWeeklyShifts: envNumber('MINIMUM_WEEKLY_SHIFTS', 6, 1),
  scheduleDeadlineHour: envNumber('SCHEDULE_DEADLINE_HOUR', 18, 0),
  scheduleLatePenalty: envNumber('PENALTY_LATE_SCHEDULE_AMOUNT', 1000),
  sameDayScheduleChangePenalty: envNumber('PENALTY_SAME_DAY_SCHEDULE_CHANGE_AMOUNT', 1_000),
  leaveNoticeDeadlineHour: envNumber('LEAVE_NOTICE_DEADLINE_HOUR', 16, 0),
  leaveOnTimeRejectedPenalty: envNumber('PENALTY_REJECTED_LEAVE_AMOUNT', 500),
  leaveLateApprovedPenalty: envNumber('PENALTY_LATE_LEAVE_APPROVED_AMOUNT', 500),
  leaveLateRejectedPenalty: envNumber('PENALTY_LATE_LEAVE_REJECTED_AMOUNT', 1_000),
  lateNoticeMinutes: 60,
  lateNoticePenalty: envNumber('PENALTY_LATE_NOTICE_AMOUNT', 500),
  lateMissingManagerMessagePenalty: envNumber('PENALTY_MISSING_MANAGER_MESSAGE_AMOUNT', 500),
  lateWrongManagerMessagePenalty: envNumber('PENALTY_WRONG_MANAGER_MESSAGE_AMOUNT', 1_000),
}
