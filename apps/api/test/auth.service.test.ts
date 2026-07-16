import { NotFoundException, UnauthorizedException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { PlatformType, UserStatus } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

import { AuthService } from '../src/auth/auth.service'
import type { TokenService } from '../src/auth/token.service'
import type { Environment } from '../src/config/environment'
import type { PrismaService } from '../src/database/prisma.service'
import type { PlatformIdentityExchange } from '../src/auth/platform-authentication.port'

const user = {
  id: 'b1111111-1111-4111-8111-111111111111', displayName: 'Test Parent', avatarMediaId: null,
  status: UserStatus.active, lastLoginAt: new Date(), createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
}

interface TestSession {
  id: string
  userId: string
  familyId: string
  tokenHash: string
  platform: PlatformType
  expiresAt: Date
  revokedAt: Date | null
  revokeReason: string | null
  replacedBySessionId: string | null
  createdAt: Date
  user: typeof user
}

function config(values: Partial<Environment>): ConfigService<Environment, true> {
  return { get: vi.fn((key: keyof Environment) => values[key]) } as unknown as ConfigService<Environment, true>
}

describe('AuthService', () => {
  it('makes mock login indistinguishable from a missing route when disabled', async () => {
    const service = new AuthService(
      {} as PrismaService,
      config({ APP_ENV: 'production', MOCK_AUTH_ENABLED: false }),
      {} as TokenService,
      {} as PlatformIdentityExchange,
    )
    await expect(service.mockLogin('sentinel-user')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('rotates refresh tokens and revokes the entire family on old-token replay', async () => {
    const old: TestSession = {
      id: 's1', userId: user.id, familyId: 'f1111111-1111-4111-8111-111111111111', tokenHash: 'old-hash',
      platform: PlatformType.h5, expiresAt: new Date(Date.now() + 60_000), revokedAt: null,
      revokeReason: null, replacedBySessionId: null, createdAt: new Date(), user,
    }
    const sessions = new Map<string, TestSession>([['old-hash', old]])
    let nextId = 1
    const tx = {
      refreshSession: {
        findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => sessions.get(where.tokenHash) ?? null),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const created = { ...data, id: `next-${nextId++}`, revokedAt: null, replacedBySessionId: null, revokeReason: null, createdAt: new Date() }
          sessions.set(data.tokenHash as string, created as TestSession)
          return created
        }),
        updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          let count = 0
          for (const session of sessions.values()) {
            const matchesId = !where.id || session.id === where.id
            const matchesFamily = !where.familyId || session.familyId === where.familyId
            const requiresActive = where.revokedAt !== null || session.revokedAt === null
            const requiresUnreplaced = where.replacedBySessionId !== null || session.replacedBySessionId === null
            if (matchesId && matchesFamily && requiresActive && requiresUnreplaced) {
              Object.assign(session, data); count += 1
            }
          }
          return { count }
        }),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaService
    const tokens = {
      hashRefreshToken: vi.fn((value: string) => value === 'raw-old' ? 'old-hash' : 'next-hash'),
      issueRefreshToken: vi.fn(() => 'raw-next'),
      issueAccessToken: vi.fn(() => ({ token: 'access', expiresAt: new Date(Date.now() + 60_000) })),
    } as unknown as TokenService
    const service = new AuthService(
      prisma,
      config({ JWT_REFRESH_TTL_SECONDS: 3600 }),
      tokens,
      {} as PlatformIdentityExchange,
    )

    await expect(service.refresh('raw-old')).resolves.toMatchObject({ refreshToken: 'raw-next' })
    expect(old.revokedAt).toBeInstanceOf(Date)
    await expect(service.refresh('raw-old')).rejects.toBeInstanceOf(UnauthorizedException)
    expect([...sessions.values()].every((session) => session.revokedAt instanceof Date)).toBe(true)
    expect([...sessions.values()].every((session) => session.tokenHash !== 'raw-old')).toBe(true)
  })
})
