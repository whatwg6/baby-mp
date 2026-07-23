import type { INestApplication } from '@nestjs/common'
import type { OpenAPIObject } from '@nestjs/swagger'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

describe('M3 OpenAPI contract', () => {
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

  it('documents private media upload, completion, access and abandon operations', () => {
    const upload = document.paths['/api/v1/babies/{babyId}/media/uploads']?.post
    expect(upload?.parameters).toContainEqual(expect.objectContaining({
      in: 'path', name: 'babyId', required: true,
      schema: expect.objectContaining({ format: 'uuid' }),
    }))
    expect(upload?.requestBody).toHaveProperty('content.application/json.schema.$ref')
    expect(upload?.responses['201']).toHaveProperty('content.application/json.schema.$ref')

    const item = document.paths['/api/v1/media/{mediaId}']
    expect(document.paths['/api/v1/media/{mediaId}/complete']?.post?.requestBody)
      .toHaveProperty('content.application/json.schema.$ref')
    expect(item?.get?.responses['200']).toHaveProperty('content.application/json.schema.$ref')
    expect(item?.delete?.responses['204']).toBeDefined()
  })

  it('documents timeline, idempotent create and versioned record lifecycle', () => {
    const collection = document.paths['/api/v1/babies/{babyId}/records']
    expect(collection?.get?.responses['200']).toHaveProperty('content.application/json.schema.$ref')
    expect(collection?.post?.parameters).toContainEqual(expect.objectContaining({
      in: 'header', name: 'Idempotency-Key', required: true,
      schema: expect.objectContaining({ format: 'uuid' }),
    }))
    expect(collection?.post?.requestBody).toHaveProperty('content.application/json.schema.$ref')
    expect(collection?.post?.responses['201']).toHaveProperty('content.application/json.schema.$ref')

    const item = document.paths['/api/v1/records/{recordId}']
    expect(item?.get?.responses['200']).toHaveProperty('content.application/json.schema.$ref')
    expect(item?.patch?.requestBody).toHaveProperty('content.application/json.schema.$ref')
    expect(item?.delete?.parameters).toContainEqual(expect.objectContaining({
      in: 'query', name: 'version', required: true,
    }))
  })

  it('publishes reusable M3 schemas', () => {
    expect(document.components?.schemas).toMatchObject({
      CreateMediaUploadDto: expect.any(Object),
      MediaDto: expect.any(Object),
      CreateRecordDto: expect.any(Object),
      RecordDto: expect.any(Object),
      TimelineResponseDto: expect.any(Object),
      UpdateRecordDto: expect.any(Object),
    })
  })
})
