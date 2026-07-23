import {
  exportDownloadSchema,
  exportListResponseSchema,
  exportResponseSchema,
  type CreateExportInput,
} from '@baby-mp/contracts'

import { createApiClient } from '../../services/api-client'

export async function createExport(babyId: string, input: CreateExportInput, idempotencyKey: string) {
  return (await createApiClient().request({
    path: `/api/v1/babies/${babyId}/exports`,
    method: 'POST',
    body: input,
    idempotencyKey,
    schema: exportResponseSchema,
  })).data
}

export async function listExports(babyId: string, options: { cursor?: string; limit?: number } = {}) {
  const query = new URLSearchParams({ limit: String(options.limit ?? 20) })
  if (options.cursor) query.set('cursor', options.cursor)
  return createApiClient().request({
    path: `/api/v1/babies/${babyId}/exports?${query.toString()}`,
    schema: exportListResponseSchema,
  })
}

export async function getExport(exportId: string, signal?: AbortSignal) {
  return (await createApiClient().request({
    path: `/api/v1/exports/${exportId}`,
    schema: exportResponseSchema,
    signal,
  })).data
}

export async function getExportDownload(exportId: string) {
  return (await createApiClient().request({
    path: `/api/v1/exports/${exportId}/download-url`,
    method: 'POST',
    schema: exportDownloadSchema,
  })).data
}
