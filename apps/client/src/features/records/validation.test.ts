import { describe, expect, it } from 'vitest'

import { toRecordInput, validateRecordForm } from './validation'
import type { RecordFormValues } from './types'

const base: RecordFormValues = {
  type: 'note', title: '', content: '', heightCm: '', weightKg: '', occurredAt: '2026-01-01T10:00',
}

describe('record form validation', () => {
  it('requires content or media for notes', () => {
    expect(validateRecordForm(base, 0)).toBe('正文和照片至少填写一项')
    expect(validateRecordForm(base, 1)).toBeUndefined()
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
