import type { PlatformType } from '@baby-mp/contracts'

export const PLATFORM_IDENTITY_EXCHANGE = Symbol('PLATFORM_IDENTITY_EXCHANGE')

export interface ExchangedPlatformIdentity {
  platform: PlatformType
  appId: string
  subject: string
  unionSubject?: string
}

export interface PlatformIdentityExchange {
  /** Exchanges a temporary platform credential. Implementations must never log or persist the code. */
  exchange(platform: PlatformType, code: string): Promise<ExchangedPlatformIdentity>
}
