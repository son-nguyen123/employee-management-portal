import {
  collection,
  doc,
  getDoc,
  updateDoc,
  query,
  where,
  getDocs,
  onSnapshot,
  Timestamp,
  deleteField,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { auth } from '@/lib/firebase'
import { Employee, EmployeeScheduleMode } from '@/lib/models/types'
import { callWorkflowApi } from '@/lib/services/workflowApi'

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

export function subscribeToEmployeeByUID(
  uid: string,
  callback: (employee: Employee | null) => void,
  onError?: (error: Error) => void
): () => void {
  return onSnapshot(
    doc(db, EMPLOYEES_COLLECTION, uid),
    (snapshot) => callback(snapshot.exists() ? snapshot.data() as Employee : null),
    (error) => onError?.(error)
  )
}

/**
 * Create new employee
 */
export async function createEmployee(uid: string, employeeData: Omit<Employee, 'uid' | 'createdAt' | 'updatedAt'>): Promise<void> {
  try {
    const sanitized = { ...employeeData }
    if (!(sanitized.bankName && sanitized.bankAccountName && sanitized.bankAccountNumber)) {
      delete sanitized.bankName
      delete sanitized.bankAccountName
      delete sanitized.bankAccountNumber
    }
    void uid
    const user = auth.currentUser
    if (!user) throw new Error('Bạn cần đăng nhập để tạo hồ sơ.')
    const response = await fetch('/api/profile/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify(sanitized),
    })
    const result = await response.json().catch(() => null) as { error?: string } | null
    if (!response.ok) throw new Error(result?.error || 'Chưa thể gửi hồ sơ đăng ký.')
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
    const sanitized: Record<string, unknown> = { ...updates }
    const touchesBank = ['bankName', 'bankAccountName', 'bankAccountNumber'].some((key) => key in updates)
    if (touchesBank && !(updates.bankName && updates.bankAccountName && updates.bankAccountNumber)) {
      sanitized.bankName = deleteField()
      sanitized.bankAccountName = deleteField()
      sanitized.bankAccountNumber = deleteField()
    }
    await updateDoc(docRef, {
      ...sanitized,
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

export async function setEmployeeAccountStatus(employeeId: string, status: 'active' | 'inactive'): Promise<{ employeeId: string; status: 'active' | 'inactive'; releasedSchedules: number }> {
  return callWorkflowApi('manageEmployeeStatus', { employeeId, status })
}

export async function setEmployeeScheduleMode(mode: EmployeeScheduleMode): Promise<{ mode: EmployeeScheduleMode; effectiveWeekStart: string }> {
  return callWorkflowApi('setEmployeeScheduleMode', { mode })
}
