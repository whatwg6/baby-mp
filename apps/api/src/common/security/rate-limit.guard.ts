import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import type { Response } from 'express'

import type { Environment } from '../../config/environment'
import type { RequestWithContext } from '../http/request-context'
import { OperationalMetricsService } from '../observability/operational-metrics.service'
import {
  RATE_LIMIT_POLICY,
  type RateLimitPolicy,
} from './rate-limit.decorator'

interface RateLimitEntry {
  count: number
  expiresAt: number
}

const MAX_RATE_LIMIT_ENTRIES = 50_000

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly entries = new Map<string, RateLimitEntry>()
  private requestsSinceCleanup = 0

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ConfigService)
    private readonly config: ConfigService<Environment, true>,
    @Inject(OperationalMetricsService)
    private readonly metrics: OperationalMetricsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const policy = this.reflector.getAllAndOverride<RateLimitPolicy>(
      RATE_LIMIT_POLICY,
      [context.getHandler(), context.getClass()],
    )
    if (!policy) return true

    const http = context.switchToHttp()
    const request = http.getRequest<RequestWithContext>()
    const response = http.getResponse<Response>()
    const now = Date.now()
    const windowMs =
      this.config.get('RATE_LIMIT_WINDOW_SECONDS', { infer: true }) * 1_000
    const maximum = this.maximum(policy)
    // The global guard runs before authentication guards. Basing this key on an
    // unverified bearer token would let a caller bypass limits by rotating junk
    // credentials, so the trusted-proxy-derived source address is authoritative.
    const principal = `ip:${
      request.ip || request.socket.remoteAddress || 'unknown'
    }`
    const desiredKey = `${policy}:${principal}`
    if (
      !this.entries.has(desiredKey) &&
      this.entries.size >= MAX_RATE_LIMIT_ENTRIES
    ) {
      this.cleanupExpiredEntries(now, true)
    }
    // Prefer safe load shedding over unbounded memory or bypassing limits when
    // an attacker floods the process with distinct source addresses.
    const key =
      this.entries.has(desiredKey) ||
      this.entries.size < MAX_RATE_LIMIT_ENTRIES
        ? desiredKey
        : `${policy}:overflow`
    const current = this.entries.get(key)
    const entry =
      !current || current.expiresAt <= now
        ? { count: 0, expiresAt: now + windowMs }
        : current

    entry.count += 1
    this.entries.set(key, entry)
    this.cleanupExpiredEntries(now)

    const retryAfter = Math.max(1, Math.ceil((entry.expiresAt - now) / 1_000))
    response.setHeader('RateLimit-Limit', maximum)
    response.setHeader('RateLimit-Remaining', Math.max(0, maximum - entry.count))
    response.setHeader('RateLimit-Reset', retryAfter)

    if (entry.count <= maximum) return true

    this.metrics.recordRateLimited()
    response.setHeader('Retry-After', retryAfter)
    throw new HttpException(
      { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后重试' },
      429,
    )
  }

  private maximum(policy: RateLimitPolicy): number {
    const keys: Record<RateLimitPolicy, keyof Environment> = {
      invite: 'RATE_LIMIT_INVITE_MAX',
      login: 'RATE_LIMIT_LOGIN_MAX',
      upload: 'RATE_LIMIT_UPLOAD_MAX',
    }
    return this.config.get(keys[policy], { infer: true }) as number
  }

  private cleanupExpiredEntries(now: number, force = false): void {
    this.requestsSinceCleanup += 1
    if (!force && this.requestsSinceCleanup < 500) return
    this.requestsSinceCleanup = 0
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key)
    }
  }
}
