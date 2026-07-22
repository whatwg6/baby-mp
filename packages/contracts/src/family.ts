import { z } from 'zod'

import { babySchema } from './babies'

export const familyRoleSchema = z.enum(['admin', 'editor', 'viewer'])
export const inviteRoleSchema = z.enum(['editor', 'viewer'])
export const memberStatusSchema = z.enum(['active', 'removed'])
export const inviteStatusSchema = z.enum(['pending', 'accepted', 'revoked', 'expired'])

export const familyUserSummarySchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1).max(80),
  avatarUrl: z.string().url().nullable(),
})

export const familyMemberSchema = z.object({
  id: z.string().uuid(),
  user: familyUserSummarySchema,
  role: familyRoleSchema,
  status: memberStatusSchema,
  joinedAt: z.string().datetime(),
  version: z.number().int().positive(),
  isCurrentUser: z.boolean(),
})

export const familyInviteSchema = z.object({
  id: z.string().uuid(),
  role: inviteRoleSchema,
  status: inviteStatusSchema,
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  inviter: familyUserSummarySchema,
})

export const createdFamilyInviteSchema = familyInviteSchema.extend({
  token: z.string().min(32),
  sharePath: z.string().startsWith('/pages/family/invite?token='),
})

export const invitePreviewSchema = z.object({
  baby: z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(40),
    avatarUrl: z.string().url().nullable(),
  }),
  inviter: familyUserSummarySchema,
  role: inviteRoleSchema,
  status: inviteStatusSchema,
  expiresAt: z.string().datetime(),
})

export const acceptedInviteSchema = z.object({
  baby: babySchema,
  member: familyMemberSchema,
})

export type FamilyRole = z.infer<typeof familyRoleSchema>
export type InviteRole = z.infer<typeof inviteRoleSchema>
export type FamilyMember = z.infer<typeof familyMemberSchema>
export type FamilyInvite = z.infer<typeof familyInviteSchema>
export type CreatedFamilyInvite = z.infer<typeof createdFamilyInviteSchema>
export type InvitePreview = z.infer<typeof invitePreviewSchema>
export type AcceptedInvite = z.infer<typeof acceptedInviteSchema>
