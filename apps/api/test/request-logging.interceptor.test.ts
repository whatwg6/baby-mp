import { HttpException, Logger, type CallHandler, type ExecutionContext } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { lastValueFrom, of, throwError } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'

import { RequestLoggingInterceptor } from '../src/common/http/request-logging.interceptor'
import { OperationalMetricsService } from '../src/common/observability/operational-metrics.service'
import type { Environment } from '../src/config/environment'

const secrets = {
  authorization: 'Bearer access-token-sentinel',
  refreshToken: 'refresh-token-sentinel',
  platformCode: 'platform-code-sentinel',
  babyName: '宝宝姓名哨兵',
  signedUrl: 'https://storage.invalid/private?signature=signed-url-sentinel',
}

function context(statusCode = 200): ExecutionContext {
  const request = {
    id: 'request-id-safe',
    method: 'POST',
    path: '/auth/refresh/00000000-0000-4000-8000-000000000000',
    route: { path: '/auth/refresh/:sessionId' },
    headers: { authorization: secrets.authorization },
    body: secrets,
  }
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ statusCode }),
    }),
    getClass: () => class AuthController {},
  } as unknown as ExecutionContext
}

function interceptor() {
  const config = {
    get: vi.fn(() => 'test'),
  } as unknown as ConfigService<Environment, true>
  return new RequestLoggingInterceptor(config, new OperationalMetricsService())
}

describe('RequestLoggingInterceptor', () => {
  it('logs only low-sensitivity request metadata on success', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)

    await lastValueFrom(interceptor().intercept(
      context(201),
      { handle: () => of({ data: secrets }) } as CallHandler,
    ))

    expect(log).toHaveBeenCalledTimes(1)
    const output = String(log.mock.calls[0]?.[0])
    expect(JSON.parse(output)).toMatchObject({
      message: 'request_completed',
      method: 'POST',
      route: '/api/v1/auth/refresh/:sessionId',
      statusCode: 201,
    })
    expect(output).not.toContain('00000000-0000-4000-8000-000000000000')
    for (const sentinel of Object.values(secrets)) expect(output).not.toContain(sentinel)
  })

  it('does not leak error payloads and records the exception status', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const error = new HttpException(secrets, 401)

    await expect(lastValueFrom(interceptor().intercept(
      context(),
      { handle: () => throwError(() => error) } as CallHandler,
    ))).rejects.toBe(error)

    const output = String(log.mock.calls[0]?.[0])
    expect(JSON.parse(output)).toMatchObject({ statusCode: 401 })
    for (const sentinel of Object.values(secrets)) expect(output).not.toContain(sentinel)
  })
})
