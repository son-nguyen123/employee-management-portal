import 'server-only'

import type { DecodedIdToken } from 'firebase-admin/auth'
import { adminDb } from '@/lib/server/firebase-admin'
import type { AppRole, RequestActor } from '@/lib/server/api-auth'
import { ensureFixedSchedule } from '@/lib/server/workflows'
import { isManagementScheduleRole, nextMondayKeyInVietnam } from '@/lib/schedule/registration-policy'
import { isFactoryId } from '@/lib/models/factory'

const supportedRoles: AppRole[] = ['employee', 'manager', 'admin', 'director']

export async function runFixedScheduleMaterialization(now = new Date()) {
  const targetWeekStart = nextMondayKeyInVietnam(now)
  const employees = await adminDb.collection('employees').where('status', '==', 'active').get()
  const candidates = employees.docs.filter((snapshot) => {
    const role = snapshot.get('role')
    return supportedRoles.includes(role) && (isManagementScheduleRole(role) || snapshot.get('scheduleMode') === 'fixed')
  })

  let createdEmployees = 0
  let createdSchedules = 0
  let needsSetup = 0
  const failures: Array<{ employeeId: string; error: string }> = []

  // Keep concurrency bounded so a larger factory cannot exhaust Firestore or push quotas.
  for (let index = 0; index < candidates.length; index += 5) {
    const batch = candidates.slice(index, index + 5)
    const results = await Promise.all(batch.map(async (snapshot) => {
      const role = snapshot.get('role') as AppRole
      const actor: RequestActor = {
        token: { uid: snapshot.id } as DecodedIdToken,
        uid: snapshot.id,
        role,
        factoryId: isFactoryId(snapshot.get('factoryId')) ? snapshot.get('factoryId') : 'factory-1',
      }
      try {
        return { employeeId: snapshot.id, result: await ensureFixedSchedule(actor, { weekStart: targetWeekStart }) }
      } catch (error) {
        return {
          employeeId: snapshot.id,
          error: error instanceof Error ? error.message : 'Không thể tạo lịch cố định.',
        }
      }
    }))
    results.forEach((item) => {
      if ('error' in item && typeof item.error === 'string') {
        failures.push({ employeeId: item.employeeId, error: item.error })
        return
      }
      if (item.result.created) createdEmployees += 1
      createdSchedules += item.result.ids.length
      if (item.result.needsSetup) needsSetup += 1
    })
  }

  return {
    targetWeekStart,
    eligibleEmployees: candidates.length,
    createdEmployees,
    createdSchedules,
    needsSetup,
    failures,
  }
}
