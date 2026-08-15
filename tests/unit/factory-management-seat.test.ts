import { describe, expect, it } from 'vitest'
import { canHostManageFactorySeat, isFactoryManagerRole } from '@/lib/models/factory'

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
})
