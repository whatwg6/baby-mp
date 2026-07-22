import { describe, expect, it } from 'vitest'

import { API_ERROR_CODES, apiErrorCodeSchema } from '../src'

describe('API error codes', () => {
  it('uses one exported value set for runtime validation and API documentation', () => {
    expect(apiErrorCodeSchema.options).toEqual([...API_ERROR_CODES])
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length)
  })
})
