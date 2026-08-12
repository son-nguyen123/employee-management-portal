import { describe, expect, it } from 'vitest'
import { decisionReviewIsEditable } from '@/lib/review/decision-policy'

describe('decision history edit window', () => {
  const now = new Date('2026-08-13T10:00:00+07:00')

  it('allows a decision reviewed during the current Vietnam week', () => {
    expect(decisionReviewIsEditable(new Date('2026-08-10T00:00:00+07:00'), now)).toBe(true)
    expect(decisionReviewIsEditable(new Date('2026-08-16T23:59:59+07:00'), now)).toBe(true)
  })

  it('locks the previous week and invalid timestamps', () => {
    expect(decisionReviewIsEditable(new Date('2026-08-09T23:59:59+07:00'), now)).toBe(false)
    expect(decisionReviewIsEditable(null, now)).toBe(false)
  })
})
