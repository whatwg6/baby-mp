import { describe, expect, it, vi } from 'vitest'

import { createIdempotencyKey } from './idempotency-key'

const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('createIdempotencyKey', () => {
  it('returns an RFC 4122 UUID accepted by the API contract', () => {
    expect(createIdempotencyKey()).toMatch(uuidV4Pattern)
  })

  it('keeps the UUID shape when randomUUID is unavailable', () => {
    const originalCrypto = globalThis.crypto
    vi.stubGlobal('crypto', undefined)
    try {
      expect(createIdempotencyKey()).toMatch(uuidV4Pattern)
    } finally {
      vi.stubGlobal('crypto', originalCrypto)
    }
  })
})
