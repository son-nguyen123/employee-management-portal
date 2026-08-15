import { collection, getDocs, onSnapshot, query, where, orderBy } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { SalaryAdvance } from '@/lib/models/types'
import { callWorkflowApi, newWorkflowRequestId } from '@/lib/services/workflowApi'
import type { FactoryId } from '@/lib/models/factory'

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

export async function reopenSalaryAdvance(id: string, note = ''): Promise<void> {
  await callWorkflowApi('reopenRequest', { resource: 'salary', id, note })
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
  onError?: (error: Error) => void,
  dateRange?: { startDate: Date; endDate: Date },
): () => void {
  const salaryQuery = dateRange
    ? query(
      collection(db, SALARY_ADVANCES_COLLECTION),
      where('employeeId', '==', employeeId),
      where('createdAt', '>=', dateRange.startDate),
      where('createdAt', '<', dateRange.endDate),
      orderBy('createdAt', 'desc'),
    )
    : query(
      collection(db, SALARY_ADVANCES_COLLECTION),
      where('employeeId', '==', employeeId),
      orderBy('createdAt', 'desc'),
    )
  return onSnapshot(
    salaryQuery,
    (snapshot) => callback(snapshot.docs.map(salaryFromSnapshot)),
    (error) => onError?.(error)
  )
}

export function subscribeToPendingSalaryAdvances(
  callback: (requests: SalaryAdvance[]) => void,
  onError?: (error: Error) => void,
  factoryId?: FactoryId
): () => void {
  const salaryQuery = factoryId
    ? query(collection(db, SALARY_ADVANCES_COLLECTION), where('factoryId', '==', factoryId))
    : query(collection(db, SALARY_ADVANCES_COLLECTION), where('status', '==', 'Pending'), orderBy('createdAt', 'desc'))
  return onSnapshot(
    salaryQuery,
    (snapshot) => callback(snapshot.docs.map(salaryFromSnapshot)
      .filter((item) => item.status === 'Pending')
      .sort((left, right) => {
        const leftDate = left.createdAt instanceof Date ? left.createdAt : left.createdAt.toDate()
        const rightDate = right.createdAt instanceof Date ? right.createdAt : right.createdAt.toDate()
        return rightDate.getTime() - leftDate.getTime()
      })),
    (error) => onError?.(error)
  )
}

export function subscribeToAllSalaryAdvances(
  callback: (requests: SalaryAdvance[]) => void,
  onError?: (error: Error) => void,
  dateRange?: { startDate: Date; endDate: Date },
  factoryId?: FactoryId,
): () => void {
  const salaryQuery = factoryId
    ? query(collection(db, SALARY_ADVANCES_COLLECTION), where('factoryId', '==', factoryId))
    : dateRange
    ? query(
      collection(db, SALARY_ADVANCES_COLLECTION),
      where('createdAt', '>=', dateRange.startDate),
      where('createdAt', '<', dateRange.endDate),
      orderBy('createdAt', 'desc'),
    )
    : query(
      collection(db, SALARY_ADVANCES_COLLECTION),
      orderBy('createdAt', 'desc'),
    )
  return onSnapshot(
    salaryQuery,
    (snapshot) => callback(snapshot.docs.map(salaryFromSnapshot)
      .filter((item) => {
        if (!dateRange) return true
        const createdAt = item.createdAt instanceof Date ? item.createdAt : item.createdAt.toDate()
        return createdAt >= dateRange.startDate && createdAt < dateRange.endDate
      })
      .sort((left, right) => {
        const leftDate = left.createdAt instanceof Date ? left.createdAt : left.createdAt.toDate()
        const rightDate = right.createdAt instanceof Date ? right.createdAt : right.createdAt.toDate()
        return rightDate.getTime() - leftDate.getTime()
      })),
    (error) => onError?.(error)
  )
}
