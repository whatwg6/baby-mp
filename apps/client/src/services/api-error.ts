import { errorResponseSchema, type ApiErrorCode, type ApiErrorDetail } from '@baby-mp/contracts'

export interface ApiClientErrorOptions {
  code: ApiErrorCode
  status?: number
  requestId?: string
  details?: ApiErrorDetail[]
  cause?: unknown
}

export class ApiClientError extends Error {
  readonly code: ApiErrorCode
  readonly status?: number
  readonly requestId?: string
  readonly details?: ApiErrorDetail[]

  constructor(message: string, options: ApiClientErrorOptions) {
    super(message, { cause: options.cause })
    this.name = 'ApiClientError'
    this.code = options.code
    this.status = options.status
    this.requestId = options.requestId
    this.details = options.details
  }
}

export function isResourceAccessError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError &&
    (error.status === 403 || error.status === 404)
}

export function mapApiError(payload: unknown, status?: number): ApiClientError {
  const parsed = errorResponseSchema.safeParse(payload)

  if (parsed.success) {
    const { code, message, requestId, details } = parsed.data.error
    return new ApiClientError(message, { code, status, requestId, details })
  }

  return new ApiClientError('服务暂时不可用，请稍后重试', {
    code: status === 401 ? 'AUTH_REQUIRED' : 'INTERNAL_ERROR',
    status,
  })
}

export function mapNetworkError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error
  if (error instanceof Error && error.name === 'AbortError') {
    return new ApiClientError('请求已取消', {
      code: 'INTERNAL_ERROR',
      cause: error,
    })
  }

  return new ApiClientError('无法连接服务，请检查网络后重试', {
    code: 'INTERNAL_ERROR',
    cause: error,
  })
}
