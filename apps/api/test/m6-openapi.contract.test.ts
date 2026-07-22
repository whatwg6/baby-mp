import type { INestApplication } from '@nestjs/common'
import type { OpenAPIObject } from '@nestjs/swagger'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

describe('M6 export OpenAPI contract', () => {
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

  it('documents idempotent creation and admin collection pagination', () => {
    const collection = document.paths['/api/v1/babies/{babyId}/exports']
    expect(collection?.post?.parameters).toContainEqual(expect.objectContaining({
      in: 'header', name: 'Idempotency-Key', required: true,
    }))
    expect(collection?.post?.requestBody).toHaveProperty('content.application/json.schema.$ref')
    expect(collection?.post?.responses['201']).toHaveProperty('content.application/json.schema.$ref')
    expect(collection?.get?.responses['200']).toHaveProperty('content.application/json.schema.$ref')
  })

  it('keeps signed URLs on a dedicated POST and out of list/detail operations', () => {
    const detail = document.paths['/api/v1/exports/{exportId}']?.get
    const download = document.paths['/api/v1/exports/{exportId}/download-url']?.post
    expect(detail?.responses['200']).toHaveProperty('content.application/json.schema.$ref')
    expect(download?.responses['200']).toHaveProperty('content.application/json.schema.$ref')
    expect(document.paths['/api/v1/exports/{exportId}/download-url']?.get).toBeUndefined()
  })

  it('publishes concrete export DTO schemas without storage internals', () => {
    expect(document.components?.schemas).toMatchObject({
      CreateExportDto: expect.any(Object),
      ExportJobDto: expect.any(Object),
      ExportResponseDto: expect.any(Object),
      ExportListResponseDto: expect.any(Object),
      ExportDownloadResponseDto: expect.any(Object),
    })
    const serialized = JSON.stringify(document.components?.schemas?.ExportJobDto)
    expect(serialized).not.toContain('objectKey')
    expect(serialized).not.toContain('resultMediaId')
  })
})
