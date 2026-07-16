import { platform } from '../../platform'
import { completeMedia, createMediaUpload, getMedia } from './api'
import type { MediaDraft } from './types'

export const mediaPlatform = platform

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

async function waitUntilReady(mediaId: string) {
  let media = await getMedia(mediaId)
  for (let attempt = 0; media.status === 'uploaded' && attempt < 4; attempt += 1) {
    await wait(300 * (attempt + 1))
    media = await getMedia(mediaId)
  }
  if (media.status !== 'ready') throw new Error('图片仍在处理中，请稍后重试')
  return media
}

function inferMimeType(path: string) {
  const normalized = path.toLowerCase().split('?')[0] ?? path.toLowerCase()
  if (normalized.endsWith('.png')) return 'image/png'
  return 'image/jpeg'
}

function inferFileName(path: string, index: number) {
  const segment = path.split('/').pop()?.split('?')[0]
  return segment?.trim() || `photo-${index + 1}.jpg`
}

export async function chooseMediaDrafts(remaining: number): Promise<MediaDraft[]> {
  const images = await platform.chooseImages(Math.min(remaining, 9))
  return images.map((image, index) => ({
    localId: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
    localPath: image.path,
    fileName: inferFileName(image.path, index),
    mimeType: inferMimeType(image.path),
    sizeBytes: image.size,
    state: 'local',
    progress: 0,
  }))
}

export async function uploadMediaDraft(
  babyId: string,
  draft: MediaDraft,
  onChange: (patch: Partial<MediaDraft>) => void,
) {
  if (draft.state === 'ready' && draft.mediaId) return draft.mediaId
  if (!draft.localPath) throw new Error('本地图片已不可用，请重新选择')
  let path = draft.localPath
  let sizeBytes = draft.sizeBytes
  try {
    onChange({ state: 'compressing', error: undefined })
    const compressed = await mediaPlatform.compressImage({ path, size: sizeBytes }, 82)
    path = compressed.path
    sizeBytes = compressed.size
    onChange({ localPath: path, sizeBytes })

    const info = await mediaPlatform.getImageInfo(path)
    const ticket = await createMediaUpload(babyId, {
      fileName: draft.fileName,
      mimeType: draft.mimeType,
      sizeBytes,
    })
    onChange({ state: 'uploading', mediaId: ticket.mediaId, progress: 1 })
    await mediaPlatform.uploadFile({
      url: ticket.upload.url,
      path,
      headers: ticket.upload.headers,
      onProgress: (progress) => onChange({ progress: Math.max(1, Math.min(99, progress)) }),
    })
    let media = await completeMedia(ticket.mediaId, info)
    if (media.status !== 'ready') media = await waitUntilReady(ticket.mediaId)
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
    const message = error instanceof Error ? error.message : '图片上传失败'
    onChange({ state: 'failed', error: message })
    throw error
  }
}
