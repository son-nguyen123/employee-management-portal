import { collection, getDocs, onSnapshot, query, where, orderBy } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Penalty, WorkSchedule } from '@/lib/models/types'
import type { FactoryId } from '@/lib/models/factory'
import { callWorkflowApi, newWorkflowRequestId } from '@/lib/services/workflowApi'

const SCHEDULES_COLLECTION = 'workSchedules'

export interface DutyAvailability {
  capacity: number
  counts: Record<string, number>
}

/**
 * Returns only the number of people registered for each duty team. Employee
 * names stay on the server; managers see the detailed roster in their view.
 */
export function getDutyAvailability(startDate: string, endDate: string): Promise<DutyAvailability> {
  return callWorkflowApi('getDutyAvailability', { startDate, endDate })
}

export function ensureFixedSchedule(weekStart: string, employeeId?: string): Promise<{ created: boolean; ids: string[]; needsSetup: boolean }> {
  return callWorkflowApi('ensureFixedSchedule', { weekStart, ...(employeeId ? { employeeId } : {}) })
}

/**
 * Create a new work schedule
 */
export async function createWorkSchedule(scheduleData: Omit<WorkSchedule, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  const result = await submitWorkSchedules([scheduleData])
  return result.ids[0]
}

export async function submitWorkSchedules(
  schedules: Array<Omit<WorkSchedule, 'id' | 'createdAt' | 'updatedAt'>>,
  confirmUnderMinimum = false
): Promise<{ ids: string[]; penalty: number; editDeadlineAt: string }> {
  return callWorkflowApi('submitSchedules', {
    requestId: newWorkflowRequestId(),
    confirmUnderMinimum,
    schedules: schedules.map((schedule) => ({
      date: schedule.date instanceof Date
        ? schedule.date.toISOString()
        : schedule.date.toDate().toISOString(),
      shift: schedule.shift,
      note: schedule.note,
    })),
  })
}

export async function replaceWorkSchedules(
  scheduleIds: string[],
  schedules: Array<Omit<WorkSchedule, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<{ ids: string[]; penalty: number; editDeadlineAt: string }> {
  return callWorkflowApi('replaceSchedules', {
    requestId: newWorkflowRequestId(),
    scheduleIds,
    schedules: schedules.map((schedule) => ({
      date: schedule.date instanceof Date
        ? schedule.date.toISOString()
        : schedule.date.toDate().toISOString(),
      shift: schedule.shift,
      note: schedule.note,
    })),
  })
}

export async function cancelWorkScheduleBatch(ids: string[]): Promise<void> {
  await callWorkflowApi('cancelScheduleBatch', { ids })
}

export async function setWorkScheduleBatchEditing(ids: string[], editing: boolean): Promise<{ status: string }> {
  return callWorkflowApi('setScheduleBatchEditing', { ids, editing })
}

export async function adminCancelWorkSchedules(ids: string[], reason: string): Promise<{ ids: string[] }> {
  return callWorkflowApi('adminCancelSchedules', {
    requestId: newWorkflowRequestId(),
    ids,
    reason,
  })
}

export async function restoreAdminCancelledWorkSchedules(ids: string[]): Promise<{ ids: string[]; status: string }> {
  return callWorkflowApi('restoreAdminCancelledSchedules', {
    requestId: newWorkflowRequestId(),
    ids,
  })
}

/**
 * Get all schedules for an employee
 */
export async function getEmployeeSchedules(employeeId: string): Promise<WorkSchedule[]> {
  try {
    const q = query(
      collection(db, SCHEDULES_COLLECTION),
      where('employeeId', '==', employeeId),
      orderBy('date', 'desc')
    )

    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as WorkSchedule))
  } catch (error) {
    console.error('Error fetching employee schedules:', error)
    throw error
  }
}

/**
 * Get schedules by date range
 */
export async function getSchedulesByDateRange(
  employeeId: string,
  startDate: Date,
  endDate: Date
): Promise<WorkSchedule[]> {
  try {
    const q = query(
      collection(db, SCHEDULES_COLLECTION),
      where('employeeId', '==', employeeId),
      where('date', '>=', startDate),
      where('date', '<=', endDate),
      orderBy('date', 'asc')
    )

    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as WorkSchedule))
  } catch (error) {
    console.error('Error fetching schedules by date range:', error)
    throw error
  }
}

/**
 * Update work schedule
 */
export async function updateWorkSchedule(scheduleId: string, updates: Partial<Omit<WorkSchedule, 'id' | 'createdAt'>>): Promise<void> {
  if (!updates.status || !['Approved', 'Rejected', 'ChangesRequested'].includes(updates.status)) {
    throw new Error('Cập nhật lịch phải đi qua backend nghiệp vụ.')
  }
  await reviewWorkSchedule(
    scheduleId,
    updates.status as 'Approved' | 'Rejected' | 'ChangesRequested',
    updates.reviewNote || ''
  )
}

export async function reviewWorkSchedule(
  scheduleId: string,
  status: 'Approved' | 'Rejected' | 'ChangesRequested',
  reviewNote = ''
): Promise<void> {
  await callWorkflowApi('reviewRequest', {
    resource: 'schedule',
    id: scheduleId,
    status,
    note: reviewNote,
  })
}

export async function reviewWorkScheduleBatch(
  ids: string[],
  status: 'Approved' | 'Rejected',
  reviewNote = '',
  allowSundayResubmissionWithoutPenalty = false,
  waiveNewEmployeePenalty = false
): Promise<void> {
  await callWorkflowApi('reviewScheduleBatch', {
    ids,
    status,
    note: reviewNote,
    allowSundayResubmissionWithoutPenalty,
    waiveNewEmployeePenalty,
  })
}

/**
 * Get all schedules (admin only)
 */
export async function getAllSchedules(): Promise<WorkSchedule[]> {
  try {
    const q = query(collection(db, SCHEDULES_COLLECTION), orderBy('date', 'desc'))
    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as WorkSchedule))
  } catch (error) {
    console.error('Error fetching all schedules:', error)
    throw error
  }
}

function scheduleFromSnapshot(item: { id: string; data: () => Record<string, unknown> }): WorkSchedule {
  return { id: item.id, ...item.data() } as WorkSchedule
}

function valueAsDate(value: unknown): Date {
  if (value instanceof Date) return value
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate()
  return new Date(0)
}

function weekBounds(value: unknown) {
  const start = valueAsDate(value)
  const day = start.getDay() || 7
  start.setDate(start.getDate() - day + 1)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return { start, end }
}

/**
 * Older schedule rows may not contain the penalty link because the penalty
 * was recorded in a separate transaction. Merge the matching active weekly
 * schedule-submission penalty so every admin schedule view shows the same
 * source of truth.
 */
function attachSchedulePenalties(schedules: WorkSchedule[], penalties: Penalty[]): WorkSchedule[] {
  return schedules.map((schedule) => {
    if (Number(schedule.penaltyAmount || 0) > 0) return schedule
    const { start, end } = weekBounds(schedule.date)
    const match = penalties.find((penalty) => {
      if (penalty.status === 'Cancelled' || penalty.sourceType !== 'scheduleSubmission') return false
      if (String(penalty.employeeId) !== String(schedule.employeeId)) return false
      if (schedule.penaltyId && penalty.id === schedule.penaltyId) return Number(penalty.amount || 0) > 0
      const penaltyDate = valueAsDate(penalty.penaltyDate)
      return penaltyDate >= start && penaltyDate < end && Number(penalty.amount || 0) > 0
    })
    return match
      ? { ...schedule, penaltyId: match.id || null, penaltyAmount: Number(match.amount || 0) }
      : schedule
  })
}

export function subscribeToAllSchedules(
  callback: (schedules: WorkSchedule[]) => void,
  onError?: (error: Error) => void,
  factoryId?: FactoryId
): () => void {
  const schedulesQuery = factoryId
    ? query(collection(db, SCHEDULES_COLLECTION), where('factoryId', '==', factoryId), orderBy('date', 'desc'))
    : query(collection(db, SCHEDULES_COLLECTION), orderBy('date', 'desc'))
  const penaltiesQuery = query(collection(db, 'penalties'), orderBy('penaltyDate', 'desc'))
  let scheduleRows: WorkSchedule[] = []
  let penaltyRows: Penalty[] = []
  let schedulesReady = false
  let penaltiesReady = false
  const publish = () => {
    if (schedulesReady) callback(attachSchedulePenalties(scheduleRows, penaltiesReady ? penaltyRows : []))
  }
  const unsubscribeSchedules = onSnapshot(
    schedulesQuery,
    (snapshot) => {
      scheduleRows = snapshot.docs.map(scheduleFromSnapshot)
      schedulesReady = true
      publish()
    },
    (error) => onError?.(error)
  )
  const unsubscribePenalties = onSnapshot(
    penaltiesQuery,
    (snapshot) => {
      penaltyRows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Penalty))
      penaltiesReady = true
      publish()
    },
    (error) => {
      // Schedule data remains usable if a legacy project has not granted the
      // optional penalty read yet; the schedule listener still publishes rows.
      penaltiesReady = true
      publish()
      onError?.(error)
    }
  )
  return () => {
    unsubscribeSchedules()
    unsubscribePenalties()
  }
}

export function subscribeToEmployeeSchedules(
  employeeId: string,
  callback: (schedules: WorkSchedule[]) => void,
  onError?: (error: Error) => void
): () => void {
  const schedulesQuery = query(
    collection(db, SCHEDULES_COLLECTION),
    where('employeeId', '==', employeeId),
    orderBy('date', 'desc')
  )
  return onSnapshot(
    schedulesQuery,
    (snapshot) => callback(snapshot.docs.map(scheduleFromSnapshot)),
    (error) => onError?.(error)
  )
}

export function subscribeToSchedulesByDateRange(
  employeeId: string,
  startDate: Date,
  endDate: Date,
  callback: (schedules: WorkSchedule[]) => void,
  onError?: (error: Error) => void
): () => void {
  const schedulesQuery = query(
    collection(db, SCHEDULES_COLLECTION),
    where('employeeId', '==', employeeId),
    where('date', '>=', startDate),
    where('date', '<=', endDate),
    orderBy('date', 'asc')
  )
  return onSnapshot(
    schedulesQuery,
    (snapshot) => callback(snapshot.docs.map(scheduleFromSnapshot)),
    (error) => onError?.(error)
  )
}
