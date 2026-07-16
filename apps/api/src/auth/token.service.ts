import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { Environment } from '../config/environment'
import type { AuthenticatedUser } from '../common/http/request-context'
import { PrismaService } from '../database/prisma.service'
import type { AuthenticationResolver } from './authentication.port'

interface AccessClaims {
  sub: string
  iat: number
  exp: number
  iss: 'baby-mp-api'
  typ: 'access'
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url')
}

@Injectable()
export class TokenService implements AuthenticationResolver {
  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<Environment, true>,
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  issueAccessToken(userId: string): { token: string; expiresAt: Date } {
    const now = Math.floor(Date.now() / 1000)
    const lifetimeSeconds = this.config.get('JWT_ACCESS_TTL_SECONDS', { infer: true })
    const claims: AccessClaims = {
      sub: userId,
      iat: now,
      exp: now + lifetimeSeconds,
      iss: 'baby-mp-api',
      typ: 'access',
    }
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const payload = base64url(JSON.stringify(claims))
    const signature = this.sign(`${header}.${payload}`)
    return {
      token: `${header}.${payload}.${signature}`,
      expiresAt: new Date(claims.exp * 1000),
    }
  }

  issueRefreshToken(): string {
    return randomBytes(48).toString('base64url')
  }

  newFamilyId(): string {
    return randomUUID()
  }

  hashRefreshToken(token: string): string {
    return createHmac(
      'sha256',
      this.config.get('JWT_REFRESH_SECRET', { infer: true }),
    )
      .update(token)
      .digest('hex')
  }

  async resolve(accessToken: string): Promise<AuthenticatedUser | null> {
    const parts = accessToken.split('.')
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null
    const expected = Buffer.from(this.sign(`${parts[0]}.${parts[1]}`))
    const actual = Buffer.from(parts[2])
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null

    try {
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as Record<string, unknown>
      if (header.alg !== 'HS256' || header.typ !== 'JWT') return null
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Partial<AccessClaims>
      const now = Math.floor(Date.now() / 1000)
      if (
        claims.typ !== 'access' ||
        claims.iss !== 'baby-mp-api' ||
        typeof claims.sub !== 'string' ||
        typeof claims.exp !== 'number' ||
        claims.exp <= now
      ) return null
      const user = await this.prisma.user.findFirst({
        where: { id: claims.sub, status: 'active', deletedAt: null },
        select: { id: true },
      })
      return user ? { id: user.id } : null
    } catch {
      return null
    }
  }

  private sign(value: string): string {
    return createHmac(
      'sha256',
      this.config.get('JWT_ACCESS_SECRET', { infer: true }),
    )
      .update(value)
      .digest('base64url')
  }
}
