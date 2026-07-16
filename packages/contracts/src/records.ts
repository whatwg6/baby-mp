import { z } from 'zod'

import { mediaSchema } from './media'

export const recordTypeSchema = z.enum(['note', 'measurement', 'milestone'])

export const measurementSchema = z.object({
  heightCm: z.number().min(20).max(250).multipleOf(0.01).nullable().optional(),
  weightKg: z.number().min(0.2).max(300).multipleOf(0.001).nullable().optional(),
}).refine((value) => value.heightCm != null || value.weightKg != null, {
  message: '身高或体重至少填写一项',
})

const recordWriteBase = {
  occurredAt: z.string().datetime({ offset: true }),
  mediaIds: z.array(z.string().uuid()).max(9).default([]),
}

export const createRecordInputSchema = z.discriminatedUnion('type', [
  z.object({
    ...recordWriteBase,
    type: z.literal('note'),
    content: z.string().trim().max(2_000).nullable().optional(),
  }),
  z.object({
    ...recordWriteBase,
    type: z.literal('measurement'),
    content: z.string().trim().max(500).nullable().optional(),
    measurement: measurementSchema,
  }),
  z.object({
    ...recordWriteBase,
    type: z.literal('milestone'),
    title: z.string().trim().min(1).max(60),
    content: z.string().trim().max(2_000).nullable().optional(),
  }),
]).superRefine((value, context) => {
  if (value.type === 'note' && !value.content?.trim() && value.mediaIds.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '图文记录必须包含正文或图片' })
  }
  if (new Set(value.mediaIds).size !== value.mediaIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['mediaIds'], message: '图片不能重复关联' })
  }
})

export const updateRecordInputSchema = z.object({
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(60).nullable().optional(),
  content: z.string().trim().max(2_000).nullable().optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  mediaIds: z.array(z.string().uuid()).max(9).optional(),
  measurement: measurementSchema.optional(),
}).superRefine((value, context) => {
  if (value.mediaIds && new Set(value.mediaIds).size !== value.mediaIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['mediaIds'], message: '图片不能重复关联' })
  }
})

export const recordSchema = z.object({
  id: z.string().uuid(),
  babyId: z.string().uuid(),
  type: recordTypeSchema,
  title: z.string().nullable(),
  content: z.string().nullable(),
  occurredAt: z.string().datetime(),
  measurement: measurementSchema.nullable(),
  media: z.array(mediaSchema.extend({ sortOrder: z.number().int().min(0) })),
  createdBy: z.object({
    id: z.string().uuid(),
    displayName: z.string().nullable(),
    avatarUrl: z.string().url().nullable(),
  }),
  permissions: z.object({
    canEdit: z.boolean(),
    canDelete: z.boolean(),
  }),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const timelineQuerySchema = z.object({
  type: recordTypeSchema.optional(),
  cursor: z.string().min(1).max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  startAt: z.string().datetime({ offset: true }).optional(),
  endAt: z.string().datetime({ offset: true }).optional(),
}).refine((value) => !value.startAt || !value.endAt || new Date(value.startAt) <= new Date(value.endAt), {
  message: 'startAt 不能晚于 endAt',
})

export const timelineResponseSchema = z.object({
  data: z.array(recordSchema),
  meta: z.object({ nextCursor: z.string().nullable() }),
})

export type RecordType = z.infer<typeof recordTypeSchema>
export type Measurement = z.infer<typeof measurementSchema>
export type CreateRecordInput = z.infer<typeof createRecordInputSchema>
export type UpdateRecordInput = z.infer<typeof updateRecordInputSchema>
export type Record = z.infer<typeof recordSchema>
export type TimelineQuery = z.infer<typeof timelineQuerySchema>
export type TimelineResponse = z.infer<typeof timelineResponseSchema>
