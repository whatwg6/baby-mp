import type { INestApplication } from '@nestjs/common'
import type { OpenAPIObject } from '@nestjs/swagger'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

describe('M7 privacy OpenAPI contract', () => {
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

  afterAll(async () => { await app.close() })

  it('documents self-leave with optimistic version protection', () => {
    const operation = document.paths['/api/v1/babies/{babyId}/membership']?.delete
    expect(operation?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ in: 'path', name: 'babyId', required: true }),
      expect.objectContaining({ in: 'query', name: 'version', required: true }),
    ]))
    expect(operation?.responses['204']).toBeDefined()
    expect(operation?.responses['409']).toBeDefined()
  })

  it('documents private data-rights creation, listing and cancellation', () => {
    const collection = document.paths['/api/v1/me/data-rights-requests']
    expect(collection?.get?.responses['200']).toHaveProperty('content.application/json.schema.$ref')
    expect(collection?.post?.requestBody).toHaveProperty('content.application/json.schema.$ref')
    expect(collection?.post?.responses['201']).toHaveProperty('content.application/json.schema.$ref')

    const cancellation = document.paths['/api/v1/me/data-rights-requests/{requestId}']?.delete
    expect(cancellation?.parameters).toContainEqual(expect.objectContaining({
      in: 'path', name: 'requestId', required: true,
    }))
    expect(cancellation?.responses['204']).toBeDefined()
    expect(cancellation?.responses['404']).toBeDefined()
  })

  it('publishes concrete data-rights schemas without internal active keys', () => {
    expect(document.components?.schemas).toMatchObject({
      CreateDataRightsRequestDto: expect.any(Object),
      DataRightsRequestDto: expect.any(Object),
      DataRightsRequestResponseDto: expect.any(Object),
      DataRightsRequestListResponseDto: expect.any(Object),
    })
    const serialized = JSON.stringify(document.components?.schemas?.DataRightsRequestDto)
    expect(serialized).not.toContain('activeRequestKey')
    expect(serialized).not.toContain('requesterUserId')
  })
})
