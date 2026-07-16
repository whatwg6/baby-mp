import { healthResponseSchema } from '@baby-mp/contracts'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tarojs/taro', () => ({
  default: { request: vi.fn() },
}))

import { createApiClient, getApiBaseUrl, type RequestTransport } from './api-client'
import { ApiClientError } from './api-error'

describe('API client', () => {
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

  it('requires the API base URL configuration', () => {
    expect(() => getApiBaseUrl('  ')).toThrow('客户端 API 地址未配置')
  })
})
