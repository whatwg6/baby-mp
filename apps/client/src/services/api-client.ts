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
}

const DEFAULT_TIMEOUT_MS = 10_000

export function getApiBaseUrl(envValue = process.env.TARO_APP_API_BASE_URL): string {
  const value = envValue?.trim().replace(/\/+$/, '')
  if (!value) {
    throw new ApiClientError('客户端 API 地址未配置', { code: 'INTERNAL_ERROR' })
  }
  return value
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
    }: ApiRequestOptions<T>): Promise<T> {
      const header: Record<string, string> = { Accept: 'application/json' }
      if (body !== undefined) header['Content-Type'] = 'application/json'
      if (accessToken) header.Authorization = `Bearer ${accessToken}`
      if (idempotencyKey) header['Idempotency-Key'] = idempotencyKey

      try {
        const response = await transport({
          url: `${normalizedBaseUrl}${path}`,
          method,
          data: body,
          header,
          timeout: DEFAULT_TIMEOUT_MS,
        })

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
