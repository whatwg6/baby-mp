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
  signal?: AbortSignal
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
  /** Cancels the transport, retry delay and any auth replay for this request. */
  signal?: AbortSignal
  /** GET requests retry transient failures by default. Mutations are never auto-retried. */
  retry?: boolean
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
const DEFAULT_GET_RETRY_DELAYS_MS = [250, 750] as const

function abortError() {
  const error = new Error('请求已取消')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError()
}

function wait(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    throwIfAborted(signal)
    const done = () => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    const timer = setTimeout(done, milliseconds)
    const abort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(abortError())
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

function isTransientStatus(statusCode: number) {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500
}

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
  throwIfAborted(options.signal)
  const { signal, ...requestOptions } = options
  const task = Taro.request({
    ...requestOptions,
    data: requestOptions.data as string | Record<string, unknown> | ArrayBuffer | undefined,
  })
  const abort = () => task.abort()
  signal?.addEventListener('abort', abort, { once: true })

  try {
    const response = await task
    return { statusCode: response.statusCode, data: response.data }
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}

export function createApiClient(
  baseUrl = getApiBaseUrl(),
  transport: RequestTransport = taroTransport,
  clientOptions: { getRetryDelaysMs?: readonly number[] } = {},
) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  const getRetryDelaysMs = clientOptions.getRetryDelaysMs ?? DEFAULT_GET_RETRY_DELAYS_MS

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
      signal,
      retry = true,
    }: ApiRequestOptions<T>): Promise<T> {
      try {
        const sendOnce = (token?: string) => {
          throwIfAborted(signal)
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
            signal,
          })
        }

        const send = async (token?: string) => {
          const delays = method === 'GET' && retry ? getRetryDelaysMs : []
          for (let attempt = 0; ; attempt += 1) {
            try {
              const response = await sendOnce(token)
              if (!isTransientStatus(response.statusCode) || attempt >= delays.length) return response
            } catch (error) {
              throwIfAborted(signal)
              if (attempt >= delays.length) throw error
            }
            await wait(delays[attempt] ?? 0, signal)
          }
        }

        const initialToken = skipAuth ? undefined : (accessToken ?? authSessionAdapter?.getAccessToken())
        let response = await send(initialToken)

        if (response.statusCode === 401 && !skipRefresh && authSessionAdapter) {
          throwIfAborted(signal)
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
