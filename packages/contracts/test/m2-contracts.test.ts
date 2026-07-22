import { describe, expect, it } from 'vitest'

import { authSessionSchema, babySchema, updateCurrentUserInputSchema } from '../src'

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

  it('trims a display name and enforces the shared 1–80 character contract', () => {
    expect(updateCurrentUserInputSchema.parse({ displayName: '  小雨妈妈  ' }))
      .toEqual({ displayName: '小雨妈妈' })
    expect(updateCurrentUserInputSchema.safeParse({ displayName: '   ' }).success).toBe(false)
    expect(updateCurrentUserInputSchema.safeParse({ displayName: '名'.repeat(81) }).success).toBe(false)
    expect(updateCurrentUserInputSchema.safeParse({ displayName: '😀'.repeat(80) }).success).toBe(true)
    expect(updateCurrentUserInputSchema.safeParse({ displayName: '妈妈', userId: crypto.randomUUID() }).success)
      .toBe(false)
  })
})
