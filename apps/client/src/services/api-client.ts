import Taro from '@tarojs/taro'

import { ApiClientError, mapApiError, mapNetworkError } from './api-error'

interface RuntimeSchema<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: unknown }
}

export interface TransportResponse {
  statusCode: number
  data: unknown
}

export type RequestTransport = (options: {
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  data?: unknown
  header: Record<string, string>
  timeout: number
}) => Promise<TransportResponse>

export interface ApiRequestOptions<T> {
  path: `/${string}`
  schema: RuntimeSchema<T>
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  accessToken?: string
  idempotencyKey?: string
  /** Public endpoints such as login and refresh must not receive an old token. */
  skipAuth?: boolean
  /** Refresh itself must never recursively trigger another refresh. */
  skipRefresh?: boolean
}

export interface AuthSessionAdapter {
  getAccessToken: () => string | undefined
  refresh: () => Promise<string | undefined>
  onAuthFailure: () => Promise<void> | void
}

let authSessionAdapter: AuthSessionAdapter | undefined

export function configureApiAuth(adapter: AuthSessionAdapter | undefined) {
  authSessionAdapter = adapter
}

const DEFAULT_TIMEOUT_MS = 10_000

interface ApiBaseUrlRuntime {
  nodeEnv?: string
  taroEnv?: string
  location?: Pick<Location, 'hostname' | 'protocol'>
}

function getApiBaseUrlRuntime(): ApiBaseUrlRuntime {
  return {
    nodeEnv: process.env.NODE_ENV,
    taroEnv: process.env.TARO_ENV,
    location: typeof window === 'undefined' ? undefined : window.location,
  }
}

export function getApiBaseUrl(
  envValue = process.env.TARO_APP_API_BASE_URL,
  runtime = getApiBaseUrlRuntime(),
): string {
  const value = envValue?.trim().replace(/\/+$/, '')
  if (value) {
    return value
  }

  if (
    runtime.nodeEnv === 'development' &&
    runtime.taroEnv === 'h5' &&
    runtime.location?.hostname &&
    runtime.location.protocol
  ) {
    return `${runtime.location.protocol}//${runtime.location.hostname}:3000`
  }

  throw new ApiClientError('客户端 API 地址未配置', { code: 'INTERNAL_ERROR' })
}

const taroTransport: RequestTransport = async (options) => {
  const response = await Taro.request({
    ...options,
    data: options.data as string | Record<string, unknown> | ArrayBuffer | undefined,
  })

  return { statusCode: response.statusCode, data: response.data }
}

export function createApiClient(
  baseUrl = getApiBaseUrl(),
  transport: RequestTransport = taroTransport,
) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')

  return {
    async request<T>({
      path,
      schema,
      method = 'GET',
      body,
      accessToken,
      idempotencyKey,
      skipAuth = false,
      skipRefresh = false,
    }: ApiRequestOptions<T>): Promise<T> {
      try {
        const send = (token?: string) => {
          const header: Record<string, string> = { Accept: 'application/json' }
          if (body !== undefined) header['Content-Type'] = 'application/json'
          if (token) header.Authorization = `Bearer ${token}`
          if (idempotencyKey) header['Idempotency-Key'] = idempotencyKey

          return transport({
            url: `${normalizedBaseUrl}${path}`,
            method,
            data: body,
            header,
            timeout: DEFAULT_TIMEOUT_MS,
          })
        }

        const initialToken = skipAuth ? undefined : (accessToken ?? authSessionAdapter?.getAccessToken())
        let response = await send(initialToken)

        if (response.statusCode === 401 && !skipRefresh && authSessionAdapter) {
          const refreshedToken = await authSessionAdapter.refresh()
          if (refreshedToken) response = await send(refreshedToken)
          if (!refreshedToken || response.statusCode === 401) {
            await authSessionAdapter.onAuthFailure()
          }
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw mapApiError(response.data, response.statusCode)
        }

        const parsed = schema.safeParse(response.data)
        if (!parsed.success) {
          throw new ApiClientError('服务返回了无法识别的数据', {
            code: 'INTERNAL_ERROR',
            status: response.statusCode,
            cause: parsed.error,
          })
        }

        return parsed.data
      } catch (error) {
        throw mapNetworkError(error)
      }
    },
  }
}
