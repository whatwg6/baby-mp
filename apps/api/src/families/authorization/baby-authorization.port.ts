export type BabyMemberRole = 'admin' | 'editor' | 'viewer'

export const BABY_RESOURCE_RESOLVER = Symbol('BABY_RESOURCE_RESOLVER')
export const BABY_MEMBERSHIP_REPOSITORY = Symbol('BABY_MEMBERSHIP_REPOSITORY')

export interface BabyResourceContext {
  babyId: string
}

/**
 * Resolves baby ownership from server-side route/resource lookup.
 * Resource-only routes must load the resource and derive babyId here; they must
 * never authorize against a client-supplied role or ownership claim.
 */
export interface BabyResourceResolver {
  resolve(request: unknown): Promise<BabyResourceContext | null>
}

export interface ActiveBabyMembership {
  babyId: string
  userId: string
  role: BabyMemberRole
}

export interface BabyMembershipRepository {
  /** Must query current active membership on every protected request. */
  findActiveMembership(userId: string, babyId: string): Promise<ActiveBabyMembership | null>
}
