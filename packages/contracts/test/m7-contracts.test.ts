import { describe, expect, it } from 'vitest'

import {
  createDataRightsRequestInputSchema,
  dataRightsRequestListResponseSchema,
  dataRightsRequestResponseSchema,
} from '../src'

const request = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'data_access',
  status: 'pending',
  babyId: '22222222-2222-4222-8222-222222222222',
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  resolvedAt: null,
}

describe('M7 data-rights contracts', () => {
  it('accepts account and authorized baby-scoped request shapes', () => {
    expect(createDataRightsRequestInputSchema.safeParse({
      type: 'account_deletion',
    }).success).toBe(true)
    expect(createDataRightsRequestInputSchema.safeParse({
      type: 'correction',
      babyId: request.babyId,
    }).success).toBe(true)
  })

  it('rejects a baby scope for account deletion', () => {
    expect(createDataRightsRequestInputSchema.safeParse({
      type: 'account_deletion',
      babyId: request.babyId,
    }).success).toBe(false)
  })

  it('validates single and list response envelopes', () => {
    expect(dataRightsRequestResponseSchema.safeParse({ data: request }).success).toBe(true)
    expect(dataRightsRequestListResponseSchema.safeParse({ data: [request] }).success).toBe(true)
  })
})
