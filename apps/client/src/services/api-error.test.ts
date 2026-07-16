import { describe, expect, it } from 'vitest'

import { mapApiError, mapNetworkError } from './api-error'

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
})
