import { Image, Text, View } from '@tarojs/components'

import type { GrowthRecord } from './types'

import './record-card.scss'

const labels = { note: '图文', measurement: '测量', milestone: '里程碑' }

export function formatOccurredAt(value: string) {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function RecordCard({ record, onClick }: { record: GrowthRecord; onClick: () => void }) {
  const measurement = record.measurement
  const summary = record.type === 'measurement'
    ? [measurement?.heightCm != null ? `${measurement.heightCm} cm` : '', measurement?.weightKg != null ? `${measurement.weightKg} kg` : ''].filter(Boolean).join(' · ')
    : record.type === 'milestone' ? record.title : record.content

  return <View className="record-card" onClick={onClick}>
    <View className="record-card__body">
      <View className="record-card__heading"><Text className={`record-card__type record-card__type--${record.type}`}>{labels[record.type]}</Text><Text className="record-card__time">{formatOccurredAt(record.occurredAt)}</Text></View>
      <Text className="record-card__summary">{summary || '一张成长照片'}</Text>
      <Text className="record-card__author">由 {record.createdBy.displayName || '家庭成员'} 记录</Text>
    </View>
    {record.media[0]?.accessUrl ? <Image className="record-card__cover" src={record.media[0].accessUrl || ''} mode="aspectFill" /> : null}
  </View>
}
