import { describe, expect, it } from 'vitest'

import { healthResponseSchema } from '../src'

describe('health contract', () => {
  it('accepts the documented success response', () => {
    const response = {
      data: {
        status: 'ok',
        version: '0.1.0',
      },
    }

    expect(healthResponseSchema.parse(response)).toEqual(response)
  })

  it('rejects a response without the data wrapper', () => {
    expect(() =>
      healthResponseSchema.parse({ status: 'ok', version: '0.1.0' }),
    ).toThrow()
  })
})
