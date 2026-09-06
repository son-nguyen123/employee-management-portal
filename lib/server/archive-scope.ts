import type { RequestActor } from '@/lib/server/api-auth'

export type ArchiveRecord = {
  id: string
  path?: string
  data?: unknown
}

export type ArchivePayload = {
  records?: Record<string, ArchiveRecord[]>
  counts?: Record<string, number>
}

function referencedEmployeeId(record: ArchiveRecord): string {
  const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {}
  const employeeId = data.employeeId || data.subjectEmployeeId
  return typeof employeeId === 'string' ? employeeId : ''
}

function belongsToFactory(record: ArchiveRecord, factoryId: string, allowedEmployeeIds: Set<string>): boolean {
  const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {}
  if (String(data.factoryId || '') === factoryId) return true
  const employeeId = referencedEmployeeId(record)
  return Boolean(employeeId && allowedEmployeeIds.has(employeeId))
}

/**
 * Archives are stored as combined factory snapshots. Managers/admins may
 * inspect only records associated with their own factory; the Host remains
 * the root account and can inspect both branches.
 */
export function scopeArchivePayload<T extends ArchivePayload>(actor: RequestActor, payload: T): T {
  if (actor.role === 'director') return payload

  const records = payload.records || {}
  const profiles = Array.isArray(records.employeeProfiles) ? records.employeeProfiles : []
  const allowedEmployeeIds = new Set(
    profiles
      .filter((record) => {
        const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {}
        return String(data.factoryId || 'factory-1') === actor.factoryId
      })
      .map((record) => record.id),
  )

  const scopedRecords = Object.fromEntries(Object.entries(records).map(([collection, collectionRecords]) => [
    collection,
    collection === 'employeeProfiles'
      ? collectionRecords.filter((record) => {
          const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {}
          return String(data.factoryId || 'factory-1') === actor.factoryId
        })
      : collectionRecords.filter((record) => belongsToFactory(record, actor.factoryId, allowedEmployeeIds)),
  ])) as Record<string, ArchiveRecord[]>

  return {
    ...payload,
    records: scopedRecords,
    counts: Object.fromEntries(Object.entries(scopedRecords).map(([collection, collectionRecords]) => [collection, collectionRecords.length])),
  }
}
