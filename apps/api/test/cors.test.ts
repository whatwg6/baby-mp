import { describe, expect, it } from 'vitest'

import { isCorsOriginAllowed } from '../src/app-bootstrap'

describe('CORS origin policy', () => {
  const configuredOrigins = ['http://localhost:10086', 'https://app.example.com']

  it('allows configured origins and requests without an origin', () => {
    expect(isCorsOriginAllowed(undefined, 'production', configuredOrigins)).toBe(true)
    expect(
      isCorsOriginAllowed('https://app.example.com', 'production', configuredOrigins),
    ).toBe(true)
  })

  it('allows loopback and RFC1918 H5 origins only in local development', () => {
    for (const origin of [
      'http://127.0.0.1:10086',
      'http://10.0.0.8:10086',
      'http://172.16.1.2:10086',
      'http://172.31.255.254:10086',
      'http://192.168.0.140:10086',
    ]) {
      expect(isCorsOriginAllowed(origin, 'local', configuredOrigins)).toBe(true)
      expect(isCorsOriginAllowed(origin, 'production', configuredOrigins)).toBe(false)
    }
  })

  it('rejects public, malformed, and non-HTTP origins that are not configured', () => {
    for (const origin of [
      'http://172.32.0.1:10086',
      'https://public.example.com',
      'file://192.168.0.140/client',
      'not-an-origin',
    ]) {
      expect(isCorsOriginAllowed(origin, 'local', configuredOrigins)).toBe(false)
    }
  })
})
