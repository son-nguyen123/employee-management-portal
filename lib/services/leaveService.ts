import { collection, getDocs, onSnapshot, query, where, orderBy } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { LeaveRequest } from '@/lib/models/types'
import { callWorkflowApi, newWorkflowRequestId } from '@/lib/services/workflowApi'

const LEAVES_COLLECTION = 'leaveRequests'

/**
 * Create a new leave request
 */
export async function createLeaveRequest(leaveData: Omit<LeaveRequest, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  const result = await callWorkflowApi<{ id: string; penalty: number }>('submitLeave', {
    requestId: newWorkflowRequestId(),
    leaveDate: leaveData.leaveDate instanceof Date
      ? leaveData.leaveDate.toISOString()
      : leaveData.leaveDate.toDate().toISOString(),
    endDate: leaveData.endDate instanceof Date
      ? leaveData.endDate.toISOString()
      : leaveData.endDate?.toDate().toISOString(),
    duration: leaveData.duration,
    leaveType: leaveData.leaveType,
    reason: leaveData.reason,
    workScheduleId: leaveData.workScheduleId,
    workScheduleIds: leaveData.workScheduleIds,
  })
  return result.id
}

export async function reviseLeaveRequest(id: string, leaveData: Pick<LeaveRequest, 'leaveDate' | 'endDate' | 'duration' | 'reason' | 'workScheduleId' | 'workScheduleIds'>): Promise<void> {
  await callWorkflowApi('reviseRequest', {
    resource: 'leave',
    id,
    leaveDate: leaveData.leaveDate instanceof Date ? leaveData.leaveDate.toISOString() : leaveData.leaveDate.toDate().toISOString(),
    endDate: leaveData.endDate instanceof Date ? leaveData.endDate.toISOString() : leaveData.endDate?.toDate().toISOString(),
    duration: leaveData.duration,
    reason: leaveData.reason,
    workScheduleId: leaveData.workScheduleId,
    workScheduleIds: leaveData.workScheduleIds,
  })
}

export async function cancelLeaveRequest(id: string): Promise<void> {
  await callWorkflowApi('cancelRequest', { resource: 'leave', id })
}

/**
 * Get all leave requests for an employee
 */
export async function getEmployeeLeaves(employeeId: string): Promise<LeaveRequest[]> {
  try {
    const q = query(
      collection(db, LEAVES_COLLECTION),
      where('employeeId', '==', employeeId),
      orderBy('leaveDate', 'desc')
    )

    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as LeaveRequest))
  } catch (error) {
    console.error('Error fetching employee leave requests:', error)
    throw error
  }
}

/**
 * Get pending leave requests (for managers/admins)
 */
export async function getPendingLeaveRequests(): Promise<LeaveRequest[]> {
  try {
    const q = query(
      collection(db, LEAVES_COLLECTION),
      where('status', '==', 'Pending'),
      orderBy('createdAt', 'desc')
    )

    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as LeaveRequest))
  } catch (error) {
    console.error('Error fetching pending leave requests:', error)
    throw error
  }
}

/**
 * Update leave request status
 */
export async function updateLeaveStatus(
  leaveId: string,
  status: 'Approved' | 'Rejected',
  approvedBy: string,
  reviewNote = ''
): Promise<void> {
  void approvedBy
  await callWorkflowApi('reviewRequest', {
    resource: 'leave',
    id: leaveId,
    status,
    note: reviewNote,
  })
}

/**
 * Get all leave requests (admin only)
 */
export async function getAllLeaveRequests(): Promise<LeaveRequest[]> {
  try {
    const q = query(collection(db, LEAVES_COLLECTION), orderBy('createdAt', 'desc'))
    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as LeaveRequest))
  } catch (error) {
    console.error('Error fetching all leave requests:', error)
    throw error
  }
}

function leaveFromSnapshot(item: { id: string; data: () => Record<string, unknown> }): LeaveRequest {
  return { id: item.id, ...item.data() } as LeaveRequest
}

export function subscribeToEmployeeLeaves(
  employeeId: string,
  callback: (requests: LeaveRequest[]) => void,
  onError?: (error: Error) => void
): () => void {
  const leavesQuery = query(
    collection(db, LEAVES_COLLECTION),
    where('employeeId', '==', employeeId),
    orderBy('leaveDate', 'desc')
  )
  return onSnapshot(
    leavesQuery,
    (snapshot) => callback(snapshot.docs.map(leaveFromSnapshot)),
    (error) => onError?.(error)
  )
}

export function subscribeToPendingLeaveRequests(
  callback: (requests: LeaveRequest[]) => void,
  onError?: (error: Error) => void
): () => void {
  const leavesQuery = query(
    collection(db, LEAVES_COLLECTION),
    where('status', '==', 'Pending'),
    orderBy('createdAt', 'desc')
  )
  return onSnapshot(
    leavesQuery,
    (snapshot) => callback(snapshot.docs.map(leaveFromSnapshot)),
    (error) => onError?.(error)
  )
}
