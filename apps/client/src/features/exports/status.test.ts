import { describe, expect, it } from 'vitest'

import { exportJobSchema } from '@baby-mp/contracts'

import { effectiveExportStatus, exportFailureMessage } from './status'

const job = {
  id: '11111111-1111-4111-8111-111111111111',
  babyId: '22222222-2222-4222-8222-222222222222',
  status: 'completed' as const,
  includeMedia: true,
  format: 'zip' as const,
  errorCode: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:01:00.000Z',
  expiresAt: '2026-01-08T00:01:00.000Z',
  downloadUrl: null,
}

describe('export client safety and status', () => {
  it('treats a locally elapsed completed job as expired', () => {
    expect(effectiveExportStatus(job, Date.parse('2026-01-07T00:00:00.000Z'))).toBe('completed')
    expect(effectiveExportStatus(job, Date.parse('2026-01-09T00:00:00.000Z'))).toBe('expired')
  })

  it('rejects signed URLs on the ordinary export job contract', () => {
    expect(exportJobSchema.safeParse({ ...job, downloadUrl: 'https://storage.invalid/signed' }).success).toBe(false)
    expect(exportJobSchema.safeParse(job).success).toBe(true)
  })

  it('maps known failures without displaying raw backend details', () => {
    expect(exportFailureMessage('STORAGE_UNAVAILABLE')).toBe('文件存储暂时不可用')
    expect(exportFailureMessage('unexpected-sensitive-text')).toBe('导出未能完成，请重新创建任务。')
  })
})
