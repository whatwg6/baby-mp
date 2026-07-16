import type { AuthenticatedUser } from '../common/http/request-context'

export const AUTHENTICATION_RESOLVER = Symbol('AUTHENTICATION_RESOLVER')

export interface AuthenticationResolver {
  /**
   * Resolves the current business user from a bearer credential.
   * Implementations must not put roles or baby ownership claims into this result.
   */
  resolve(accessToken: string): Promise<AuthenticatedUser | null>
}
