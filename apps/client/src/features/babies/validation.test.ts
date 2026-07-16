import { describe, expect, it } from 'vitest'

import { formatBabyAge, validateBabyForm, type BabyFormValues } from './validation'

const valid: BabyFormValues = {
  name: ' 小满 ', gender: 'unspecified', birthDate: '2025-12-01', birthTime: '08:30',
  birthHeightCm: '50.25', birthWeightKg: '3.425',
}

describe('baby form validation', () => {
  it('accepts documented boundary-compatible values', () => {
    expect(validateBabyForm(valid, '2026-07-17')).toEqual({})
  })

  it('rejects empty names, future dates and out-of-range measurements', () => {
    expect(validateBabyForm({ ...valid, name: ' ', birthDate: '2026-07-18', birthHeightCm: '19.9', birthWeightKg: '300.001' }, '2026-07-17')).toMatchObject({
      name: expect.any(String), birthDate: expect.any(String), birthHeightCm: expect.any(String), birthWeightKg: expect.any(String),
    })
  })

  it('formats month age and year-month age without rounding up early', () => {
    expect(formatBabyAge('2026-05-20', new Date(2026, 6, 17))).toBe('1 个月')
    expect(formatBabyAge('2024-04-10', new Date(2026, 6, 17))).toBe('2 岁 3 个月')
  })
})
