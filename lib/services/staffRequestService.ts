import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { StaffRequest, StaffRequestShift, StaffRequestType } from '@/lib/models/types'
import { callWorkflowApi, newWorkflowRequestId } from '@/lib/services/workflowApi'

const COLLECTION = 'staffRequests'

export async function submitStaffRequest(input: {
  type: StaffRequestType
  content: string
  weekStart?: Date
  shifts?: Array<{ date: Date; shift: StaffRequestShift['shift'] }>
  removedShifts?: Array<{ scheduleId: string; date: Date; shift: StaffRequestShift['shift'] }>
  restoredShifts?: Array<{ scheduleId: string; date: Date; shift: StaffRequestShift['shift'] }>
}): Promise<{ id: string }> {
  return callWorkflowApi('submitStaffRequest', {
    requestId: newWorkflowRequestId(),
    type: input.type,
    content: input.content,
    weekStart: input.weekStart?.toISOString(),
    shifts: input.shifts?.map((item) => ({ date: item.date.toISOString(), shift: item.shift })),
    removedShifts: input.removedShifts?.map((item) => ({
      scheduleId: item.scheduleId,
      date: item.date.toISOString(),
      shift: item.shift,
    })),
    restoredShifts: input.restoredShifts?.map((item) => ({
      scheduleId: item.scheduleId,
      date: item.date.toISOString(),
      shift: item.shift,
    })),
  })
}

function fromSnapshot(item: { id: string; data: () => Record<string, unknown> }): StaffRequest {
  return { id: item.id, ...item.data() } as StaffRequest
}

export function subscribeToPendingStaffRequests(
  callback: (items: StaffRequest[]) => void,
  onError?: (error: Error) => void
): () => void {
  const requestQuery = query(collection(db, COLLECTION), where('status', '==', 'Pending'))
  return onSnapshot(
    requestQuery,
    (snapshot) => callback(snapshot.docs.map(fromSnapshot).sort((left, right) => {
      const leftDate = left.createdAt instanceof Date ? left.createdAt : left.createdAt.toDate()
      const rightDate = right.createdAt instanceof Date ? right.createdAt : right.createdAt.toDate()
      return rightDate.getTime() - leftDate.getTime()
    })),
    (error) => onError?.(error)
  )
}

export async function getEmployeeStaffRequests(employeeId: string): Promise<StaffRequest[]> {
  const snapshot = await getDocs(query(collection(db, COLLECTION), where('employeeId', '==', employeeId)))
  return snapshot.docs.map(fromSnapshot)
}

export async function updateStaffRequestStatus(
  id: string,
  status: 'Approved' | 'Rejected',
  reviewNote = ''
): Promise<void> {
  await callWorkflowApi('reviewRequest', {
    resource: 'staff',
    id,
    status,
    note: reviewNote,
  })
}
