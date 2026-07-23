import { mediaSchema, mediaUploadResponseSchema, successResponseSchema } from '@baby-mp/contracts'

import { createApiClient } from '../../services/api-client'

const mediaResponseSchema = successResponseSchema(mediaSchema)

const emptySchema = { safeParse: () => ({ success: true as const, data: null }) }

export async function createMediaUpload(babyId: string, input: {
  fileName: string
  mimeType: string
  sizeBytes: number
  sha256?: string
}, signal?: AbortSignal) {
  return (await createApiClient().request({
    path: `/api/v1/babies/${babyId}/media/uploads`,
    method: 'POST',
    body: input,
    schema: mediaUploadResponseSchema,
    signal,
  })).data
}

export async function completeMedia(mediaId: string, dimensions: { width: number; height: number }, signal?: AbortSignal) {
  return (await createApiClient().request({
    path: `/api/v1/media/${mediaId}/complete`,
    method: 'POST',
    body: dimensions,
    schema: mediaResponseSchema,
    signal,
  })).data
}

export async function getMedia(mediaId: string, signal?: AbortSignal) {
  return (await createApiClient().request({
    path: `/api/v1/media/${mediaId}`,
    schema: mediaResponseSchema,
    signal,
  })).data
}

export async function abandonMedia(mediaId: string) {
  await createApiClient().request({
    path: `/api/v1/media/${mediaId}`,
    method: 'DELETE',
    schema: emptySchema,
  })
}
