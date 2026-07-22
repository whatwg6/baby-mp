import { Text, View } from '@tarojs/components'

import type { ExportJob } from '@baby-mp/contracts'

import { effectiveExportStatus, exportStatusLabels, formatExportTime } from './status'

import './export-card.scss'

export function ExportCard({ job, onClick }: { job: ExportJob; onClick: () => void }) {
  const status = effectiveExportStatus(job)
  return <View className="export-card" onClick={onClick}>
    <View className="export-card__body">
      <View className="export-card__heading"><Text className="export-card__title">成长数据导出</Text><Text className={`export-card__status export-card__status--${status}`}>{exportStatusLabels[status]}</Text></View>
      <Text className="export-card__meta">创建于 {formatExportTime(job.createdAt)}</Text>
      <Text className="export-card__meta">档案与全部记录 · {job.includeMedia ? '包含照片' : '不包含照片'}</Text>
      {status === 'completed' && job.expiresAt ? <Text className="export-card__expiry">下载有效期至 {formatExportTime(job.expiresAt)}</Text> : null}
    </View>
    <Text className="export-card__arrow">›</Text>
  </View>
}
