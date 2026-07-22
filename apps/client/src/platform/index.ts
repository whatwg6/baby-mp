import Taro, { useShareAppMessage } from '@tarojs/taro'

import { createIdempotencyKey } from '../services/idempotency-key'

export interface SelectedImage {
  path: string
  size: number
}

export interface UploadFileInput {
  url: string
  path: string
  headers: Record<string, string>
  onProgress?: (percentage: number) => void
  signal?: AbortSignal
}

export interface DownloadExportInput {
  url: string
  fileName: string
}

export const MAX_BUFFERED_UPLOAD_BYTES = 20 * 1024 * 1024

let h5ToastTimer: number | undefined

function uploadAbortError() {
  const error = new Error('上传已取消')
  error.name = 'AbortError'
  return error
}

function throwIfUploadAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw uploadAbortError()
}

async function settleH5BeforeNavigation(): Promise<void> {
  if (Taro.getEnv() !== Taro.ENV_TYPE.WEB) return
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
  })
}

function uploadBlobWithProgress(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onProgress?: (percentage: number) => void,
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    throwIfUploadAborted(signal)
    const request = new XMLHttpRequest()
    request.open('PUT', url)
    Object.entries(headers).forEach(([key, value]) => request.setRequestHeader(key, value))
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.round((event.loaded / event.total) * 100))
      }
    }
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve()
      else reject(new Error(`上传失败（${request.status}）`))
    }
    request.onerror = () => reject(new Error('上传连接中断'))
    request.onabort = () => reject(uploadAbortError())
    const abort = () => request.abort()
    signal?.addEventListener('abort', abort, { once: true })
    request.onloadend = () => signal?.removeEventListener('abort', abort)
    request.send(body)
  })
}

export const platform = {
  login: () => Taro.login(),
  chooseImages: async (count = 9): Promise<SelectedImage[]> => {
    const result = await Taro.chooseImage({ count, sourceType: ['album', 'camera'] })
    return result.tempFiles.map((file) => ({ path: file.path, size: file.size }))
  },
  compressImage: async (image: SelectedImage, quality = 82): Promise<SelectedImage> => {
    const result = await Taro.compressImage({ src: image.path, quality })
    if (Taro.getEnv() === Taro.ENV_TYPE.WEB) {
      try {
        const response = await fetch(result.tempFilePath)
        if (response.ok) {
          const compressed = await response.blob()
          if (compressed.size > 0) return { path: result.tempFilePath, size: compressed.size }
        }
      } catch {
        // Taro H5 can return a temporary compression URL that is not readable
        // by fetch. The original selected Blob remains private and usable.
      }
      return image
    }
    const info = await Taro.getFileInfo({ filePath: result.tempFilePath })
    if (!('size' in info)) throw new Error('无法读取压缩图片大小')
    return { path: result.tempFilePath, size: info.size }
  },
  uploadFile: async ({ url, path, headers, onProgress, signal }: UploadFileInput): Promise<void> => {
    throwIfUploadAborted(signal)
    if (Taro.getEnv() === Taro.ENV_TYPE.WEB) {
      const localResponse = await fetch(path, { signal })
      if (!localResponse.ok) throw new Error('无法读取待上传图片')
      const body = await localResponse.blob()
      if (body.size > MAX_BUFFERED_UPLOAD_BYTES) throw new Error('压缩后的图片不能超过 20MB')
      await uploadBlobWithProgress(url, body, headers, onProgress, signal)
      return
    }

    const data = await new Promise<ArrayBuffer>((resolve, reject) => {
      throwIfUploadAborted(signal)
      Taro.getFileSystemManager().readFile({
        filePath: path,
        success: (result) => {
          if (signal?.aborted) reject(uploadAbortError())
          else resolve(result.data as ArrayBuffer)
        },
        fail: reject,
      })
    })
    if (data.byteLength > MAX_BUFFERED_UPLOAD_BYTES) throw new Error('压缩后的图片不能超过 20MB')
    throwIfUploadAborted(signal)
    const task = Taro.request<ArrayBuffer>({
      url,
      method: 'PUT',
      header: headers,
      data,
    })
    const abort = () => task.abort()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const response = await task
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`上传失败（${response.statusCode}）`)
      }
      // Mini Program RequestTask does not expose upload byte progress for a
      // signed raw PUT. Report only the truthful completed state.
      onProgress?.(100)
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  },
  downloadExportFile: async ({ url, fileName }: DownloadExportInput): Promise<void> => {
    if (Taro.getEnv() === Taro.ENV_TYPE.WEB) {
      const anchor = document.getElementById('h5-download-anchor')
      if (!(anchor instanceof HTMLAnchorElement)) throw new Error('H5 下载入口不可用')
      anchor.href = url
      anchor.download = fileName
      anchor.click()
      anchor.removeAttribute('href')
      anchor.removeAttribute('download')
      return
    }

    const downloaded = await Taro.downloadFile({ url })
    if (downloaded.statusCode < 200 || downloaded.statusCode >= 300) {
      throw new Error(`导出包下载失败（${downloaded.statusCode}）`)
    }
    if (Taro.canIUse('shareFileMessage')) {
      await Taro.shareFileMessage({ filePath: downloaded.tempFilePath, fileName })
      return
    }
    const saved = await Taro.saveFile({ tempFilePath: downloaded.tempFilePath })
    if (!('savedFilePath' in saved)) throw new Error('导出包保存失败')
    await Taro.showToast({ title: '导出包已保存', icon: 'success' })
  },
  getImageInfo: (path: string) => Taro.getImageInfo({ src: path })
    .then(({ width, height }) => ({ width, height })),
  previewImages: (urls: string[], current = urls[0]) => Taro.previewImage({ urls, current }),
  stopPullDownRefresh: () => Taro.stopPullDownRefresh(),
  getStorage: <T>(key: string): Promise<T | undefined> =>
    Taro.getStorage<T>({ key })
      .then((result) => result.data)
      .catch(() => undefined),
  setStorage: (key: string, data: unknown) => Taro.setStorage({ key, data }),
  removeStorage: (key: string) => Taro.removeStorage({ key }),
  navigateTo: async (url: string) => {
    await settleH5BeforeNavigation()
    return Taro.navigateTo({ url })
  },
  redirectTo: async (url: string) => {
    await settleH5BeforeNavigation()
    return Taro.redirectTo({ url })
  },
  reLaunch: async (url: string) => {
    await settleH5BeforeNavigation()
    return Taro.reLaunch({ url })
  },
  switchTab: async (url: string) => {
    await settleH5BeforeNavigation()
    return Taro.switchTab({ url })
  },
  navigateBack: async () => {
    await settleH5BeforeNavigation()
    return Taro.navigateBack()
  },
  showToast: async (title: string, icon: 'none' | 'success' = 'none') => {
    if (Taro.getEnv() === Taro.ENV_TYPE.WEB) {
      const toast = document.getElementById('h5-toast-root')
      if (!(toast instanceof HTMLDivElement)) return
      if (h5ToastTimer !== undefined) window.clearTimeout(h5ToastTimer)
      toast.textContent = `${icon === 'success' ? '✓ ' : ''}${title}`
      toast.hidden = false
      h5ToastTimer = window.setTimeout(() => {
        toast.hidden = true
        toast.textContent = ''
        h5ToastTimer = undefined
      }, 1_500)
      return
    }
    await Taro.showToast({ title, icon })
  },
  showModal: (title: string, content: string, confirmText = '确认', cancelText = '取消') =>
    Taro.showModal({ title, content, confirmText, cancelText }),
  createIdempotencyKey,
  getRouteParams: () => Taro.getCurrentInstance().router?.params ?? {},
  getSystemInfo: () => Taro.getSystemInfo(),
  enableShareMenu: () => Taro.showShareMenu({ withShareTicket: false }),
}

export type PlatformAdapter = typeof platform

export function usePlatformShareMessage(message?: { title: string; path: string }) {
  useShareAppMessage(() => message ?? { title: '宝宝成长记', path: '/pages/home/index' })
}
