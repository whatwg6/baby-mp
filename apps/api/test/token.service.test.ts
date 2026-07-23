import type { ConfigService } from '@nestjs/config'
import { describe, expect, it, vi } from 'vitest'

import type { Environment } from '../src/config/environment'
import type { PrismaService } from '../src/database/prisma.service'
import { TokenService } from '../src/auth/token.service'

function createService(userActive = true): TokenService {
  const values: Partial<Environment> = {
    JWT_ACCESS_SECRET: 'test-access-secret-at-least-16',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-16',
    JWT_ACCESS_TTL_SECONDS: 900,
  }
  const config = {
    get: vi.fn((key: keyof Environment) => values[key]),
  } as unknown as ConfigService<Environment, true>
  const prisma = {
    user: {
      findFirst: vi.fn().mockResolvedValue(userActive ? { id: 'e3ad61b4-7e42-4ff7-9fb8-6596fd4f6af5' } : null),
    },
  } as unknown as PrismaService
  return new TokenService(config, prisma)
}

describe('TokenService', () => {
  it('issues and resolves a signed access token without embedding roles', async () => {
    const service = createService()
    const result = service.issueAccessToken('e3ad61b4-7e42-4ff7-9fb8-6596fd4f6af5')
    const payload = JSON.parse(Buffer.from(result.token.split('.')[1]!, 'base64url').toString())

    expect(payload).toMatchObject({
      sub: 'e3ad61b4-7e42-4ff7-9fb8-6596fd4f6af5',
      typ: 'access',
      iss: 'baby-mp-api',
    })
    expect(payload).not.toHaveProperty('role')
    await expect(service.resolve(result.token)).resolves.toEqual({ id: payload.sub })
  })

  it('rejects tampering, a changed algorithm, and inactive users', async () => {
    const service = createService()
    const token = service.issueAccessToken('e3ad61b4-7e42-4ff7-9fb8-6596fd4f6af5').token
    const [header, payload, signature] = token.split('.')
    await expect(service.resolve(`${header}.${payload}x.${signature}`)).resolves.toBeNull()

    const wrongHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    await expect(service.resolve(`${wrongHeader}.${payload}.${signature}`)).resolves.toBeNull()

    const inactiveService = createService(false)
    const inactiveToken = inactiveService.issueAccessToken('e3ad61b4-7e42-4ff7-9fb8-6596fd4f6af5').token
    await expect(inactiveService.resolve(inactiveToken)).resolves.toBeNull()
  })

  it('hashes refresh tokens without returning the raw value', () => {
    const service = createService()
    const raw = service.issueRefreshToken()
    const hash = service.hashRefreshToken(raw)
    expect(raw).not.toBe(hash)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
