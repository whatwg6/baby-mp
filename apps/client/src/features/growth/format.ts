import type { GrowthMetric, GrowthPoint } from '@baby-mp/contracts'

export function formatGrowthValue(value: number, metric: GrowthMetric) {
  const maximumDecimals = metric === 'height' ? 2 : 3
  return value.toFixed(maximumDecimals).replace(/\.?0+$/, '')
}

export function formatGrowthDate(value: string) {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function twelveMonthsAgo(now = new Date()) {
  const result = new Date(now)
  const originalDate = result.getDate()
  result.setDate(1)
  result.setMonth(result.getMonth() - 12)
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()
  result.setDate(Math.min(originalDate, lastDay))
  return result.toISOString()
}

/** The API retains every point; only the visual layer samples dense series. */
export function sampleGrowthPoints(points: GrowthPoint[], maximum = 100) {
  if (points.length <= maximum) return points
  if (maximum < 2) return [points[0]].filter((point): point is GrowthPoint => Boolean(point))
  const sampled: GrowthPoint[] = []
  for (let index = 0; index < maximum; index += 1) {
    const sourceIndex = Math.round(index * (points.length - 1) / (maximum - 1))
    const point = points[sourceIndex]
    if (point && sampled.at(-1)?.recordId !== point.recordId) sampled.push(point)
  }
  return sampled
}
