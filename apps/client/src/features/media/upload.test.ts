import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  platform: {
    chooseImages: vi.fn(),
    compressImage: vi.fn(),
    getImageInfo: vi.fn(),
    uploadFile: vi.fn(),
  },
  createMediaUpload: vi.fn(),
  completeMedia: vi.fn(),
  getMedia: vi.fn(),
}))

vi.mock('../../platform', () => ({
  MAX_BUFFERED_UPLOAD_BYTES: 20 * 1024 * 1024,
  platform: mocks.platform,
}))

vi.mock('./api', () => ({
  createMediaUpload: mocks.createMediaUpload,
  completeMedia: mocks.completeMedia,
  getMedia: mocks.getMedia,
}))

import type { MediaDraft } from './types'
import { chooseMediaDrafts, uploadMediaDraft } from './upload'

const draft: MediaDraft = {
  localId: 'local-1',
  localPath: '/tmp/photo.jpg',
  fileName: 'photo.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 1_000,
  state: 'local',
  progress: 0,
}

describe('media upload lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.platform.compressImage.mockResolvedValue({
      path: '/tmp/compressed.jpg',
      size: 800,
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
    })
    mocks.platform.getImageInfo.mockResolvedValue({ width: 100, height: 200 })
    mocks.createMediaUpload.mockResolvedValue({
      mediaId: 'media-1',
      upload: { url: 'https://upload.test/object', headers: {} },
    })
    mocks.completeMedia.mockResolvedValue({
      id: 'media-1',
      status: 'ready',
      accessUrl: 'https://download.test/object',
      width: 100,
      height: 200,
      sizeBytes: 800,
    })
  })

  it('preserves the browser File name and PNG MIME from selection through upload', async () => {
    const webFile = new Blob(['png-bytes'], { type: 'image/png' })
    mocks.platform.chooseImages.mockResolvedValue([{
      path: 'blob:http://localhost/image-id',
      size: webFile.size,
      fileName: 'family-photo.png',
      mimeType: 'image/png',
      webFile,
    }])
    mocks.platform.compressImage.mockImplementation(async (image) => image)
    mocks.platform.uploadFile.mockResolvedValue(undefined)

    const [selected] = await chooseMediaDrafts(1)
    expect(selected).toMatchObject({
      localPath: 'blob:http://localhost/image-id',
      fileName: 'family-photo.png',
      mimeType: 'image/png',
      webFile,
    })

    await uploadMediaDraft('baby-1', selected!, vi.fn())

    expect(mocks.createMediaUpload).toHaveBeenCalledWith('baby-1', {
      fileName: 'family-photo.png',
      mimeType: 'image/png',
      sizeBytes: webFile.size,
    }, undefined)
    expect(mocks.platform.uploadFile).toHaveBeenCalledWith(expect.objectContaining({
      path: 'blob:http://localhost/image-id',
      body: webFile,
    }))
  })

  it('forwards only transport-reported progress and reaches ready', async () => {
    mocks.platform.uploadFile.mockImplementation(async ({ onProgress }) => {
      onProgress?.(37)
      onProgress?.(100)
    })
    const patches: Array<Partial<MediaDraft>> = []

    await expect(uploadMediaDraft('baby-1', draft, (patch) => patches.push(patch)))
      .resolves.toBe('media-1')

    expect(patches).toContainEqual(expect.objectContaining({ state: 'uploading', progress: 0 }))
    expect(patches).toContainEqual({ progress: 37 })
    expect(patches).toContainEqual({ progress: 100 })
    expect(patches.at(-1)).toMatchObject({ state: 'ready', progress: 100 })
  })

  it('passes AbortSignal to the upload and exposes a retryable cancelled state', async () => {
    mocks.platform.uploadFile.mockImplementation(async ({ signal }) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      }, { once: true })
    }))
    const controller = new AbortController()
    const patches: Array<Partial<MediaDraft>> = []
    const upload = uploadMediaDraft('baby-1', draft, (patch) => patches.push(patch), controller.signal)

    await vi.waitFor(() => expect(mocks.platform.uploadFile).toHaveBeenCalled())
    controller.abort()

    await expect(upload).rejects.toMatchObject({ name: 'AbortError' })
    expect(patches.at(-1)).toMatchObject({
      state: 'failed',
      error: '上传已取消，可重新尝试',
    })
  })

  it('rejects compressed files above the bounded in-memory contract limit', async () => {
    mocks.platform.compressImage.mockResolvedValue({
      path: '/tmp/large.jpg',
      size: 20 * 1024 * 1024 + 1,
      fileName: 'large.jpg',
      mimeType: 'image/jpeg',
    })

    await expect(uploadMediaDraft('baby-1', draft, vi.fn()))
      .rejects.toThrow('压缩后的图片不能超过 20MB')
    expect(mocks.createMediaUpload).not.toHaveBeenCalled()
    expect(mocks.platform.uploadFile).not.toHaveBeenCalled()
  })
})
