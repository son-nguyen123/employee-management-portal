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
import { LeaveRequest } from '@/lib/models/types'

const LEAVES_COLLECTION = 'leaveRequests'

/**
 * Create a new leave request
 */
export async function createLeaveRequest(leaveData: Omit<LeaveRequest, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  try {
    const leave = {
      ...leaveData,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }

    const docRef = await addDoc(collection(db, LEAVES_COLLECTION), leave)
    return docRef.id
  } catch (error) {
    console.error('Error creating leave request:', error)
    throw error
  }
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
  approvedBy: string
): Promise<void> {
  try {
    const docRef = doc(db, LEAVES_COLLECTION, leaveId)
    await updateDoc(docRef, {
      status,
      approvedBy,
      updatedAt: Timestamp.now(),
    })
  } catch (error) {
    console.error('Error updating leave status:', error)
    throw error
  }
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
