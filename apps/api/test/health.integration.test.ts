import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { healthResponseSchema } from '@baby-mp/contracts'

describe('health API', () => {
  let app: INestApplication

  beforeAll(async () => {
    process.env.APP_ENV = 'test'
    process.env.APP_VERSION = '0.1.0-test'
    const { createApiApplication } = await import('../src/app-bootstrap')
    app = await createApiApplication()
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns the shared health response contract without authentication', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)

    expect(healthResponseSchema.parse(response.body)).toEqual({
      data: { status: 'ok', version: '0.1.0-test' },
    })
    expect(response.headers['x-request-id']).toMatch(/^req_[0-9a-f-]+$/)
  })

  it('preserves a safe caller request ID', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', 'req_client-123')
      .expect(200)

    expect(response.headers['x-request-id']).toBe('req_client-123')
  })

  it('provides a liveness alias with restrictive API headers', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200)

    expect(response.body.data.status).toBe('ok')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['x-frame-options']).toBe('DENY')
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('hides internal metrics when no monitoring token is configured', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/metrics')
      .expect(404)

    expect(JSON.stringify(response.body)).not.toMatch(
      /exportQueue|database|bucket|token/i,
    )
  })

  it('rejects JSON bodies above the configured limit before business handling', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/platform-login')
      .send({ platform: 'wechat', code: 'x'.repeat(300_000) })
      .expect(413)

    expect(response.body.error.code).toBe('VALIDATION_FAILED')
    expect(response.body.error.requestId).toMatch(/^req_[0-9a-f-]+$/)
    expect(response.headers['x-request-id']).toBe(
      response.body.error.requestId,
    )
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(JSON.stringify(response.body)).not.toMatch(/stack|exception/i)
  })

  it('returns the standard error shape without framework details', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/not-found')
      .expect(404)

    expect(response.body).toEqual({
      error: {
        code: 'RESOURCE_NOT_FOUND',
        message: 'Cannot GET /api/v1/not-found',
        requestId: response.headers['x-request-id'],
      },
    })
    expect(JSON.stringify(response.body)).not.toMatch(/stack|exception|sql/i)
  })
})
