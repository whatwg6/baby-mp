export type UploadState = 'local' | 'compressing' | 'uploading' | 'ready' | 'failed'

export type { Media as MediaResource } from '@baby-mp/contracts'

export interface MediaDraft {
  localId: string
  localPath?: string
  fileName: string
  mimeType: string
  sizeBytes: number
  width?: number
  height?: number
  mediaId?: string
  accessUrl?: string | null
  state: UploadState
  progress: number
  error?: string
}

export interface UploadTicket {
  mediaId: string
  upload: {
    method: 'PUT'
    url: string
    headers: Record<string, string>
    expiresAt: string
  }
}
