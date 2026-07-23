import {
  acceptedInviteSchema,
  createdFamilyInviteSchema,
  familyInviteSchema,
  familyMemberSchema,
  invitePreviewSchema,
  successResponseSchema,
} from '@baby-mp/contracts'

import { createApiClient } from '../../services/api-client'
import { runtimeSchema } from '../../services/runtime-schema'

const memberListResponse = successResponseSchema(familyMemberSchema.array())
const memberResponse = successResponseSchema(familyMemberSchema)
const inviteListResponse = successResponseSchema(familyInviteSchema.array())
const createdInviteResponse = successResponseSchema(createdFamilyInviteSchema)
const previewResponse = successResponseSchema(invitePreviewSchema)
const acceptedResponse = successResponseSchema(acceptedInviteSchema)
const emptyResponse = runtimeSchema<undefined>((value): value is undefined => value == null || value === '')

export async function listFamilyMembers(babyId: string) {
  return (await createApiClient().request({ path: `/api/v1/babies/${babyId}/members`, schema: memberListResponse })).data
}

export async function listFamilyInvites(babyId: string, status = 'pending') {
  return (await createApiClient().request({ path: `/api/v1/babies/${babyId}/invites?status=${status}`, schema: inviteListResponse })).data
}

export async function createFamilyInvite(babyId: string, role: 'editor' | 'viewer', expiresInHours: number, key: string) {
  return (await createApiClient().request({
    path: `/api/v1/babies/${babyId}/invites`, method: 'POST', body: { role, expiresInHours }, idempotencyKey: key, schema: createdInviteResponse,
  })).data
}

export async function previewFamilyInvite(token: string) {
  return (await createApiClient().request({
    path: '/api/v1/invites/preview', method: 'POST', body: { token }, schema: previewResponse, skipAuth: true, skipRefresh: true,
  })).data
}

export async function acceptFamilyInvite(token: string, key: string) {
  return (await createApiClient().request({
    path: '/api/v1/invites/accept', method: 'POST', body: { token }, idempotencyKey: key, schema: acceptedResponse,
  })).data
}

export async function revokeFamilyInvite(babyId: string, inviteId: string) {
  await createApiClient().request({ path: `/api/v1/babies/${babyId}/invites/${inviteId}`, method: 'DELETE', schema: emptyResponse })
}

export async function updateFamilyMember(babyId: string, memberId: string, version: number, role: 'admin' | 'editor' | 'viewer') {
  return (await createApiClient().request({
    path: `/api/v1/babies/${babyId}/members/${memberId}`, method: 'PATCH', body: { version, role }, schema: memberResponse,
  })).data
}

export async function removeFamilyMember(babyId: string, memberId: string, version: number) {
  await createApiClient().request({ path: `/api/v1/babies/${babyId}/members/${memberId}?version=${version}`, method: 'DELETE', schema: emptyResponse })
}

export async function leaveFamily(babyId: string, version: number) {
  await createApiClient().request({ path: `/api/v1/babies/${babyId}/membership?version=${version}`, method: 'DELETE', schema: emptyResponse })
}
