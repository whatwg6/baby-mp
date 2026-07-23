import type { ExportJob, ExportStatus } from '@baby-mp/contracts'

export const exportStatusLabels: Record<ExportStatus, string> = {
  pending: '等待处理',
  processing: '正在生成',
  completed: '可下载',
  failed: '生成失败',
  expired: '已过期',
}

const safeFailureLabels: Record<string, string> = {
  GENERATION_FAILED: '生成导出包时发生错误',
  MEDIA_UNAVAILABLE: '部分照片暂时无法读取',
  STORAGE_UNAVAILABLE: '文件存储暂时不可用',
}

export function effectiveExportStatus(job: ExportJob, now = Date.now()): ExportStatus {
  if (job.status === 'completed' && job.expiresAt && Date.parse(job.expiresAt) <= now) return 'expired'
  return job.status
}

export function exportFailureMessage(errorCode: string | null) {
  return errorCode && safeFailureLabels[errorCode]
    ? safeFailureLabels[errorCode]
    : '导出未能完成，请重新创建任务。'
}

export function formatExportTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
