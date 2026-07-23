import { z } from 'zod'

export const growthMetricSchema = z.enum(['height', 'weight'])

export const growthQuerySchema = z.object({
  metric: growthMetricSchema,
  startAt: z.string().datetime({ offset: true }).optional(),
  endAt: z.string().datetime({ offset: true }).optional(),
}).refine((value) => (
  !value.startAt || !value.endAt || Date.parse(value.startAt) <= Date.parse(value.endAt)
), { message: 'startAt 不能晚于 endAt', path: ['startAt'] })

export const growthPointSchema = z.object({
  recordId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  value: z.number().positive(),
})

export const growthSeriesSchema = z.object({
  metric: growthMetricSchema,
  unit: z.enum(['cm', 'kg']),
  points: z.array(growthPointSchema),
}).superRefine((value, context) => {
  const expectedUnit = value.metric === 'height' ? 'cm' : 'kg'
  if (value.unit !== expectedUnit) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['unit'], message: '指标与单位不匹配' })
  }
})

export const growthResponseSchema = z.object({ data: growthSeriesSchema })

export type GrowthMetric = z.infer<typeof growthMetricSchema>
export type GrowthQuery = z.infer<typeof growthQuerySchema>
export type GrowthPoint = z.infer<typeof growthPointSchema>
export type GrowthSeries = z.infer<typeof growthSeriesSchema>
export type GrowthResponse = z.infer<typeof growthResponseSchema>
