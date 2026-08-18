import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE_IMAGE, isProfileImageUrl } from '@/lib/utils/profileImage'

describe('profile image validation', () => {
  it('accepts the built-in default image', () => {
    expect(isProfileImageUrl(DEFAULT_PROFILE_IMAGE)).toBe(true)
  })

  it('accepts remote http and https image URLs', () => {
    expect(isProfileImageUrl('https://example.com/avatar.jpg')).toBe(true)
    expect(isProfileImageUrl('http://localhost:3000/avatar.jpg')).toBe(true)
  })

  it('rejects empty values and non-URLs', () => {
    expect(isProfileImageUrl('')).toBe(false)
    expect(isProfileImageUrl('avatar.jpg')).toBe(false)
    expect(isProfileImageUrl(null)).toBe(false)
  })
})
