import { collection, getDocs, onSnapshot, query, where, orderBy } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { SalaryAdvance } from '@/lib/models/types'
import { callWorkflowApi, newWorkflowRequestId } from '@/lib/services/workflowApi'

const SALARY_ADVANCES_COLLECTION = 'salaryAdvances'

/**
 * Create a new salary advance request
 */
export async function createSalaryAdvance(advanceData: Omit<SalaryAdvance, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  const result = await callWorkflowApi<{ id: string }>('submitSalaryAdvance', {
    requestId: newWorkflowRequestId(),
    amount: advanceData.amount,
    reason: advanceData.reason,
  })
  return result.id
}

export async function reviseSalaryAdvance(id: string, amount: number, reason: string): Promise<void> {
  await callWorkflowApi('reviseRequest', { resource: 'salary', id, amount, reason })
}

export async function cancelSalaryAdvance(id: string): Promise<void> {
  await callWorkflowApi('cancelRequest', { resource: 'salary', id })
}

/**
 * Get all salary advance requests for an employee
 */
export async function getEmployeeSalaryAdvances(employeeId: string): Promise<SalaryAdvance[]> {
  try {
    const q = query(
      collection(db, SALARY_ADVANCES_COLLECTION),
      where('employeeId', '==', employeeId),
      orderBy('createdAt', 'desc')
    )

    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as SalaryAdvance))
  } catch (error) {
    console.error('Error fetching employee salary advances:', error)
    throw error
  }
}

/**
 * Get pending salary advance requests (for managers/admins)
 */
export async function getPendingSalaryAdvances(): Promise<SalaryAdvance[]> {
  try {
    const q = query(
      collection(db, SALARY_ADVANCES_COLLECTION),
      where('status', '==', 'Pending'),
      orderBy('createdAt', 'desc')
    )

    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as SalaryAdvance))
  } catch (error) {
    console.error('Error fetching pending salary advances:', error)
    throw error
  }
}

/**
 * Update salary advance status
 */
export async function updateSalaryAdvanceStatus(
  advanceId: string,
  status: 'Approved' | 'Rejected',
  approvedBy: string,
  reviewNote = ''
): Promise<void> {
  void approvedBy
  await callWorkflowApi('reviewRequest', {
    resource: 'salary',
    id: advanceId,
    status,
    note: reviewNote,
  })
}

/**
 * Get all salary advances (admin only)
 */
export async function getAllSalaryAdvances(): Promise<SalaryAdvance[]> {
  try {
    const q = query(collection(db, SALARY_ADVANCES_COLLECTION), orderBy('createdAt', 'desc'))
    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as SalaryAdvance))
  } catch (error) {
    console.error('Error fetching all salary advances:', error)
    throw error
  }
}

function salaryFromSnapshot(item: { id: string; data: () => Record<string, unknown> }): SalaryAdvance {
  return { id: item.id, ...item.data() } as SalaryAdvance
}

export function subscribeToEmployeeSalaryAdvances(
  employeeId: string,
  callback: (requests: SalaryAdvance[]) => void,
  onError?: (error: Error) => void
): () => void {
  const salaryQuery = query(
    collection(db, SALARY_ADVANCES_COLLECTION),
    where('employeeId', '==', employeeId),
    orderBy('createdAt', 'desc')
  )
  return onSnapshot(
    salaryQuery,
    (snapshot) => callback(snapshot.docs.map(salaryFromSnapshot)),
    (error) => onError?.(error)
  )
}

export function subscribeToPendingSalaryAdvances(
  callback: (requests: SalaryAdvance[]) => void,
  onError?: (error: Error) => void
): () => void {
  const salaryQuery = query(
    collection(db, SALARY_ADVANCES_COLLECTION),
    where('status', '==', 'Pending'),
    orderBy('createdAt', 'desc')
  )
  return onSnapshot(
    salaryQuery,
    (snapshot) => callback(snapshot.docs.map(salaryFromSnapshot)),
    (error) => onError?.(error)
  )
}

export function subscribeToAllSalaryAdvances(
  callback: (requests: SalaryAdvance[]) => void,
  onError?: (error: Error) => void
): () => void {
  const salaryQuery = query(
    collection(db, SALARY_ADVANCES_COLLECTION),
    orderBy('createdAt', 'desc')
  )
  return onSnapshot(
    salaryQuery,
    (snapshot) => callback(snapshot.docs.map(salaryFromSnapshot)),
    (error) => onError?.(error)
  )
}
