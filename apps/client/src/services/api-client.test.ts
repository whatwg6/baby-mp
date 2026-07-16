import { healthResponseSchema } from '@baby-mp/contracts'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tarojs/taro', () => ({
  default: { request: vi.fn() },
}))

import { afterEach } from 'vitest'

import { configureApiAuth, createApiClient, getApiBaseUrl, type RequestTransport } from './api-client'
import { ApiClientError } from './api-error'

describe('API client', () => {
  afterEach(() => configureApiAuth(undefined))
  it('builds the request and validates a health response', async () => {
    const transport = vi.fn<RequestTransport>().mockResolvedValue({
      statusCode: 200,
      data: { data: { status: 'ok', version: '0.1.0' } },
    })
    const client = createApiClient('http://localhost:3000/', transport)

    await expect(client.request({ path: '/api/v1/health', schema: healthResponseSchema })).resolves.toEqual({
      data: { status: 'ok', version: '0.1.0' },
    })
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://localhost:3000/api/v1/health', method: 'GET' }),
    )
  })

  it('maps a standard server error without relying on its message', async () => {
    const transport = vi.fn<RequestTransport>().mockResolvedValue({
      statusCode: 403,
      data: { error: { code: 'FORBIDDEN', message: '无权访问', requestId: 'req_test' } },
    })
    const client = createApiClient('http://localhost:3000', transport)

    const error = await client
      .request({ path: '/api/v1/health', schema: healthResponseSchema })
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(ApiClientError)
    expect(error).toMatchObject({ code: 'FORBIDDEN', status: 403, requestId: 'req_test' })
  })

  it('rejects a success payload that violates the shared contract', async () => {
    const transport = vi.fn<RequestTransport>().mockResolvedValue({
      statusCode: 200,
      data: { data: { status: 'up', version: '' } },
    })
    const client = createApiClient('http://localhost:3000', transport)

    await expect(client.request({ path: '/api/v1/health', schema: healthResponseSchema })).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    })
  })

  it('derives the local API URL from the H5 hostname in development', () => {
    expect(
      getApiBaseUrl('  ', {
        nodeEnv: 'development',
        taroEnv: 'h5',
        location: { hostname: '192.168.0.140', protocol: 'http:' },
      }),
    ).toBe('http://192.168.0.140:3000')
  })

  it('requires explicit configuration outside H5 development', () => {
    expect(() =>
      getApiBaseUrl('  ', {
        nodeEnv: 'production',
        taroEnv: 'h5',
        location: { hostname: 'app.example.com', protocol: 'https:' },
      }),
    ).toThrow('客户端 API 地址未配置')

    expect(() =>
      getApiBaseUrl('  ', { nodeEnv: 'development', taroEnv: 'weapp' }),
    ).toThrow('客户端 API 地址未配置')

    expect(() =>
      getApiBaseUrl('  ', { nodeEnv: 'development', taroEnv: 'h5' }),
    ).toThrow('客户端 API 地址未配置')
  })

  it('refreshes once after a 401 and retries with the rotated access token', async () => {
    const transport = vi.fn<RequestTransport>()
      .mockResolvedValueOnce({ statusCode: 401, data: { error: { code: 'AUTH_REQUIRED', message: 'expired' } } })
      .mockResolvedValueOnce({ statusCode: 200, data: { data: { status: 'ok', version: '0.1.0' } } })
    const refresh = vi.fn().mockResolvedValue('new-token')
    configureApiAuth({ getAccessToken: () => 'old-token', refresh, onAuthFailure: vi.fn() })

    await createApiClient('http://localhost:3000', transport).request({
      path: '/api/v1/health', schema: healthResponseSchema,
    })

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(transport).toHaveBeenNthCalledWith(2, expect.objectContaining({
      header: expect.objectContaining({ Authorization: 'Bearer new-token' }),
    }))
  })
})
