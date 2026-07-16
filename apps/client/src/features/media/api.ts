import { mediaSchema, mediaUploadResponseSchema, successResponseSchema } from '@baby-mp/contracts'

import { createApiClient } from '../../services/api-client'

const mediaResponseSchema = successResponseSchema(mediaSchema)

const emptySchema = { safeParse: () => ({ success: true as const, data: null }) }

export async function createMediaUpload(babyId: string, input: {
  fileName: string
  mimeType: string
  sizeBytes: number
  sha256?: string
}) {
  return (await createApiClient().request({
    path: `/api/v1/babies/${babyId}/media/uploads`,
    method: 'POST',
    body: input,
    schema: mediaUploadResponseSchema,
  })).data
}

export async function completeMedia(mediaId: string, dimensions: { width: number; height: number }) {
  return (await createApiClient().request({
    path: `/api/v1/media/${mediaId}/complete`,
    method: 'POST',
    body: dimensions,
    schema: mediaResponseSchema,
  })).data
}

export async function getMedia(mediaId: string) {
  return (await createApiClient().request({
    path: `/api/v1/media/${mediaId}`,
    schema: mediaResponseSchema,
  })).data
}

export async function abandonMedia(mediaId: string) {
  await createApiClient().request({
    path: `/api/v1/media/${mediaId}`,
    method: 'DELETE',
    schema: emptySchema,
  })
}
