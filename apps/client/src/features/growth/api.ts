import { growthResponseSchema, type GrowthMetric } from '@baby-mp/contracts'

import { createApiClient } from '../../services/api-client'

export async function getGrowthSeries(babyId: string, options: {
  metric: GrowthMetric
  startAt?: string
  endAt?: string
}) {
  const query = new URLSearchParams({ metric: options.metric })
  if (options.startAt) query.set('startAt', options.startAt)
  if (options.endAt) query.set('endAt', options.endAt)
  return (await createApiClient().request({
    path: `/api/v1/babies/${babyId}/growth/measurements?${query.toString()}`,
    schema: growthResponseSchema,
  })).data
}
