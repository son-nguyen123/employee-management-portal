import { describe, expect, it } from 'vitest'
import {
  employeeCodeAssignedToAnother,
  employeeCodeInput,
  isValidEmployeeCode,
  normalizeEmployeeCode,
} from '@/lib/models/employee-code'

describe('employee code policy', () => {
  it.each(['0', '14', '11500', '001', '999999999'])('accepts numeric code %s', (code) => {
    expect(isValidEmployeeCode(code)).toBe(true)
  })

  it.each(['', 'HOST-001', '14A', '-1', '1.5', '1234567890', '１２'])('rejects invalid code %s', (code) => {
    expect(isValidEmployeeCode(code)).toBe(false)
  })

  it('preserves leading zeroes when normalizing', () => {
    expect(normalizeEmployeeCode(' 001 ')).toBe('001')
  })

  it('limits form input to nine ASCII digits', () => {
    expect(employeeCodeInput('H0-0123456789')).toBe('001234567')
  })

  it('keeps a disabled account code reserved', () => {
    const records = [
      { uid: 'inactive-user', employeeCode: '14', status: 'inactive' },
      { uid: 'active-user', employeeCode: '15', status: 'active' },
    ]
    expect(employeeCodeAssignedToAnother(records, '14', 'new-user')).toBe(true)
    expect(employeeCodeAssignedToAnother(records, '14', 'inactive-user')).toBe(false)
  })
})
