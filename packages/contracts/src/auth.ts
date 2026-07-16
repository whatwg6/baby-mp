import { z } from 'zod'

export const platformTypeSchema = z.enum(['wechat_mini', 'alipay_mini', 'douyin_mini', 'h5'])
export const userSummarySchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
})
export const authSessionSchema = z.object({
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.string().datetime(),
  refreshToken: z.string().min(1),
  refreshTokenExpiresAt: z.string().datetime(),
  user: userSummarySchema,
})
export type PlatformType = z.infer<typeof platformTypeSchema>
export type UserSummary = z.infer<typeof userSummarySchema>
export type AuthSession = z.infer<typeof authSessionSchema>
