import {
  dataRightsRequestListResponseSchema,
  dataRightsRequestResponseSchema,
  type CreateDataRightsRequestInput,
} from '@baby-mp/contracts'

import { createApiClient } from '../../services/api-client'

export async function listDataRightsRequests(signal?: AbortSignal) {
  return (await createApiClient().request({
    path: '/api/v1/me/data-rights-requests',
    schema: dataRightsRequestListResponseSchema,
    signal,
  })).data
}

export async function createDataRightsRequest(input: CreateDataRightsRequestInput) {
  return (await createApiClient().request({
    path: '/api/v1/me/data-rights-requests',
    method: 'POST',
    body: input,
    schema: dataRightsRequestResponseSchema,
  })).data
}

const noContentSchema = {
  safeParse: () => ({ success: true as const, data: null }),
}

export async function cancelDataRightsRequest(requestId: string) {
  await createApiClient().request({
    path: `/api/v1/me/data-rights-requests/${requestId}`,
    method: 'DELETE',
    schema: noContentSchema,
  })
}
