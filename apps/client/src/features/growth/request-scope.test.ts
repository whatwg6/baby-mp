import { describe, expect, it } from 'vitest'

import { isGrowthResponseCurrent, resetGrowthViewForBaby } from './request-scope'

describe('growth request scope', () => {
  it('clears cached growth series and ignores a stale response after switching baby', () => {
    expect(resetGrowthViewForBaby()).toEqual({
      series: undefined,
      selected: undefined,
      allHistoryFallback: false,
    })

    const requestContext = { babyId: 'baby-a', generation: 4 }
    expect(isGrowthResponseCurrent(8, 8, requestContext, requestContext)).toBe(true)
    expect(isGrowthResponseCurrent(8, 8, requestContext, {
      babyId: 'baby-b',
      generation: 5,
    })).toBe(false)
  })
})
