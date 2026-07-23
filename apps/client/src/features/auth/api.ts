import {
  authSessionSchema,
  successResponseSchema,
  updateCurrentUserInputSchema,
  userSummarySchema,
} from '@baby-mp/contracts'

import { createApiClient } from '../../services/api-client'
import { runtimeSchema } from '../../services/runtime-schema'
import type { Session, UserSummary } from './types'

const sessionResponseSchema = successResponseSchema(authSessionSchema)
const userSummaryResponseSchema = successResponseSchema(userSummarySchema)
const emptyResponseSchema = runtimeSchema<undefined>((value): value is undefined => value == null || value === '')

export async function platformLogin(code: string): Promise<Session> {
  const response = await createApiClient().request({
    path: '/api/v1/auth/platform-login', method: 'POST',
    body: { platform: process.env.TARO_ENV === 'weapp' ? 'wechat_mini' : 'h5', code },
    schema: sessionResponseSchema, skipAuth: true, skipRefresh: true,
  })
  return response.data
}

export async function refreshSession(refreshToken: string): Promise<Session> {
  const response = await createApiClient().request({
    path: '/api/v1/auth/refresh', method: 'POST', body: { refreshToken },
    schema: sessionResponseSchema, skipAuth: true, skipRefresh: true,
  })
  return response.data
}

export async function revokeSession(refreshToken: string): Promise<void> {
  await createApiClient().request({
    path: '/api/v1/auth/logout', method: 'POST', body: { refreshToken },
    schema: emptyResponseSchema, skipRefresh: true,
  })
}

export async function updateCurrentUser(displayName: string): Promise<UserSummary> {
  const input = updateCurrentUserInputSchema.parse({ displayName })
  const response = await createApiClient().request({
    path: '/api/v1/users/me', method: 'PATCH', body: input,
    schema: userSummaryResponseSchema,
  })
  return response.data
}
