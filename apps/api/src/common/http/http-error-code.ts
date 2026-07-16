import { HttpStatus } from '@nestjs/common'

import type { ApiErrorCode } from '@baby-mp/contracts'

export function errorCodeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_FAILED'
    case HttpStatus.UNAUTHORIZED:
      return 'AUTH_REQUIRED'
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN'
    case HttpStatus.NOT_FOUND:
      return 'RESOURCE_NOT_FOUND'
    case HttpStatus.CONFLICT:
      return 'IDEMPOTENCY_CONFLICT'
    default:
      return 'INTERNAL_ERROR'
  }
}
