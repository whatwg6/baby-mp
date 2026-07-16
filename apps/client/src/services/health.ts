import { healthResponseSchema, type HealthResponse } from '@baby-mp/contracts'

import { createApiClient } from './api-client'

export function fetchHealth(): Promise<HealthResponse> {
  return createApiClient().request({
    path: '/api/v1/health',
    schema: healthResponseSchema,
  })
}
