import { describe, expect, it } from 'vitest'
import { canHostManageFactorySeat, employeesForFactory, isFactoryManagerRole } from '@/lib/models/factory'

describe('factory management seat policy', () => {
  it('recognizes current and legacy factory manager roles', () => {
    expect(isFactoryManagerRole('admin')).toBe(true)
    expect(isFactoryManagerRole('manager')).toBe(true)
    expect(isFactoryManagerRole('employee')).toBe(false)
    expect(isFactoryManagerRole('director')).toBe(false)
  })

  it('allows only Host to assign a vacant factory seat', () => {
    const base = { targetRole: 'employee', targetId: 'employee-1', seatManagerId: null, seatsLoaded: true }
    expect(canHostManageFactorySeat({ ...base, viewerRole: 'director' })).toBe(true)
    expect(canHostManageFactorySeat({ ...base, viewerRole: 'admin' })).toBe(false)
    expect(canHostManageFactorySeat({ ...base, viewerRole: 'manager' })).toBe(false)
  })

  it('hides promotion for ordinary employees after the factory seat is occupied', () => {
    expect(canHostManageFactorySeat({
      viewerRole: 'director',
      targetRole: 'employee',
      targetId: 'employee-2',
      seatManagerId: 'admin-1',
      seatsLoaded: true,
    })).toBe(false)
  })

  it('keeps the control visible so Host can return the current manager seat', () => {
    expect(canHostManageFactorySeat({
      viewerRole: 'director',
      targetRole: 'admin',
      targetId: 'admin-1',
      seatManagerId: 'admin-1',
      seatsLoaded: true,
    })).toBe(true)
    expect(canHostManageFactorySeat({
      viewerRole: 'director',
      targetRole: 'manager',
      targetId: 'legacy-manager',
      seatManagerId: null,
      seatsLoaded: true,
    })).toBe(true)
  })

  it('never exposes a control for Host accounts or before seat state loads', () => {
    expect(canHostManageFactorySeat({
      viewerRole: 'director', targetRole: 'director', targetId: 'host-1', seatManagerId: null, seatsLoaded: true,
    })).toBe(false)
    expect(canHostManageFactorySeat({
      viewerRole: 'director', targetRole: 'employee', targetId: 'employee-1', seatManagerId: null, seatsLoaded: false,
    })).toBe(false)
  })

  it('keeps the Host root out of each factory directory branch', () => {
    const employees = [
      { uid: 'host', role: 'director' as const, factoryId: 'factory-1' as const },
      { uid: 'factory-1-employee', role: 'employee' as const, factoryId: 'factory-1' as const },
      { uid: 'factory-1-admin', role: 'admin' as const, factoryId: 'factory-1' as const },
      { uid: 'factory-2-employee', role: 'employee' as const, factoryId: 'factory-2' as const },
    ]

    expect(employeesForFactory(employees, 'factory-1').map((item) => item.uid)).toEqual([
      'factory-1-employee',
      'factory-1-admin',
    ])
    expect(employeesForFactory(employees, 'factory-2').map((item) => item.uid)).toEqual(['factory-2-employee'])
  })
})
