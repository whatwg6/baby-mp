import { recordSchema, successResponseSchema, timelineResponseSchema } from '@baby-mp/contracts'

import { createApiClient } from '../../services/api-client'
import type { RecordDraftInput, RecordType } from './types'

const recordResponseSchema = successResponseSchema(recordSchema)
const emptySchema = { safeParse: () => ({ success: true as const, data: null }) }

export async function listRecords(babyId: string, options: {
  type?: RecordType
  cursor?: string
  limit?: number
} = {}) {
  const query = new URLSearchParams()
  if (options.type) query.set('type', options.type)
  if (options.cursor) query.set('cursor', options.cursor)
  query.set('limit', String(options.limit ?? 20))
  return createApiClient().request({
    path: `/api/v1/babies/${babyId}/records?${query.toString()}`,
    schema: timelineResponseSchema,
  })
}

export async function getRecord(recordId: string) {
  return (await createApiClient().request({
    path: `/api/v1/records/${recordId}`,
    schema: recordResponseSchema,
  })).data
}

export async function createRecord(babyId: string, input: RecordDraftInput, idempotencyKey: string) {
  return (await createApiClient().request({
    path: `/api/v1/babies/${babyId}/records`,
    method: 'POST',
    body: input,
    idempotencyKey,
    schema: recordResponseSchema,
  })).data
}

export async function updateRecord(recordId: string, input: Omit<RecordDraftInput, 'type'> & { version: number }) {
  return (await createApiClient().request({
    path: `/api/v1/records/${recordId}`,
    method: 'PATCH',
    body: input,
    schema: recordResponseSchema,
  })).data
}

export async function deleteRecord(recordId: string, version: number) {
  await createApiClient().request({
    path: `/api/v1/records/${recordId}?version=${version}`,
    method: 'DELETE',
    schema: emptySchema,
  })
}
