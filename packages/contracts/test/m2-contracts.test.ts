import { describe, expect, it } from 'vitest'

import { authSessionSchema, babySchema } from '../src'

describe('M2 contracts', () => {
  it('validates the auth and baby response shapes', () => {
    expect(authSessionSchema.safeParse({
      accessToken: 'access', accessTokenExpiresAt: '2026-07-17T00:15:00.000Z',
      refreshToken: 'refresh', refreshTokenExpiresAt: '2026-08-17T00:00:00.000Z',
      user: { id: 'b1111111-1111-4111-8111-111111111111', displayName: null, avatarUrl: null },
    }).success).toBe(true)
    expect(babySchema.safeParse({
      id: 'b1111111-1111-4111-8111-111111111111', name: 'Test Baby', gender: 'unspecified',
      birthDate: '2026-01-01', birthTime: null, birthHeightCm: null, birthWeightKg: null,
      avatarUrl: null, role: 'admin', version: 1,
      createdAt: '2026-07-17T00:00:00.000Z', updatedAt: '2026-07-17T00:00:00.000Z',
    }).success).toBe(true)
  })
})
