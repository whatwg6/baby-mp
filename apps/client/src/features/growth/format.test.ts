import { describe, expect, it } from 'vitest'

import { formatGrowthValue, sampleGrowthPoints, twelveMonthsAgo } from './format'

describe('growth display utilities', () => {
  it('preserves metric precision without inventing trailing zeroes', () => {
    expect(formatGrowthValue(68.2, 'height')).toBe('68.2')
    expect(formatGrowthValue(68.256, 'height')).toBe('68.26')
    expect(formatGrowthValue(7.8564, 'weight')).toBe('7.856')
  })

  it('subtracts twelve calendar months safely across leap years', () => {
    expect(twelveMonthsAgo(new Date('2024-02-29T08:00:00.000Z'))).toBe('2023-02-28T08:00:00.000Z')
  })

  it('samples dense charts while retaining the first and last data point', () => {
    const points = Array.from({ length: 500 }, (_, index) => ({
      recordId: `${index}`, occurredAt: new Date(2020, 0, index + 1).toISOString(), value: index,
    }))
    const sampled = sampleGrowthPoints(points, 100)
    expect(sampled).toHaveLength(100)
    expect(sampled[0]).toBe(points[0])
    expect(sampled.at(-1)).toBe(points.at(-1))
  })
})
