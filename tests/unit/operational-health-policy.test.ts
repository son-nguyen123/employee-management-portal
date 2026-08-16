import { describe, expect, it } from 'vitest'
import { overallHealthLevel, quotaHealthLevel } from '@/lib/operations/health-policy'

describe('operational health policy', () => {
  it('warns at 80 percent and becomes critical at 95 percent', () => {
    expect(quotaHealthLevel(39_999, 50_000)).toBe('healthy')
    expect(quotaHealthLevel(40_000, 50_000)).toBe('warning')
    expect(quotaHealthLevel(47_500, 50_000)).toBe('critical')
  })

  it('does not claim a level when a limit is unavailable', () => {
    expect(quotaHealthLevel(10, 0)).toBe('unknown')
    expect(quotaHealthLevel(Number.NaN, 100)).toBe('unknown')
  })

  it('uses the most serious service as the overall state', () => {
    expect(overallHealthLevel(['healthy', 'warning', 'unknown'])).toBe('warning')
    expect(overallHealthLevel(['healthy', 'critical'])).toBe('critical')
  })
})
