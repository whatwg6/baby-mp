import { z } from 'zod'

export const dataRightsRequestTypeSchema = z.enum([
  'account_deletion',
  'data_access',
  'correction',
])

export const dataRightsRequestStatusSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'rejected',
  'cancelled',
])

export const createDataRightsRequestInputSchema = z
  .object({
    type: dataRightsRequestTypeSchema,
    babyId: z.string().uuid().nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.type === 'account_deletion' && value.babyId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Account deletion requests cannot target a baby',
        path: ['babyId'],
      })
    }
  })

export const dataRightsRequestSchema = z.object({
  id: z.string().uuid(),
  type: dataRightsRequestTypeSchema,
  status: dataRightsRequestStatusSchema,
  babyId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
})

export const dataRightsRequestResponseSchema = z.object({
  data: dataRightsRequestSchema,
})

export const dataRightsRequestListResponseSchema = z.object({
  data: z.array(dataRightsRequestSchema),
})

export type DataRightsRequestType = z.infer<typeof dataRightsRequestTypeSchema>
export type DataRightsRequestStatus = z.infer<typeof dataRightsRequestStatusSchema>
export type CreateDataRightsRequestInput = z.infer<
  typeof createDataRightsRequestInputSchema
>
export type DataRightsRequest = z.infer<typeof dataRightsRequestSchema>
