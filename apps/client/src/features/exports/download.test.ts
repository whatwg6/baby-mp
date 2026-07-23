import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getExportDownload: vi.fn(),
  downloadExportFile: vi.fn(),
  platform: {} as { downloadExportFile?: (input: { url: string; fileName: string }) => Promise<void> },
}))

vi.mock('./api', () => ({ getExportDownload: mocks.getExportDownload }))
vi.mock('../../platform', () => ({ platform: mocks.platform }))

import { downloadExportFile } from './download'

const exportId = '11111111-1111-4111-8111-111111111111'

describe('export download handoff', () => {
  beforeEach(() => {
    mocks.getExportDownload.mockReset()
    mocks.downloadExportFile.mockReset()
    delete mocks.platform.downloadExportFile
  })

  it('does not mint a signed URL when the platform cannot consume it', async () => {
    await expect(downloadExportFile(exportId)).rejects.toThrow('尚未提供安全下载能力')
    expect(mocks.getExportDownload).not.toHaveBeenCalled()
  })

  it('obtains a URL only for an immediate platform handoff and returns no URL', async () => {
    mocks.platform.downloadExportFile = mocks.downloadExportFile
    mocks.getExportDownload.mockResolvedValue({
      downloadUrl: 'https://storage.invalid/short-lived',
      expiresAt: '2026-01-01T00:05:00.000Z',
    })
    mocks.downloadExportFile.mockResolvedValue(undefined)

    await expect(downloadExportFile(exportId)).resolves.toBeUndefined()
    expect(mocks.getExportDownload).toHaveBeenCalledWith(exportId)
    expect(mocks.downloadExportFile).toHaveBeenCalledWith({
      url: 'https://storage.invalid/short-lived',
      fileName: 'baby-growth-export-11111111.zip',
    })
  })
})
