import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PlatformType, Prisma, UserStatus, type User } from '@prisma/client'

import type { AuthSession, PlatformType as ApiPlatformType, UserSummary } from '@baby-mp/contracts'

import type { Environment } from '../config/environment'
import { PrismaService } from '../database/prisma.service'
import {
  PLATFORM_IDENTITY_EXCHANGE,
  type ExchangedPlatformIdentity,
  type PlatformIdentityExchange,
} from './platform-authentication.port'
import { TokenService } from './token.service'

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ConfigService)
    private readonly config: ConfigService<Environment, true>,
    @Inject(TokenService)
    private readonly tokens: TokenService,
    @Inject(PLATFORM_IDENTITY_EXCHANGE)
    private readonly platformExchange: PlatformIdentityExchange,
  ) {}

  async platformLogin(platform: ApiPlatformType, code: string): Promise<AuthSession> {
    const identity = await this.platformExchange.exchange(platform, code)
    const user = await this.findOrCreateUser(identity)
    return this.createSession(user, identity.platform)
  }

  async mockLogin(mockUserKey: string, displayName?: string): Promise<AuthSession> {
    const environment = this.config.get('APP_ENV', { infer: true })
    if (
      !this.config.get('MOCK_AUTH_ENABLED', { infer: true }) ||
      !['local', 'test'].includes(environment)
    ) {
      throw new NotFoundException('资源不存在')
    }
    const user = await this.findOrCreateUser({
      platform: 'h5',
      appId: 'baby-mp-mock',
      subject: mockUserKey,
    }, displayName)
    return this.createSession(user, 'h5')
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken)
    const now = new Date()
    const nextToken = this.tokens.issueRefreshToken()
    const nextHash = this.tokens.hashRefreshToken(nextToken)
    const refreshExpiresAt = new Date(
      now.getTime() + this.config.get('JWT_REFRESH_TTL_SECONDS', { infer: true }) * 1000,
    )

    const rotate = async () => this.prisma.$transaction(async (tx) => {
      const session = await tx.refreshSession.findUnique({
        where: { tokenHash },
        include: { user: true },
      })
      if (!session || session.user.status !== UserStatus.active || session.expiresAt <= now) {
        return { kind: 'invalid' as const }
      }
      if (session.revokedAt) {
        if (session.replacedBySessionId) {
          await tx.refreshSession.updateMany({
            where: { familyId: session.familyId, revokedAt: null },
            data: { revokedAt: now, revokeReason: 'replay_detected' },
          })
        }
        return { kind: 'invalid' as const }
      }

      const next = await tx.refreshSession.create({
        data: {
          userId: session.userId,
          familyId: session.familyId,
          platform: session.platform,
          tokenHash: nextHash,
          expiresAt: refreshExpiresAt,
        },
      })
      const claimed = await tx.refreshSession.updateMany({
        where: { id: session.id, revokedAt: null, replacedBySessionId: null },
        data: { revokedAt: now, revokeReason: 'rotated', replacedBySessionId: next.id },
      })
      if (claimed.count !== 1) {
        await tx.refreshSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: now, revokeReason: 'replay_detected' },
        })
        return { kind: 'invalid' as const }
      }
      return { kind: 'rotated' as const, user: session.user, platform: session.platform }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    let result: Awaited<ReturnType<typeof rotate>>
    try {
      result = await rotate()
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') {
        throw error
      }
      // A concurrent rotation won. Inspecting the old token again commits family
      // revocation if it is now a replay, and never leaks a database error.
      result = await rotate().catch((retryError: unknown) => {
        if (retryError instanceof Prisma.PrismaClientKnownRequestError && retryError.code === 'P2034') {
          return { kind: 'invalid' as const }
        }
        throw retryError
      })
    }

    if (result.kind === 'invalid') {
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_INVALID',
        message: '刷新会话已失效',
      })
    }
    return this.sessionResponse(result.user, result.platform, nextToken, refreshExpiresAt)
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken)
    await this.prisma.refreshSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'logout' },
    })
  }

  async me(userId: string): Promise<UserSummary & { status: string }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: UserStatus.active, deletedAt: null },
    })
    if (!user) throw new UnauthorizedException('登录状态已失效')
    return { ...this.userSummary(user), status: user.status }
  }

  private async findOrCreateUser(
    identity: ExchangedPlatformIdentity,
    displayName?: string,
  ): Promise<User> {
    const platform = identity.platform as PlatformType
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.platformIdentity.findUnique({
        where: {
          platform_appId_subject: {
            platform,
            appId: identity.appId,
            subject: identity.subject,
          },
        },
        include: { user: true },
      })
      const now = new Date()
      if (existing) {
        if (existing.user.status !== UserStatus.active) {
          throw new UnauthorizedException('账号不可用')
        }
        return tx.user.update({
          where: { id: existing.userId },
          data: {
            lastLoginAt: now,
            ...(displayName && !existing.user.displayName ? { displayName } : {}),
          },
        })
      }
      return tx.user.create({
        data: {
          displayName,
          lastLoginAt: now,
          identities: {
            create: {
              platform,
              appId: identity.appId,
              subject: identity.subject,
              unionSubject: identity.unionSubject,
            },
          },
        },
      })
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'CONFLICT', message: '登录请求冲突，请重试' })
      }
      throw error
    })
  }

  private async createSession(user: User, platform: ApiPlatformType): Promise<AuthSession> {
    const refreshToken = this.tokens.issueRefreshToken()
    const refreshExpiresAt = new Date(
      Date.now() + this.config.get('JWT_REFRESH_TTL_SECONDS', { infer: true }) * 1000,
    )
    await this.prisma.refreshSession.create({
      data: {
        userId: user.id,
        familyId: this.tokens.newFamilyId(),
        tokenHash: this.tokens.hashRefreshToken(refreshToken),
        platform: platform as PlatformType,
        expiresAt: refreshExpiresAt,
      },
    })
    return this.sessionResponse(user, platform as PlatformType, refreshToken, refreshExpiresAt)
  }

  private sessionResponse(
    user: User,
    _platform: PlatformType,
    refreshToken: string,
    refreshExpiresAt: Date,
  ): AuthSession {
    const access = this.tokens.issueAccessToken(user.id)
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
      user: this.userSummary(user),
    }
  }

  private userSummary(user: User): UserSummary {
    return { id: user.id, displayName: user.displayName, avatarUrl: null }
  }
}
