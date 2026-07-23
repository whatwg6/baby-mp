import type { RecordDraftInput, RecordFormValues } from './types'

const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/

export type RecordFormField = 'title' | 'content' | 'heightCm' | 'weightKg' | 'media' | 'occurredAt'

export interface RecordValidationIssue {
  field: RecordFormField
  message: string
}

function parseDecimal(value: string, min: number, max: number, decimals: number, label: string) {
  const normalized = value.trim()
  if (!normalized) return undefined
  if (!DECIMAL_PATTERN.test(normalized)) return `${label}必须是普通十进制数字`
  const [, fraction = ''] = normalized.split('.')
  const numeric = Number(normalized)
  if (fraction.length > decimals || numeric < min || numeric > max) {
    return `${label}需在 ${min}–${max} 之间，最多 ${decimals} 位小数`
  }
  return numeric
}

export function validateRecordFormIssue(
  values: RecordFormValues,
  mediaCount: number,
  babyBirthDate?: string,
  babyBirthTime?: string | null,
): RecordValidationIssue | undefined {
  const title = values.title.trim()
  const content = values.content.trim()
  if (!values.occurredAt || Number.isNaN(Date.parse(values.occurredAt))) {
    return { field: 'occurredAt', message: '请选择有效的发生时间' }
  }
  const occurred = Date.parse(values.occurredAt)
  if (occurred > Date.now() + 5 * 60_000) {
    return { field: 'occurredAt', message: '发生时间不能晚于当前时间 5 分钟以上' }
  }
  if (babyBirthDate) {
    const birthLowerBound = Date.parse(`${babyBirthDate}T${babyBirthTime?.trim() || '00:00'}`)
    if (!Number.isNaN(birthLowerBound) && occurred < birthLowerBound) {
      return {
        field: 'occurredAt',
        message: babyBirthTime ? '发生时间不能早于宝宝出生时间' : '发生时间不能早于宝宝出生日期',
      }
    }
  }
  if (mediaCount > 9) return { field: 'media', message: '照片不能超过 9 张' }

  if (values.type === 'note') {
    if (!content && mediaCount === 0) return { field: 'content', message: '正文和照片至少填写一项' }
    if (content.length > 2000) return { field: 'content', message: '正文不能超过 2000 个字符' }
  }
  if (values.type === 'milestone') {
    if (!title) return { field: 'title', message: '请填写里程碑标题' }
    if (title.length > 60) return { field: 'title', message: '里程碑标题不能超过 60 个字符' }
    if (content.length > 2000) return { field: 'content', message: '描述不能超过 2000 个字符' }
  }
  if (values.type === 'measurement') {
    const height = parseDecimal(values.heightCm, 20, 250, 2, '身高')
    const weight = parseDecimal(values.weightKg, 0.2, 300, 3, '体重')
    if (typeof height === 'string') return { field: 'heightCm', message: height }
    if (typeof weight === 'string') return { field: 'weightKg', message: weight }
    if (height === undefined && weight === undefined) return { field: 'heightCm', message: '身高和体重至少填写一项' }
    if (content.length > 500) return { field: 'content', message: '备注不能超过 500 个字符' }
  }
  return undefined
}

export function validateRecordForm(
  values: RecordFormValues,
  mediaCount: number,
  babyBirthDate?: string,
  babyBirthTime?: string | null,
) {
  return validateRecordFormIssue(values, mediaCount, babyBirthDate, babyBirthTime)?.message
}

export function toRecordInput(values: RecordFormValues, mediaIds: string[]): RecordDraftInput {
  const input: RecordDraftInput = {
    type: values.type,
    occurredAt: new Date(values.occurredAt).toISOString(),
    mediaIds,
  }
  if (values.type === 'milestone') input.title = values.title.trim()
  input.content = values.content.trim() || null
  if (values.type === 'measurement') {
    input.measurement = {
      heightCm: values.heightCm.trim() ? Number(values.heightCm) : null,
      weightKg: values.weightKg.trim() ? Number(values.weightKg) : null,
    }
  }
  return input
}

export function toLocalDateTime(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
