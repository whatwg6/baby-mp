import { MAX_BUFFERED_UPLOAD_BYTES, platform } from '../../platform'
import { completeMedia, createMediaUpload, getMedia } from './api'
import type { MediaDraft } from './types'

export const mediaPlatform = platform

function uploadAbortError() {
  const error = new Error('上传已取消，可重新尝试')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw uploadAbortError()
}

const wait = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  throwIfAborted(signal)
  const abort = () => {
    clearTimeout(timer)
    reject(uploadAbortError())
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', abort)
    resolve()
  }, milliseconds)
  signal?.addEventListener('abort', abort, { once: true })
})

async function waitUntilReady(mediaId: string, signal?: AbortSignal) {
  let media = await getMedia(mediaId, signal)
  for (let attempt = 0; media.status === 'uploaded' && attempt < 4; attempt += 1) {
    await wait(300 * (attempt + 1), signal)
    media = await getMedia(mediaId, signal)
  }
  if (media.status !== 'ready') throw new Error('图片仍在处理中，请稍后重试')
  return media
}

export async function chooseMediaDrafts(remaining: number): Promise<MediaDraft[]> {
  const images = await platform.chooseImages(Math.min(remaining, 9))
  return images.map((image, index) => ({
    localId: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
    localPath: image.path,
    webFile: image.webFile,
    fileName: image.fileName,
    mimeType: image.mimeType,
    sizeBytes: image.size,
    state: 'local',
    progress: 0,
  }))
}

export async function uploadMediaDraft(
  babyId: string,
  draft: MediaDraft,
  onChange: (patch: Partial<MediaDraft>) => void,
  signal?: AbortSignal,
) {
  if (draft.state === 'ready' && draft.mediaId) return draft.mediaId
  if (!draft.localPath) throw new Error('本地图片已不可用，请重新选择')
  let path = draft.localPath
  let sizeBytes = draft.sizeBytes
  let fileName = draft.fileName
  let mimeType = draft.mimeType
  let webFile = draft.webFile
  try {
    throwIfAborted(signal)
    onChange({ state: 'compressing', error: undefined })
    const compressed = await mediaPlatform.compressImage({
      path,
      size: sizeBytes,
      fileName,
      mimeType: mimeType === 'image/png' ? 'image/png' : 'image/jpeg',
      webFile,
    }, 82)
    throwIfAborted(signal)
    path = compressed.path
    sizeBytes = compressed.size
    fileName = compressed.fileName
    mimeType = compressed.mimeType
    webFile = compressed.webFile
    if (sizeBytes > MAX_BUFFERED_UPLOAD_BYTES) {
      throw new Error('压缩后的图片不能超过 20MB，请选择更小的图片')
    }
    onChange({ localPath: path, webFile, fileName, mimeType, sizeBytes })

    const info = await mediaPlatform.getImageInfo(path)
    throwIfAborted(signal)
    const ticket = await createMediaUpload(babyId, {
      fileName,
      mimeType,
      sizeBytes,
    }, signal)
    throwIfAborted(signal)
    onChange({ state: 'uploading', mediaId: ticket.mediaId, progress: 0 })
    await mediaPlatform.uploadFile({
      url: ticket.upload.url,
      path,
      body: webFile,
      headers: ticket.upload.headers,
      onProgress: (progress) => onChange({ progress: Math.max(0, Math.min(100, progress)) }),
      signal,
    })
    throwIfAborted(signal)
    let media = await completeMedia(ticket.mediaId, info, signal)
    if (media.status !== 'ready') media = await waitUntilReady(ticket.mediaId, signal)
    onChange({
      state: 'ready',
      mediaId: media.id,
      accessUrl: media.accessUrl,
      width: media.width ?? undefined,
      height: media.height ?? undefined,
      sizeBytes: media.sizeBytes,
      progress: 100,
      error: undefined,
    })
    return media.id
  } catch (error) {
    const message = signal?.aborted
      ? '上传已取消，可重新尝试'
      : error instanceof Error ? error.message : '图片上传失败'
    onChange({ state: 'failed', error: message })
    if (signal?.aborted) throw uploadAbortError()
    throw error
  }
}
