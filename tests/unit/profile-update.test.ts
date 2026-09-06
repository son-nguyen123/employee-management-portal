import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const profileRef = {
    get: vi.fn(async () => ({
      exists: true,
      data: () => ({
        fullName: 'Lâm Huỳnh Thiện Trí',
        phone: '0908311563',
        photoURL: '/tricandy-logo.png',
        facebookUrl: 'https://facebook.com/example',
      }),
    })),
    update: vi.fn(async () => undefined),
  }
  return {
    authenticateRequest: vi.fn(async () => ({ uid: 'host-1', role: 'director', factoryId: 'factory-1' })),
    profileRef,
    adminDb: { collection: vi.fn(() => ({ doc: vi.fn(() => profileRef) })) },
    updateUser: vi.fn(async () => undefined),
    invalidateMonthDataCache: vi.fn(),
  }
})

vi.mock('@/lib/server/api-auth', () => ({
  ApiError: class ApiError extends Error {
    constructor(public readonly status: number, message: string) {
      super(message)
    }
  },
  authenticateRequest: mocks.authenticateRequest,
}))
vi.mock('@/lib/server/firebase-admin', () => ({
  adminAuth: { updateUser: mocks.updateUser },
  adminDb: mocks.adminDb,
}))
vi.mock('@/lib/server/month-data-cache', () => ({ invalidateMonthDataCache: mocks.invalidateMonthDataCache }))

import { POST } from '@/app/api/profile/update/route'

function profileRequest() {
  return new Request('https://employee-management-portal-seven-pi.vercel.app/api/profile/update', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Lâm Huỳnh Thiện Trí',
      phone: '0908311563',
      photoURL: '/tricandy-logo.png',
      facebookUrl: 'https://facebook.com/example',
      bankName: '',
      bankAccountName: '',
      bankAccountNumber: '',
    }),
  })
}

describe('profile update API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updateUser.mockResolvedValue(undefined)
  })

  it('converts the default relative image to an absolute Auth photo URL', async () => {
    const response = await POST(profileRequest())

    expect(response.status).toBe(200)
    expect(mocks.profileRef.update).toHaveBeenCalledOnce()
    expect(mocks.updateUser).toHaveBeenCalledWith('host-1', {
      displayName: 'Lâm Huỳnh Thiện Trí',
      photoURL: 'https://employee-management-portal-seven-pi.vercel.app/tricandy-logo.png',
    })
  })

  it('keeps a successful Firestore save successful when Auth profile sync fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.updateUser.mockRejectedValueOnce(new Error('Auth sync failed'))

    const response = await POST(profileRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mocks.profileRef.update).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalledWith('Firebase Auth profile sync failed:', expect.any(Error))
    errorSpy.mockRestore()
  })
})
