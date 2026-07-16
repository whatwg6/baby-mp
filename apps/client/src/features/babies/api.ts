import { babySchema, successResponseSchema } from '@baby-mp/contracts'

import { createApiClient } from '../../services/api-client'
import type { BabyInput } from './types'

const babyResponseSchema = successResponseSchema(babySchema)
const babyListSchema = successResponseSchema(babySchema.array())

export async function listBabies() {
  return (await createApiClient().request({ path: '/api/v1/babies', schema: babyListSchema })).data
}

export async function getBaby(id: string) {
  return (await createApiClient().request({ path: `/api/v1/babies/${id}`, schema: babyResponseSchema })).data
}

export async function createBaby(input: BabyInput, idempotencyKey: string) {
  return (await createApiClient().request({
    path: '/api/v1/babies', method: 'POST', body: input, idempotencyKey, schema: babyResponseSchema,
  })).data
}

export async function updateBaby(id: string, input: BabyInput & { version: number }) {
  return (await createApiClient().request({
    path: `/api/v1/babies/${id}`, method: 'PATCH', body: input, schema: babyResponseSchema,
  })).data
}
