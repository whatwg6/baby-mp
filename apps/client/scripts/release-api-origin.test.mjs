import { describe, expect, it } from 'vitest'

import { resolveExpectedReleaseApiOrigin } from './release-api-origin.mjs'

describe('release API origin gate', () => {
  it('accepts only an exact public HTTPS origin', () => {
    expect(resolveExpectedReleaseApiOrigin({
      EXPECTED_RELEASE_API_ORIGIN: 'https://api.baby-growth.cn',
    })).toBe('https://api.baby-growth.cn')
  })

  it('allows a reserved .invalid origin only behind the explicit CI switch', () => {
    const origin = 'https://api.example.invalid'
    expect(() => resolveExpectedReleaseApiOrigin({ EXPECTED_RELEASE_API_ORIGIN: origin })).toThrow()
    expect(resolveExpectedReleaseApiOrigin({
      EXPECTED_RELEASE_API_ORIGIN: origin,
      CI: 'true',
      ALLOW_TEST_RELEASE_API_ORIGIN: 'true',
    })).toBe(origin)
  })

  it.each([
    undefined,
    'http://api.baby-growth.cn',
    'https://api.baby-growth.cn/v1',
    'https://api.example.com',
    'https://api.staging.example',
    'https://localhost',
    'https://127.0.0.1',
    'https://10.0.0.1',
    'https://172.16.0.1',
    'https://192.168.1.1',
    'https://203.0.113.20',
    'https://[::1]',
    'https://[fd00::1]',
  ])('rejects a non-release origin: %s', (origin) => {
    expect(() => resolveExpectedReleaseApiOrigin({
      EXPECTED_RELEASE_API_ORIGIN: origin,
    })).toThrow()
  })
})
