import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { WorkSchedule } from '@/lib/models/types'

const SCHEDULES_COLLECTION = 'workSchedules'

/**
 * Create a new work schedule
 */
export async function createWorkSchedule(scheduleData: Omit<WorkSchedule, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  try {
    const schedule = {
      ...scheduleData,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }

    const docRef = await addDoc(collection(db, SCHEDULES_COLLECTION), schedule)
    return docRef.id
  } catch (error) {
    console.error('Error creating schedule:', error)
    throw error
  }
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
  try {
    const docRef = doc(db, SCHEDULES_COLLECTION, scheduleId)
    await updateDoc(docRef, {
      ...updates,
      updatedAt: Timestamp.now(),
    })
  } catch (error) {
    console.error('Error updating schedule:', error)
    throw error
  }
}

/**
 * Delete work schedule
 */
export async function deleteWorkSchedule(scheduleId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, SCHEDULES_COLLECTION, scheduleId))
  } catch (error) {
    console.error('Error deleting schedule:', error)
    throw error
  }
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
