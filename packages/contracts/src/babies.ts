import { z } from 'zod'

export const babyGenderSchema = z.enum(['male', 'female', 'unspecified'])
export const babyRoleSchema = z.enum(['admin', 'editor', 'viewer'])
export const babySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(40),
  gender: babyGenderSchema,
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  birthTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  birthHeightCm: z.number().nullable(),
  birthWeightKg: z.number().nullable(),
  avatarUrl: z.string().url().nullable(),
  role: babyRoleSchema,
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Baby = z.infer<typeof babySchema>
