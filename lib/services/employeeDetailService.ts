import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type CollectionReference,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { LateRequest, LeaveRequest, SalaryAdvance, StaffRequest, WorkSchedule } from '@/lib/models/types'

const PAGE_SIZE = 12

type Cursor = QueryDocumentSnapshot<DocumentData>

export type EmployeeDetailCursors = {
  schedules?: Cursor
  leaves?: Cursor
  lates?: Cursor
  salaries?: Cursor
  staffRequests?: Cursor
}

export type EmployeeDetailPage = {
  schedules: WorkSchedule[]
  leaves: LeaveRequest[]
  lates: LateRequest[]
  salaries: SalaryAdvance[]
  staffRequests: StaffRequest[]
  cursors: EmployeeDetailCursors
  hasMore: Record<keyof EmployeeDetailCursors, boolean>
}

async function readPage<T>(
  base: CollectionReference<DocumentData>,
  constraints: QueryConstraint[],
  cursor: Cursor | undefined,
  map: (snapshot: QueryDocumentSnapshot<DocumentData>) => T,
) {
  const snapshot = await getDocs(query(
    base,
    ...constraints,
    ...(cursor ? [startAfter(cursor)] : []),
    limit(PAGE_SIZE + 1),
  ))
  const rows = snapshot.docs.slice(0, PAGE_SIZE).map(map)
  return {
    rows,
    nextCursor: snapshot.docs.length > PAGE_SIZE ? snapshot.docs[PAGE_SIZE - 1] : undefined,
    hasMore: snapshot.docs.length > PAGE_SIZE,
  }
}

export async function getEmployeeDetailPage(
  employeeId: string,
  cursors: EmployeeDetailCursors = {},
  options: { includeSalaryAdvances?: boolean } = {},
): Promise<EmployeeDetailPage> {
  const [schedules, leaves, lates, salaries, staffRequests] = await Promise.all([
    readPage(
      collection(db, 'workSchedules'),
      [where('employeeId', '==', employeeId), orderBy('date', 'desc')],
      cursors.schedules,
      (snapshot) => ({ id: snapshot.id, ...snapshot.data() } as WorkSchedule),
    ),
    readPage(
      collection(db, 'leaveRequests'),
      [where('employeeId', '==', employeeId), orderBy('leaveDate', 'desc')],
      cursors.leaves,
      (snapshot) => ({ id: snapshot.id, ...snapshot.data() } as LeaveRequest),
    ),
    readPage(
      collection(db, 'lateRequests'),
      [where('employeeId', '==', employeeId), orderBy('date', 'desc')],
      cursors.lates,
      (snapshot) => ({ id: snapshot.id, ...snapshot.data() } as LateRequest),
    ),
    options.includeSalaryAdvances === false
      ? Promise.resolve({ rows: [] as SalaryAdvance[], nextCursor: undefined, hasMore: false })
      : readPage(
        collection(db, 'salaryAdvances'),
        [where('employeeId', '==', employeeId), orderBy('createdAt', 'desc')],
        cursors.salaries,
        (snapshot) => ({ id: snapshot.id, ...snapshot.data() } as SalaryAdvance),
      ),
    readPage(
      collection(db, 'staffRequests'),
      [where('employeeId', '==', employeeId), orderBy('createdAt', 'desc')],
      cursors.staffRequests,
      (snapshot) => ({ id: snapshot.id, ...snapshot.data() } as StaffRequest),
    ),
  ])

  return {
    schedules: schedules.rows,
    leaves: leaves.rows,
    lates: lates.rows,
    salaries: salaries.rows,
    staffRequests: staffRequests.rows,
    cursors: {
      ...(schedules.nextCursor ? { schedules: schedules.nextCursor } : {}),
      ...(leaves.nextCursor ? { leaves: leaves.nextCursor } : {}),
      ...(lates.nextCursor ? { lates: lates.nextCursor } : {}),
      ...(salaries.nextCursor ? { salaries: salaries.nextCursor } : {}),
      ...(staffRequests.nextCursor ? { staffRequests: staffRequests.nextCursor } : {}),
    },
    hasMore: {
      schedules: schedules.hasMore,
      leaves: leaves.hasMore,
      lates: lates.hasMore,
      salaries: salaries.hasMore,
      staffRequests: staffRequests.hasMore,
    },
  }
}
