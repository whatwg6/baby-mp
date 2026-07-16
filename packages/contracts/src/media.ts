import { z } from 'zod'

export const mediaStatusSchema = z.enum(['pending', 'uploaded', 'ready', 'failed', 'deleted'])

export const mediaSchema = z.object({
  id: z.string().uuid(),
  mimeType: z.string().min(1),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  sizeBytes: z.number().int().positive(),
  status: mediaStatusSchema,
  accessUrl: z.string().url().nullable(),
  sortOrder: z.number().int().min(0).optional(),
})

export const createMediaUploadInputSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(['image/jpeg', 'image/png']),
  sizeBytes: z.number().int().positive().max(20 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
})

export const completeMediaUploadInputSchema = z.object({
  width: z.number().int().positive().max(20_000),
  height: z.number().int().positive().max(20_000),
})

export const mediaUploadResponseSchema = z.object({
  data: z.object({
    mediaId: z.string().uuid(),
    upload: z.object({
      method: z.literal('PUT'),
      url: z.string().url(),
      headers: z.record(z.string()),
      expiresAt: z.string().datetime(),
    }),
  }),
})

export type MediaStatus = z.infer<typeof mediaStatusSchema>
export type Media = z.infer<typeof mediaSchema>
export type CreateMediaUploadInput = z.infer<typeof createMediaUploadInputSchema>
export type CompleteMediaUploadInput = z.infer<typeof completeMediaUploadInputSchema>
export type MediaUploadResponse = z.infer<typeof mediaUploadResponseSchema>
