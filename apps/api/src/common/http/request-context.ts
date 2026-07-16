import type { Request } from 'express'

export const REQUEST_ID_HEADER = 'x-request-id'

export interface RequestWithContext extends Request {
  requestId?: string
  user?: AuthenticatedUser
}

export interface AuthenticatedUser {
  id: string
}

export function requestIdFrom(request: RequestWithContext): string {
  return request.requestId ?? 'unknown'
}
