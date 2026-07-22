import { SetMetadata } from '@nestjs/common'

export const RATE_LIMIT_POLICY = 'baby-mp:rate-limit-policy'

export type RateLimitPolicy = 'login' | 'invite' | 'upload'

export const RateLimit = (policy: RateLimitPolicy) =>
  SetMetadata(RATE_LIMIT_POLICY, policy)
