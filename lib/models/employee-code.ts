export const EMPLOYEE_CODE_MAX_DIGITS = 9
export const EMPLOYEE_CODE_PATTERN = /^\d{1,9}$/

export function normalizeEmployeeCode(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function isValidEmployeeCode(value: unknown): value is string {
  return EMPLOYEE_CODE_PATTERN.test(normalizeEmployeeCode(value))
}

export function employeeCodeInput(value: string): string {
  return value.replace(/\D/g, '').slice(0, EMPLOYEE_CODE_MAX_DIGITS)
}

export function employeeCodeAssignedToAnother(
  records: Iterable<{ uid: string; employeeCode: unknown }>,
  employeeCode: string,
  currentUid: string,
): boolean {
  return Array.from(records).some((record) =>
    record.uid !== currentUid && normalizeEmployeeCode(record.employeeCode) === employeeCode
  )
}
