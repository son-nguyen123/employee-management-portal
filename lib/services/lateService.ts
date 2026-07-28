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
import { LateRequest } from '@/lib/models/types'

const LATE_REQUESTS_COLLECTION = 'lateRequests'

/**
 * Create a new late arrival request
 */
export async function createLateRequest(lateData: Omit<LateRequest, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  try {
    const late = {
      ...lateData,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }

    const docRef = await addDoc(collection(db, LATE_REQUESTS_COLLECTION), late)
    return docRef.id
  } catch (error) {
    console.error('Error creating late request:', error)
    throw error
  }
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
  approvedBy: string
): Promise<void> {
  try {
    const docRef = doc(db, LATE_REQUESTS_COLLECTION, lateId)
    await updateDoc(docRef, {
      status,
      approvedBy,
      updatedAt: Timestamp.now(),
    })
  } catch (error) {
    console.error('Error updating late request status:', error)
    throw error
  }
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
