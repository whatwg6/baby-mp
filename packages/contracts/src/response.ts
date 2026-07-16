import { z } from 'zod'

export interface SuccessResponse<T> {
  data: T
}

export const successResponseSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    data,
  })

export const apiErrorCodeSchema = z.enum([
  'AUTH_REQUIRED',
  'REFRESH_TOKEN_INVALID',
  'FORBIDDEN',
  'RESOURCE_NOT_FOUND',
  'VALIDATION_FAILED',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'CONFLICT',
  'UPLOAD_INCOMPLETE',
  'UPLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'INTERNAL_ERROR',
])

export const apiErrorDetailSchema = z.object({
  field: z.string().optional(),
  reason: z.string().min(1),
})

export const errorResponseSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string().min(1),
    requestId: z.string().min(1),
    details: z.array(apiErrorDetailSchema).optional(),
  }),
})

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>
export type ApiErrorDetail = z.infer<typeof apiErrorDetailSchema>
export type ErrorResponse = z.infer<typeof errorResponseSchema>
