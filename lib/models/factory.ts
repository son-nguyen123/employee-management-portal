export const FACTORY_IDS = ['factory-1', 'factory-2'] as const

export type FactoryId = typeof FACTORY_IDS[number]

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

export const REGISTRATION_FACTORY_STORAGE_KEY = 'tricandy:registration-factory'
