import { describe, expect, it } from 'vitest'

import { toRecordInput, validateRecordForm, validateRecordFormIssue } from './validation'
import type { RecordFormValues } from './types'

const base: RecordFormValues = {
  type: 'note', title: '', content: '', heightCm: '', weightKg: '', occurredAt: '2026-01-01T10:00',
}

describe('record form validation', () => {
  it('requires content or media for notes', () => {
    expect(validateRecordForm(base, 0)).toBe('正文和照片至少填写一项')
    expect(validateRecordForm(base, 1)).toBeUndefined()
  })

  it('creates a pure-image note input without inventing text content', () => {
    expect(validateRecordForm(base, 1)).toBeUndefined()
    expect(toRecordInput(base, ['11111111-1111-4111-8111-111111111111'])).toEqual({
      type: 'note',
      occurredAt: new Date(base.occurredAt).toISOString(),
      content: null,
      mediaIds: ['11111111-1111-4111-8111-111111111111'],
    })
  })

  it('uses the optional birth time as the precise lower bound', () => {
    expect(validateRecordForm({ ...base, content: '早到的记录' }, 0, '2026-01-01', '11:30'))
      .toBe('发生时间不能早于宝宝出生时间')
    expect(validateRecordForm({ ...base, content: '出生时记录', occurredAt: '2026-01-01T11:30' }, 0, '2026-01-01', '11:30'))
      .toBeUndefined()
  })

  it('identifies the first invalid field for focused error presentation', () => {
    expect(validateRecordFormIssue({ ...base, type: 'milestone' }, 0)).toEqual({
      field: 'title',
      message: '请填写里程碑标题',
    })
  })

  it('rejects scientific notation and accepts one measurement', () => {
    expect(validateRecordForm({ ...base, type: 'measurement', heightCm: '2e2' }, 0)).toContain('普通十进制')
    expect(validateRecordForm({ ...base, type: 'measurement', heightCm: '68.25' }, 0)).toBeUndefined()
  })

  it('builds measurement input without empty values', () => {
    expect(toRecordInput({ ...base, type: 'measurement', weightKg: '7.85' }, [])).toMatchObject({
      type: 'measurement', measurement: { weightKg: 7.85 }, mediaIds: [],
    })
  })
})
