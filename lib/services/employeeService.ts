import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  query,
  where,
  getDocs,
  onSnapshot,
  Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Employee } from '@/lib/models/types'

const EMPLOYEES_COLLECTION = 'employees'

/**
 * Get employee by UID
 */
export async function getEmployeeByUID(uid: string): Promise<Employee | null> {
  try {
    const docRef = doc(db, EMPLOYEES_COLLECTION, uid)
    const docSnap = await getDoc(docRef)

    if (docSnap.exists()) {
      return docSnap.data() as Employee
    }
    return null
  } catch (error) {
    console.error('Error fetching employee:', error)
    throw error
  }
}

/**
 * Create new employee
 */
export async function createEmployee(uid: string, employeeData: Omit<Employee, 'uid' | 'createdAt' | 'updatedAt'>): Promise<void> {
  try {
    const employee: Employee = {
      ...employeeData,
      uid,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }

    await setDoc(doc(db, EMPLOYEES_COLLECTION, uid), employee)
  } catch (error) {
    console.error('Error creating employee:', error)
    throw error
  }
}

/**
 * Update employee profile
 */
export async function updateEmployee(uid: string, updates: Partial<Omit<Employee, 'uid' | 'createdAt'>>): Promise<void> {
  try {
    const docRef = doc(db, EMPLOYEES_COLLECTION, uid)
    await updateDoc(docRef, {
      ...updates,
      updatedAt: Timestamp.now(),
    })
  } catch (error) {
    console.error('Error updating employee:', error)
    throw error
  }
}

/**
 * Get all employees (admin only)
 */
export async function getAllEmployees(): Promise<Employee[]> {
  try {
    const querySnapshot = await getDocs(collection(db, EMPLOYEES_COLLECTION))
    return querySnapshot.docs.map((doc) => doc.data() as Employee)
  } catch (error) {
    console.error('Error fetching employees:', error)
    throw error
  }
}

/**
 * Get active employees
 */
export async function getActiveEmployees(): Promise<Employee[]> {
  try {
    const q = query(collection(db, EMPLOYEES_COLLECTION), where('status', '==', 'active'))
    const querySnapshot = await getDocs(q)
    return querySnapshot.docs.map((doc) => doc.data() as Employee)
  } catch (error) {
    console.error('Error fetching active employees:', error)
    throw error
  }
}

export function subscribeToAllEmployees(
  callback: (employees: Employee[]) => void,
  onError?: (error: Error) => void
): () => void {
  return onSnapshot(
    collection(db, EMPLOYEES_COLLECTION),
    (snapshot) => callback(snapshot.docs.map((item) => item.data() as Employee)),
    (error) => onError?.(error)
  )
}

export function subscribeToActiveEmployees(
  callback: (employees: Employee[]) => void,
  onError?: (error: Error) => void
): () => void {
  const activeQuery = query(
    collection(db, EMPLOYEES_COLLECTION),
    where('status', '==', 'active')
  )
  return onSnapshot(
    activeQuery,
    (snapshot) => callback(snapshot.docs.map((item) => item.data() as Employee)),
    (error) => onError?.(error)
  )
}
