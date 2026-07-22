import type { INestApplication } from '@nestjs/common'
import type { OpenAPIObject } from '@nestjs/swagger'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { API_ERROR_CODES } from '@baby-mp/contracts'

describe('M2 OpenAPI contract', () => {
  let app: INestApplication
  let document: OpenAPIObject

  beforeAll(async () => {
    process.env.APP_ENV = 'test'
    const [{ createApiApplication }, { createOpenApiDocument }] = await Promise.all([
      import('../src/app-bootstrap'),
      import('../src/openapi/openapi'),
    ])
    app = await createApiApplication()
    await app.init()
    document = createOpenApiDocument(app)
  })

  afterAll(async () => {
    await app.close()
  })

  it('documents auth request bodies and structured success and error responses', () => {
    for (const path of [
      '/api/v1/auth/platform-login',
      '/api/v1/auth/mock-login',
      '/api/v1/auth/refresh',
      '/api/v1/auth/logout',
    ]) {
      const operation = document.paths[path]?.post
      expect(operation?.requestBody).toBeDefined()
      expect(operation?.requestBody).toHaveProperty('content.application/json.schema.$ref')
    }

    expect(document.paths['/api/v1/auth/platform-login']?.post?.responses['201'])
      .toHaveProperty('content.application/json.schema.$ref')
    expect(document.paths['/api/v1/auth/refresh']?.post?.responses['401'])
      .toHaveProperty('content.application/json.schema.$ref')
    expect(document.paths['/api/v1/me']?.get?.responses['200'])
      .toHaveProperty('content.application/json.schema.$ref')
    const updateCurrentUser = document.paths['/api/v1/users/me']?.patch
    expect(updateCurrentUser?.requestBody)
      .toHaveProperty('content.application/json.schema.$ref')
    expect(updateCurrentUser?.responses['200'])
      .toHaveProperty('content.application/json.schema.$ref')
    expect(updateCurrentUser?.responses['401'])
      .toHaveProperty('content.application/json.schema.$ref')
  })

  it('documents baby bodies, UUID parameters, idempotency header, and response schemas', () => {
    const collection = document.paths['/api/v1/babies']
    const item = document.paths['/api/v1/babies/{babyId}']
    const createParameters = collection?.post?.parameters ?? []

    expect(collection?.post?.requestBody)
      .toHaveProperty('content.application/json.schema.$ref')
    expect(createParameters).toContainEqual(expect.objectContaining({
      in: 'header',
      name: 'Idempotency-Key',
      required: true,
      schema: expect.objectContaining({ format: 'uuid' }),
    }))
    for (const method of ['get', 'patch', 'delete'] as const) {
      expect(item?.[method]?.parameters).toContainEqual(expect.objectContaining({
        in: 'path',
        name: 'babyId',
        required: true,
        schema: expect.objectContaining({ type: 'string', format: 'uuid' }),
      }))
    }
    expect(item?.get?.responses['200'])
      .toHaveProperty('content.application/json.schema.$ref')
    expect(item?.patch?.responses['200'])
      .toHaveProperty('content.application/json.schema.$ref')
    expect(item?.delete?.responses['204']).toBeDefined()
    expect(item?.patch?.requestBody)
      .toHaveProperty('content.application/json.schema.$ref')
    expect(collection?.get?.responses['200'])
      .toHaveProperty('content.application/json.schema.$ref')
    expect(collection?.post?.responses['201'])
      .toHaveProperty('content.application/json.schema.$ref')
  })

  it('publishes reusable component schemas for M2 payloads', () => {
    const schemas = document.components?.schemas ?? {}
    expect(Object.keys(schemas).length).toBeGreaterThan(0)
    expect(schemas).toMatchObject({
      ApiErrorResponseDto: expect.any(Object),
      AuthSessionResponseDto: expect.any(Object),
      BabyDto: expect.any(Object),
      BabyListResponseDto: expect.any(Object),
      BabyResponseDto: expect.any(Object),
      CreateBabyDto: expect.any(Object),
      UpdateBabyDto: expect.any(Object),
      UpdateCurrentUserDto: expect.any(Object),
      UserSummaryResponseDto: expect.any(Object),
    })
    expect(schemas.UpdateBabyDto).toHaveProperty(
      'properties.avatarMediaId',
      expect.objectContaining({ format: 'uuid', nullable: true }),
    )
    expect(schemas.ApiErrorDto).toHaveProperty(
      'properties.code.enum',
      [...API_ERROR_CODES],
    )
    expect(schemas.UpdateCurrentUserDto).toHaveProperty(
      'properties.displayName',
      expect.objectContaining({ minLength: 1, maxLength: 80 }),
    )
  })
})
