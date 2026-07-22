import { z } from 'zod'

export const exportStatusSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'failed',
  'expired',
])

export const exportFormatSchema = z.literal('zip')

export const createExportInputSchema = z.object({
  includeMedia: z.boolean(),
  format: exportFormatSchema,
})

export const exportJobSchema = z.object({
  id: z.string().uuid(),
  babyId: z.string().uuid(),
  status: exportStatusSchema,
  includeMedia: z.boolean(),
  format: exportFormatSchema,
  errorCode: z.string().max(80).nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  // A normal list/detail response must never expose a signed URL.
  downloadUrl: z.null().optional(),
})

export const exportResponseSchema = z.object({ data: exportJobSchema })

export const exportListQuerySchema = z.object({
  cursor: z.string().min(1).max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export const exportListResponseSchema = z.object({
  data: z.array(exportJobSchema),
  meta: z.object({ nextCursor: z.string().nullable() }),
})

export const exportDownloadSchema = z.object({
  data: z.object({
    downloadUrl: z.string().url(),
    expiresAt: z.string().datetime(),
  }),
})

export type ExportStatus = z.infer<typeof exportStatusSchema>
export type ExportFormat = z.infer<typeof exportFormatSchema>
export type CreateExportInput = z.infer<typeof createExportInputSchema>
export type ExportJob = z.infer<typeof exportJobSchema>
export type ExportListQuery = z.infer<typeof exportListQuerySchema>
export type ExportListResponse = z.infer<typeof exportListResponseSchema>
export type ExportDownload = z.infer<typeof exportDownloadSchema>
