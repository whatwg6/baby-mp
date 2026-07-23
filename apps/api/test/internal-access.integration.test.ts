import type { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { INTERNAL_TOKEN_HEADER } from '../src/common/security/internal-token'
import { HealthController } from '../src/health/health.controller'
import { HealthService } from '../src/health/health.service'

const internalToken = 'integration-monitoring-token-32-characters'
const originalEnvironment = { ...process.env }

function restoreEnvironment(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key]
  }
  Object.assign(process.env, originalEnvironment)
}

function configureStaging(swaggerEnabled?: boolean): void {
  Object.assign(process.env, {
    APP_ENV: 'staging',
    APP_VERSION: 'traceability-test',
    CORS_ORIGINS: 'https://app.example.com',
    DATABASE_URL: 'postgresql://user:password@db.example.com:5432/baby_mp',
    JWT_ACCESS_SECRET: 'staging-access-secret-value',
    JWT_REFRESH_SECRET: 'staging-refresh-secret-value',
    MOCK_AUTH_ENABLED: 'false',
    WECHAT_APP_ID: 'wx433aecb90d44e9fe',
    WECHAT_APP_SECRET: 'staging-wechat-secret-value',
    INTERNAL_MONITORING_TOKEN: internalToken,
    S3_ENDPOINT: 'https://s3.example.com',
    S3_REGION: 'cn-test-1',
    S3_BUCKET: 'baby-mp-staging',
    S3_ACCESS_KEY: 'staging-access-key',
    S3_SECRET_KEY: 'staging-storage-secret-value',
    S3_FORCE_PATH_STYLE: 'false',
  })
  if (swaggerEnabled === undefined) {
    delete process.env.SWAGGER_ENABLED
  } else {
    process.env.SWAGGER_ENABLED = String(swaggerEnabled)
  }
}

describe('production-like internal HTTP access', () => {
  let createApiApplication: () => Promise<INestApplication>

  beforeAll(async () => {
    configureStaging(false)
    ;({ createApiApplication } = await import('../src/app-bootstrap'))
  })

  afterAll(() => {
    restoreEnvironment()
  })

  it('keeps Swagger at 404 by default in staging', async () => {
    configureStaging()
    const app = await createApiApplication()
    await app.init()
    try {
      await request(app.getHttpServer()).get('/api/docs-json').expect(404)
    } finally {
      await app.close()
    }
  })

  it('requires the internal token when Swagger is explicitly enabled in staging', async () => {
    configureStaging(true)
    vi.resetModules()
    const { createApiApplication: createSwaggerApplication } = await import(
      '../src/app-bootstrap'
    )
    const app = await createSwaggerApplication()
    await app.init()
    try {
      await request(app.getHttpServer()).get('/api/docs-json').expect(404)
      await request(app.getHttpServer())
        .get('/api/docs-json')
        .set(INTERNAL_TOKEN_HEADER, 'incorrect-monitoring-token-32-characters')
        .expect(404)
      const response = await request(app.getHttpServer())
        .get('/api/docs-json')
        .set(INTERNAL_TOKEN_HEADER, internalToken)
        .expect(200)
      expect(response.body).toMatchObject({
        openapi: expect.stringMatching(/^3\./),
        info: { title: 'Baby MP API' },
      })

      const documentation = await request(app.getHttpServer())
        .get('/api/docs')
        .set(INTERNAL_TOKEN_HEADER, internalToken)
        .expect(200)
      expect(documentation.headers['content-security-policy']).toContain(
        "script-src 'self'",
      )
      expect(documentation.headers['content-security-policy']).toContain(
        "style-src 'self' 'unsafe-inline'",
      )

      const stylesheet = await request(app.getHttpServer())
        .get('/api/docs/swagger-ui.css')
        .set(INTERNAL_TOKEN_HEADER, internalToken)
        .expect(200)
      expect(stylesheet.headers['content-security-policy']).toContain(
        "style-src 'self' 'unsafe-inline'",
      )
    } finally {
      await app.close()
    }
  })
})

describe('internal metrics HTTP access', () => {
  let app: INestApplication
  const operationalMetrics = vi.fn(async () => ({
    data: {
      api: { requests: 4, errors5xx: 0, rateLimited: 1 },
      exportQueue: { pending: 2, processing: 1, failed: 0, oldestPendingAgeSeconds: 8 },
      exportWorker: {
        activeInstances: 1,
        unhealthyInstances: 0,
        lastSuccessAt: '2026-07-22T12:00:00.000Z',
        lastSuccessAgeSeconds: 3,
        lastFailureAt: null,
        lastFailureAgeSeconds: null,
      },
      mediaCleanup: {
        activeInstances: 1,
        unhealthyInstances: 0,
        lastSuccessAt: '2026-07-22T11:59:00.000Z',
        lastSuccessAgeSeconds: 63,
        lastFailureAt: null,
        lastFailureAgeSeconds: null,
      },
    },
  }))

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string) =>
              key === 'INTERNAL_MONITORING_TOKEN'
                ? internalToken
                : 'traceability-test'),
          },
        },
        {
          provide: HealthService,
          useValue: { operationalMetrics },
        },
      ],
    }).compile()
    app = module.createNestApplication()
    app.setGlobalPrefix('api/v1')
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns 404 for absent and incorrect internal metrics tokens without reading metrics', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/metrics').expect(404)
    await request(app.getHttpServer())
      .get('/api/v1/health/metrics')
      .set(INTERNAL_TOKEN_HEADER, 'incorrect-monitoring-token-32-characters')
      .expect(404)
    expect(operationalMetrics).not.toHaveBeenCalled()
  })

  it('returns only low-sensitivity aggregate metrics for the correct internal token', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/metrics')
      .set(INTERNAL_TOKEN_HEADER, internalToken)
      .expect(200)

    expect(response.body).toEqual(await operationalMetrics.mock.results[0]?.value)
    expect(JSON.stringify(response.body)).not.toMatch(
      /babyId|objectKey|signed|secret|token/i,
    )
  })
})
