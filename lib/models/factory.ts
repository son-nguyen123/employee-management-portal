export const FACTORY_IDS = ['factory-1', 'factory-2'] as const

export type FactoryId = typeof FACTORY_IDS[number]

// The management seat belongs to the factory, not to the account currently
// occupying it. Operational data continues to be scoped by factoryId.
export interface FactoryManagerSeat {
  factoryId: FactoryId
  managerId: string | null
  managerName?: string
  status: 'occupied' | 'vacant'
}

export const FACTORY_LABELS: Record<FactoryId, string> = {
  'factory-1': 'Xưởng 1',
  'factory-2': 'Xưởng 2',
}

export function isFactoryId(value: unknown): value is FactoryId {
  return typeof value === 'string' && FACTORY_IDS.includes(value as FactoryId)
}

// Hồ sơ cũ chưa có factoryId được xem là thuộc Xưởng 1.
export function employeeFactoryId(value: { factoryId?: FactoryId } | null | undefined): FactoryId {
  return isFactoryId(value?.factoryId) ? value.factoryId : 'factory-1'
}

export function isFactoryManagerRole(role: unknown): boolean {
  return role === 'admin' || role === 'manager'
}

export function canHostManageFactorySeat(input: {
  viewerRole: unknown
  targetRole: unknown
  targetId: string
  seatManagerId: string | null | undefined
  seatsLoaded: boolean
}): boolean {
  if (input.viewerRole !== 'director' || !input.seatsLoaded || input.targetRole === 'director') return false
  return isFactoryManagerRole(input.targetRole) || !input.seatManagerId || input.seatManagerId === input.targetId
}

export const REGISTRATION_FACTORY_STORAGE_KEY = 'tricandy:registration-factory'
