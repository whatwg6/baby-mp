import type { GrowthPoint, GrowthSeries } from '@baby-mp/contracts'

import type { getBabyContext } from '../babies/store'

type BabyContext = ReturnType<typeof getBabyContext>

export interface GrowthViewState {
  series?: GrowthSeries
  selected?: GrowthPoint
  allHistoryFallback: boolean
}

export function resetGrowthViewForBaby(): GrowthViewState {
  return {
    series: undefined,
    selected: undefined,
    allHistoryFallback: false,
  }
}

export function isGrowthResponseCurrent(
  requestRevision: number,
  currentRevision: number,
  requestContext: BabyContext,
  latestContext: BabyContext,
): boolean {
  return requestRevision === currentRevision
    && requestContext.babyId === latestContext.babyId
    && requestContext.generation === latestContext.generation
}
