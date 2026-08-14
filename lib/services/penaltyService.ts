import { collection, getDocs, onSnapshot, query, where, orderBy } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Penalty } from '@/lib/models/types'
import { callWorkflowApi, newWorkflowRequestId } from '@/lib/services/workflowApi'

const PENALTIES_COLLECTION = 'penalties'

export async function createForgottenDutyPenalty(employeeId: string, date: string, note: string): Promise<{ id: string; amount: number }> {
  return callWorkflowApi('createForgottenDutyPenalty', { employeeId, date, note })
}

export async function createManualPenalty(
  employeeId: string,
  date: string,
  amount: number,
  reason: string
): Promise<{ id: string; amount: number }> {
  return callWorkflowApi('createManualPenalty', {
    requestId: newWorkflowRequestId(),
    employeeId,
    date,
    amount,
    reason,
  })
}

export async function adjustPenalty(id: string, amount: number, reason: string): Promise<void> {
  await callWorkflowApi('managePenalty', {
    requestId: newWorkflowRequestId(),
    id,
    mode: 'adjust',
    amount,
    reason,
  })
}

export async function cancelPenalty(id: string, reason: string): Promise<void> {
  await callWorkflowApi('managePenalty', {
    requestId: newWorkflowRequestId(),
    id,
    mode: 'cancel',
    reason,
  })
}

/**
 * Get all penalties for an employee
 */
export async function getEmployeePenalties(employeeId: string): Promise<Penalty[]> {
  try {
    const q = query(
      collection(db, PENALTIES_COLLECTION),
      where('employeeId', '==', employeeId),
      orderBy('penaltyDate', 'desc')
    )

    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as Penalty))
  } catch (error) {
    console.error('Error fetching employee penalties:', error)
    throw error
  }
}

/**
 * Get all penalties by category
 */
export async function getPenaltiesByCategory(category: string): Promise<Penalty[]> {
  try {
    const q = query(
      collection(db, PENALTIES_COLLECTION),
      where('category', '==', category),
      orderBy('penaltyDate', 'desc')
    )

    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as Penalty))
  } catch (error) {
    console.error('Error fetching penalties by category:', error)
    throw error
  }
}

/**
 * Get all penalties (admin only)
 */
export async function getAllPenalties(): Promise<Penalty[]> {
  try {
    const q = query(collection(db, PENALTIES_COLLECTION), orderBy('penaltyDate', 'desc'))
    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as Penalty))
  } catch (error) {
    console.error('Error fetching all penalties:', error)
    throw error
  }
}

/**
 * Get total penalty amount for an employee
 */
export async function getEmployeeTotalPenalties(employeeId: string): Promise<number> {
  try {
    const penalties = await getEmployeePenalties(employeeId)
    return penalties.reduce((total, penalty) => total + (penalty.status === 'Cancelled' ? 0 : Number(penalty.amount || 0)), 0)
  } catch (error) {
    console.error('Error calculating total penalties:', error)
    throw error
  }
}

export function subscribeToEmployeePenalties(
  employeeId: string,
  callback: (penalties: Penalty[]) => void,
  onError?: (error: Error) => void
): () => void {
  const penaltiesQuery = query(
    collection(db, PENALTIES_COLLECTION),
    where('employeeId', '==', employeeId),
    orderBy('penaltyDate', 'desc')
  )
  return onSnapshot(
    penaltiesQuery,
    (snapshot) => callback(snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    } as Penalty))),
    (error) => onError?.(error)
  )
}

export function subscribeToAllPenalties(
  callback: (penalties: Penalty[]) => void,
  onError?: (error: Error) => void
): () => void {
  const penaltiesQuery = query(
    collection(db, PENALTIES_COLLECTION),
    orderBy('penaltyDate', 'desc')
  )
  return onSnapshot(
    penaltiesQuery,
    (snapshot) => callback(snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    } as Penalty))),
    (error) => onError?.(error)
  )
}
