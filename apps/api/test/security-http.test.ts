import { HttpException, Logger } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { describe, expect, it, vi } from 'vitest'

import { ApiExceptionFilter } from '../src/common/http/api-exception.filter'
import {
  INTERNAL_TOKEN_HEADER,
  matchesInternalToken,
} from '../src/common/security/internal-token'
import { SecurityHeadersMiddleware } from '../src/common/security/security-headers.middleware'
import type { Environment } from '../src/config/environment'

describe('HTTP security controls', () => {
  it('sets restrictive API headers and HSTS outside local/test', () => {
    const config = {
      get: vi.fn(() => 'production'),
    } as unknown as ConfigService<Environment, true>
    const middleware = new SecurityHeadersMiddleware(config)
    const response = { setHeader: vi.fn() }
    const next = vi.fn()

    middleware.use({ path: '/api/v1/health' } as never, response as never, next)

    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    )
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-Content-Type-Options',
      'nosniff',
    )
    expect(response.setHeader).toHaveBeenCalledWith(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    )
    expect(next).toHaveBeenCalledOnce()
  })

  it('allows only the resources required by the protected Swagger UI', () => {
    const config = {
      get: vi.fn(() => 'local'),
    } as unknown as ConfigService<Environment, true>
    const middleware = new SecurityHeadersMiddleware(config)
    const response = { setHeader: vi.fn() }
    const next = vi.fn()

    middleware.use(
      { path: '/api/docs/swagger-ui.css' } as never,
      response as never,
      next,
    )

    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
    )
    expect(next).toHaveBeenCalledOnce()
  })

  it('uses constant-time internal token comparison and rejects absent tokens', () => {
    const token = 'monitoring-token-with-at-least-32-characters'
    expect(INTERNAL_TOKEN_HEADER).toBe('x-internal-monitoring-token')
    expect(matchesInternalToken(token, token)).toBe(true)
    expect(matchesInternalToken('wrong', token)).toBe(false)
    expect(matchesInternalToken(undefined, undefined)).toBe(false)
  })

  it('logs a route template and stable code for 5xx without UUID or error message', () => {
    const error = new HttpException(
      { code: 'INTERNAL_ERROR', message: 'storage secret sentinel' },
      500,
    )
    const requestId = 'req-safe'
    const request = {
      method: 'GET',
      path: '/babies/11111111-1111-4111-8111-111111111111/exports',
      route: { path: '/babies/:babyId/exports' },
      requestId,
    }
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    }
    const host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    }
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined)

    new ApiExceptionFilter().catch(error, host as never)

    const output = String(log.mock.calls[0]?.[0])
    expect(JSON.parse(output)).toMatchObject({
      route: '/api/v1/babies/:babyId/exports',
      errorCode: 'INTERNAL_ERROR',
      errorType: 'HttpException',
    })
    expect(output).not.toContain('11111111-1111-4111-8111-111111111111')
    expect(output).not.toContain('storage secret sentinel')
  })
})
