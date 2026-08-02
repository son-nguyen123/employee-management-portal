import { collection, getDocs, onSnapshot, query, where, orderBy } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { LateRequest } from '@/lib/models/types'
import { callWorkflowApi, newWorkflowRequestId } from '@/lib/services/workflowApi'

const LATE_REQUESTS_COLLECTION = 'lateRequests'

/**
 * Create a new late arrival request
 */
export async function createLateRequest(
  lateData: Omit<LateRequest, 'id' | 'createdAt' | 'updatedAt'> & { expectedArrival: string }
): Promise<string> {
  const result = await callWorkflowApi<{ id: string; penalty: number }>('submitLate', {
    requestId: newWorkflowRequestId(),
    workScheduleId: lateData.workScheduleId,
    workScheduleIds: lateData.workScheduleIds,
    expectedArrival: lateData.expectedArrival,
    reason: lateData.reason,
    managerMessageStatus: lateData.managerMessageStatus,
  })
  return result.id
}

export async function reviseLateRequest(id: string, data: Pick<LateRequest, 'workScheduleId' | 'workScheduleIds' | 'expectedArrival' | 'reason'>): Promise<void> {
  await callWorkflowApi('reviseRequest', {
    resource: 'late',
    id,
    workScheduleId: data.workScheduleId,
    workScheduleIds: data.workScheduleIds,
    expectedArrival: data.expectedArrival,
    reason: data.reason,
  })
}

export async function cancelLateRequest(id: string): Promise<void> {
  await callWorkflowApi('cancelRequest', { resource: 'late', id })
}

/**
 * Get all late requests for an employee
 */
export async function getEmployeeLateRequests(employeeId: string): Promise<LateRequest[]> {
  try {
    const q = query(
      collection(db, LATE_REQUESTS_COLLECTION),
      where('employeeId', '==', employeeId),
      orderBy('date', 'desc')
    )

    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as LateRequest))
  } catch (error) {
    console.error('Error fetching employee late requests:', error)
    throw error
  }
}

/**
 * Get pending late requests (for managers/admins)
 */
export async function getPendingLateRequests(): Promise<LateRequest[]> {
  try {
    const q = query(
      collection(db, LATE_REQUESTS_COLLECTION),
      where('status', '==', 'Pending'),
      orderBy('createdAt', 'desc')
    )

    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as LateRequest))
  } catch (error) {
    console.error('Error fetching pending late requests:', error)
    throw error
  }
}

/**
 * Update late request status
 */
export async function updateLateStatus(
  lateId: string,
  status: 'Approved' | 'Rejected',
  approvedBy: string,
  reviewNote = '',
  penaltyAmount?: number
): Promise<void> {
  void approvedBy
  await callWorkflowApi('reviewRequest', {
    resource: 'late',
    id: lateId,
    status,
    note: reviewNote,
    penaltyAmount,
  })
}

/**
 * Get all late requests (admin only)
 */
export async function getAllLateRequests(): Promise<LateRequest[]> {
  try {
    const q = query(collection(db, LATE_REQUESTS_COLLECTION), orderBy('createdAt', 'desc'))
    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as LateRequest))
  } catch (error) {
    console.error('Error fetching all late requests:', error)
    throw error
  }
}

function lateFromSnapshot(item: { id: string; data: () => Record<string, unknown> }): LateRequest {
  return { id: item.id, ...item.data() } as LateRequest
}

export function subscribeToEmployeeLateRequests(
  employeeId: string,
  callback: (requests: LateRequest[]) => void,
  onError?: (error: Error) => void
): () => void {
  const lateQuery = query(
    collection(db, LATE_REQUESTS_COLLECTION),
    where('employeeId', '==', employeeId),
    orderBy('date', 'desc')
  )
  return onSnapshot(
    lateQuery,
    (snapshot) => callback(snapshot.docs.map(lateFromSnapshot)),
    (error) => onError?.(error)
  )
}

export function subscribeToPendingLateRequests(
  callback: (requests: LateRequest[]) => void,
  onError?: (error: Error) => void
): () => void {
  const lateQuery = query(
    collection(db, LATE_REQUESTS_COLLECTION),
    where('status', '==', 'Pending'),
    orderBy('createdAt', 'desc')
  )
  return onSnapshot(
    lateQuery,
    (snapshot) => callback(snapshot.docs.map(lateFromSnapshot)),
    (error) => onError?.(error)
  )
}
