import { z } from 'zod'

export const DISPLAY_NAME_MIN_LENGTH = 1
export const DISPLAY_NAME_MAX_LENGTH = 80
export const displayNameSchema = z.string().trim()
  .refine((value) => [...value].length >= DISPLAY_NAME_MIN_LENGTH, 'display name is required')
  .refine((value) => [...value].length <= DISPLAY_NAME_MAX_LENGTH, 'display name is too long')
export const platformTypeSchema = z.enum(['wechat_mini', 'alipay_mini', 'douyin_mini', 'h5'])
export const userSummarySchema = z.object({
  id: z.string().uuid(),
  displayName: displayNameSchema.nullable(),
  avatarUrl: z.string().url().nullable(),
})
export const updateCurrentUserInputSchema = z.object({
  displayName: displayNameSchema,
}).strict()
export const authSessionSchema = z.object({
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.string().datetime(),
  refreshToken: z.string().min(1),
  refreshTokenExpiresAt: z.string().datetime(),
  user: userSummarySchema,
})
export type PlatformType = z.infer<typeof platformTypeSchema>
export type UserSummary = z.infer<typeof userSummarySchema>
export type UpdateCurrentUserInput = z.infer<typeof updateCurrentUserInputSchema>
export type AuthSession = z.infer<typeof authSessionSchema>
