import { z } from 'zod'

export interface SuccessResponse<T> {
  data: T
}

export const successResponseSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    data,
  })

export const API_ERROR_CODES = [
  'AUTH_REQUIRED',
  'REFRESH_TOKEN_INVALID',
  'FORBIDDEN',
  'RESOURCE_NOT_FOUND',
  'VALIDATION_FAILED',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'CONFLICT',
  'LAST_ADMIN_REQUIRED',
  'INVITE_INVALID',
  'INVITE_EXPIRED',
  'INVITE_REVOKED',
  'INVITE_ALREADY_USED',
  'ALREADY_A_MEMBER',
  'EXPORT_NOT_READY',
  'EXPORT_EXPIRED',
  'RATE_LIMITED',
  'UPLOAD_INCOMPLETE',
  'UPLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'INTERNAL_ERROR',
] as const

export const apiErrorCodeSchema = z.enum(API_ERROR_CODES)

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
