import type { INestApplication } from '@nestjs/common'
import type { OpenAPIObject } from '@nestjs/swagger'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

describe('M5 family OpenAPI contract', () => {
  let app: INestApplication
  let document: OpenAPIObject

  beforeAll(async () => {
    process.env.APP_ENV = 'test'
    const [{ createApiApplication }, { createOpenApiDocument }] = await Promise.all([
      import('../src/app-bootstrap'), import('../src/openapi/openapi'),
    ])
    app = await createApiApplication(); await app.init(); document = createOpenApiDocument(app)
  })
  afterAll(async () => { await app.close() })

  it('documents member list, optimistic role update, and versioned removal', () => {
    const collection = document.paths['/api/v1/babies/{babyId}/members']
    expect(collection?.get?.responses['200']).toHaveProperty('content.application/json.schema.$ref')
    const member = document.paths['/api/v1/babies/{babyId}/members/{memberId}']
    expect(member?.patch?.requestBody).toHaveProperty('content.application/json.schema.$ref')
    expect(member?.patch?.responses['200']).toHaveProperty('content.application/json.schema.$ref')
    expect(member?.delete?.parameters).toContainEqual(expect.objectContaining({ in: 'query', name: 'version', required: true }))
    expect(member?.delete?.responses['204']).toBeDefined()
    const membership = document.paths['/api/v1/babies/{babyId}/membership']
    expect(membership?.delete?.parameters).toContainEqual(expect.objectContaining({ in: 'query', name: 'version', required: true }))
    expect(membership?.delete?.responses['204']).toBeDefined()
  })

  it('keeps raw invite tokens in JSON bodies, never API URL parameters', () => {
    for (const path of ['/api/v1/invites/preview', '/api/v1/invites/accept'] as const) {
      const operation = document.paths[path]?.post
      expect(operation?.requestBody).toHaveProperty('content.application/json.schema.$ref')
      expect(operation?.parameters ?? []).not.toContainEqual(expect.objectContaining({ name: 'token' }))
      expect(operation?.responses['200']).toHaveProperty('content.application/json.schema.$ref')
    }
    expect(document.paths['/api/v1/invites/{token}']).toBeUndefined()
  })

  it('documents idempotent invite creation/acceptance and invite revocation/listing', () => {
    const invites = document.paths['/api/v1/babies/{babyId}/invites']
    expect(invites?.post?.parameters).toContainEqual(expect.objectContaining({ in: 'header', name: 'Idempotency-Key', required: true }))
    expect(invites?.post?.requestBody).toHaveProperty('content.application/json.schema.$ref')
    expect(invites?.post?.responses['201']).toHaveProperty('content.application/json.schema.$ref')
    expect(invites?.get?.responses['200']).toHaveProperty('content.application/json.schema.$ref')
    expect(document.paths['/api/v1/invites/accept']?.post?.parameters).toContainEqual(expect.objectContaining({ in: 'header', name: 'Idempotency-Key', required: true }))
    expect(document.paths['/api/v1/babies/{babyId}/invites/{inviteId}']?.delete?.responses['204']).toBeDefined()
  })

  it('publishes concrete family response schemas', () => {
    expect(document.components?.schemas).toMatchObject({
      FamilyMemberDto: expect.any(Object), FamilyMemberResponseDto: expect.any(Object),
      FamilyMemberListResponseDto: expect.any(Object), CreatedFamilyInviteResponseDto: expect.any(Object),
      InvitePreviewResponseDto: expect.any(Object), AcceptedInviteSuccessResponseDto: expect.any(Object),
    })
  })
})
