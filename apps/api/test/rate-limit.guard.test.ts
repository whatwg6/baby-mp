import type { ExecutionContext } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { describe, expect, it, vi } from 'vitest'

import { RateLimitGuard } from '../src/common/security/rate-limit.guard'
import { OperationalMetricsService } from '../src/common/observability/operational-metrics.service'
import { RATE_LIMIT_POLICY } from '../src/common/security/rate-limit.decorator'
import { AuthController } from '../src/auth/auth.controller'
import { FamiliesController } from '../src/families/families.controller'
import { MediaController } from '../src/media/media.controller'
import type { Environment } from '../src/config/environment'

function executionContext(headers: Record<string, string> = {}): ExecutionContext {
  const response = { setHeader: vi.fn() }
  const request = {
    ip: '192.0.2.4',
    socket: {},
    header: (name: string) => headers[name],
  }
  return {
    getClass: () => class AuthController {},
    getHandler: () => function login() {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext
}

function guard(maximum = 2): RateLimitGuard {
  const reflector = {
    getAllAndOverride: vi.fn(() => 'login'),
  } as unknown as Reflector
  const config = {
    get: vi.fn((key: keyof Environment) =>
      key === 'RATE_LIMIT_WINDOW_SECONDS' ? 60 : maximum,
    ),
  } as unknown as ConfigService<Environment, true>
  return new RateLimitGuard(
    reflector,
    config,
    new OperationalMetricsService(),
  )
}

describe('RateLimitGuard', () => {
  it('covers every high-risk login, invite, and upload authorization route', () => {
    const policy = (target: (...args: never[]) => unknown) =>
      Reflect.getMetadata(RATE_LIMIT_POLICY, target)

    expect(policy(AuthController.prototype.platformLogin as never)).toBe('login')
    expect(policy(AuthController.prototype.mockLogin as never)).toBe('login')
    expect(policy(FamiliesController.prototype.createInvite as never)).toBe(
      'invite',
    )
    expect(policy(FamiliesController.prototype.preview as never)).toBe('invite')
    expect(policy(FamiliesController.prototype.accept as never)).toBe('invite')
    expect(policy(MediaController.prototype.createUpload as never)).toBe(
      'upload',
    )
    expect(policy(MediaController.prototype.complete as never)).toBe('upload')
  })

  it('rejects an IP after the configured endpoint limit', () => {
    const limiter = guard()
    expect(limiter.canActivate(executionContext())).toBe(true)
    expect(limiter.canActivate(executionContext())).toBe(true)
    try {
      limiter.canActivate(executionContext())
      throw new Error('Expected rate limit rejection')
    } catch (error) {
      expect((error as { getStatus(): number }).getStatus()).toBe(429)
    }
  })

  it('does not let unverified bearer credentials bypass the source limit', () => {
    const limiter = guard(1)
    expect(
      limiter.canActivate(
        executionContext({ authorization: 'Bearer credential-a' }),
      ),
    ).toBe(true)
    expect(() =>
      limiter.canActivate(
        executionContext({ authorization: 'Bearer credential-b' }),
      ),
    ).toThrow()
  })
})
