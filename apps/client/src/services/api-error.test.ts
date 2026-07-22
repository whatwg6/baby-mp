import { describe, expect, it } from 'vitest'

import { isResourceAccessError, mapApiError, mapNetworkError } from './api-error'

describe('API error mapping', () => {
  it('preserves structured details', () => {
    const error = mapApiError(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: '提交内容有误',
          requestId: 'req_validation',
          details: [{ field: 'name', reason: '不能为空' }],
        },
      },
      400,
    )

    expect(error).toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
      requestId: 'req_validation',
      details: [{ field: 'name', reason: '不能为空' }],
    })
  })

  it('uses a safe message for malformed and network errors', () => {
    expect(mapApiError('<html>bad gateway</html>', 502).message).toBe('服务暂时不可用，请稍后重试')
    expect(mapNetworkError(new Error('socket details')).message).toBe('无法连接服务，请检查网络后重试')
  })

  it('identifies access-loss responses that require cached baby data to be cleared', () => {
    expect(isResourceAccessError(mapApiError({
      error: { code: 'RESOURCE_NOT_FOUND', message: '资源不存在', requestId: 'req_missing' },
    }, 404))).toBe(true)
    expect(isResourceAccessError(mapApiError({
      error: { code: 'FORBIDDEN', message: '无权访问', requestId: 'req_forbidden' },
    }, 403))).toBe(true)
    expect(isResourceAccessError(mapApiError({
      error: { code: 'INTERNAL_ERROR', message: '服务异常', requestId: 'req_error' },
    }, 500))).toBe(false)
  })
})
