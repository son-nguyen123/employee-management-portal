import { callWorkflowApi } from '@/lib/services/workflowApi'

export interface WeeklyScheduleTarget {
  weekStart: string
  expectedEmployees: number
}

export function getWeeklyScheduleTarget(weekStart: string): Promise<WeeklyScheduleTarget> {
  return callWorkflowApi('getWeeklyScheduleTarget', { weekStart })
}

export function updateWeeklyScheduleTarget(
  weekStart: string,
  expectedEmployees: number,
): Promise<WeeklyScheduleTarget> {
  return callWorkflowApi('updateWeeklyScheduleTarget', { weekStart, expectedEmployees })
}

export function getManagementContact(): Promise<{ fullName: string; facebookUrl: string }> {
  return callWorkflowApi('getManagementContact', {})
}
