import {
  collection,
  addDoc,
  updateDoc,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { SalaryAdvance } from '@/lib/models/types'

const SALARY_ADVANCES_COLLECTION = 'salaryAdvances'

/**
 * Create a new salary advance request
 */
export async function createSalaryAdvance(advanceData: Omit<SalaryAdvance, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  try {
    const advance = {
      ...advanceData,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }

    const docRef = await addDoc(collection(db, SALARY_ADVANCES_COLLECTION), advance)
    return docRef.id
  } catch (error) {
    console.error('Error creating salary advance request:', error)
    throw error
  }
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
  approvedBy: string
): Promise<void> {
  try {
    const docRef = doc(db, SALARY_ADVANCES_COLLECTION, advanceId)
    await updateDoc(docRef, {
      status,
      approvedBy,
      updatedAt: Timestamp.now(),
    })
  } catch (error) {
    console.error('Error updating salary advance status:', error)
    throw error
  }
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
