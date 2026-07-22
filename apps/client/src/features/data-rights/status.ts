import type {
  DataRightsRequestStatus,
  DataRightsRequestType,
} from '@baby-mp/contracts'

const TYPE_LABELS: Record<DataRightsRequestType, string> = {
  account_deletion: '账号注销申请',
  data_access: '数据访问申请',
  correction: '数据更正申请',
}

const STATUS_LABELS: Record<DataRightsRequestStatus, string> = {
  pending: '待人工核验',
  processing: '处理中',
  completed: '已完成',
  rejected: '未通过',
  cancelled: '已取消',
}

export function dataRightsTypeLabel(type: DataRightsRequestType): string {
  return TYPE_LABELS[type]
}

export function dataRightsStatusLabel(status: DataRightsRequestStatus): string {
  return STATUS_LABELS[status]
}

export function dataRightsConfirmation(
  type: DataRightsRequestType,
  babyName?: string,
): string {
  const scope = type === 'account_deletion'
    ? '整个账号'
    : babyName
      ? `当前宝宝“${babyName}”`
      : '整个账号'
  return `确认提交${dataRightsTypeLabel(type)}？范围为${scope}。提交后只会记录为待人工核验，不代表数据已删除或更改。`
}
