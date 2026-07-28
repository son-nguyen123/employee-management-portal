import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Penalty } from '@/lib/models/types'
import { callWorkflowApi } from '@/lib/services/workflowApi'

const PENALTIES_COLLECTION = 'penalties'

export async function createForgottenDutyPenalty(employeeId: string, date: string, note: string): Promise<{ id: string; amount: number }> {
  return callWorkflowApi('createForgottenDutyPenalty', { employeeId, date, note })
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
    return penalties.reduce((total, penalty) => total + penalty.amount, 0)
  } catch (error) {
    console.error('Error calculating total penalties:', error)
    throw error
  }
}
