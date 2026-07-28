import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { WorkSchedule } from '@/lib/models/types'
import { callWorkflowApi, newWorkflowRequestId } from '@/lib/services/workflowApi'

const SCHEDULES_COLLECTION = 'workSchedules'

/**
 * Create a new work schedule
 */
export async function createWorkSchedule(scheduleData: Omit<WorkSchedule, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  const result = await submitWorkSchedules([scheduleData])
  return result.ids[0]
}

export async function submitWorkSchedules(
  schedules: Array<Omit<WorkSchedule, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<{ ids: string[]; penalty: number }> {
  return callWorkflowApi('submitSchedules', {
    requestId: newWorkflowRequestId(),
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
): Promise<{ ids: string[]; penalty: number }> {
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
  reviewNote = ''
): Promise<void> {
  await callWorkflowApi('reviewScheduleBatch', {
    ids,
    status,
    note: reviewNote,
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
