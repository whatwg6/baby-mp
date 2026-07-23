import { Text, View } from '@tarojs/components'
import { useEffect, useMemo, useState } from 'react'

import type { GrowthMetric, GrowthPoint } from '@baby-mp/contracts'

import { platform } from '../../platform'
import { formatGrowthDate, formatGrowthValue, sampleGrowthPoints } from './format'

import './growth-chart.scss'

const CHART_HEIGHT = 176
const HORIZONTAL_INSET = 16

export function GrowthChart({
  points,
  metric,
  unit,
  selectedId,
  onSelect,
}: {
  points: GrowthPoint[]
  metric: GrowthMetric
  unit: 'cm' | 'kg'
  selectedId?: string
  onSelect: (point: GrowthPoint) => void
}) {
  const [width, setWidth] = useState(300)
  useEffect(() => {
    void platform.getSystemInfo().then((info) => setWidth(Math.max(240, Math.min(520, info.windowWidth - 64))))
  }, [])
  const sampled = useMemo(() => sampleGrowthPoints(points), [points])
  const values = sampled.map((point) => point.value)
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const spread = maximum - minimum
  const coordinates = sampled.map((point, index) => ({
    point,
    x: sampled.length === 1 ? width / 2 : index * width / (sampled.length - 1),
    y: spread === 0 ? CHART_HEIGHT / 2 : 14 + (maximum - point.value) / spread * (CHART_HEIGHT - 28),
  })).map((coordinate) => ({
    ...coordinate,
    x: sampled.length === 1
      ? coordinate.x
      : HORIZONTAL_INSET + coordinate.x * (width - HORIZONTAL_INSET * 2) / width,
  }))

  if (points.length === 0) return null
  return <View className="growth-chart">
    <View className="growth-chart__scale"><Text>{formatGrowthValue(maximum, metric)} {unit}</Text><Text>{formatGrowthValue(minimum, metric)} {unit}</Text></View>
    <View className="growth-chart__plot" style={{ width: `${width}px`, height: `${CHART_HEIGHT}px` }}>
      {coordinates.slice(1).map((coordinate, index) => {
        const previous = coordinates[index]
        if (!previous) return null
        const dx = coordinate.x - previous.x
        const dy = coordinate.y - previous.y
        const length = Math.sqrt(dx * dx + dy * dy)
        const angle = Math.atan2(dy, dx) * 180 / Math.PI
        return <View key={`line-${coordinate.point.recordId}`} className="growth-chart__line" style={{ left: `${previous.x}px`, top: `${previous.y}px`, width: `${length}px`, transform: `rotate(${angle}deg)` }} />
      })}
      {coordinates.map(({ point, x, y }) => <View key={point.recordId} className={`growth-chart__point${point.recordId === selectedId ? ' is-selected' : ''}`} style={{ left: `${x}px`, top: `${y}px` }} onClick={() => onSelect(point)} />)}
    </View>
    <View className="growth-chart__dates"><Text>{formatGrowthDate(points[0]!.occurredAt)}</Text><Text>{formatGrowthDate(points.at(-1)!.occurredAt)}</Text></View>
    {points.length === 1 ? <Text className="growth-chart__single-note">当前只有一个数据点，仅展示数值，不绘制趋势线。</Text> : null}
    {points.length > sampled.length ? <Text className="growth-chart__sample-note">图表已抽样显示 {sampled.length} 个点，历史列表保留全部 {points.length} 条记录。</Text> : null}
  </View>
}
