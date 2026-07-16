import { z } from 'zod'

import { successResponseSchema } from './response'

export const healthDataSchema = z.object({
  status: z.literal('ok'),
  version: z.string().min(1),
})

export const healthResponseSchema = successResponseSchema(healthDataSchema)

export type HealthData = z.infer<typeof healthDataSchema>
export type HealthResponse = z.infer<typeof healthResponseSchema>
