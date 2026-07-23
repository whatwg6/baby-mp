import Taro, { useShareAppMessage } from '@tarojs/taro'

import { createIdempotencyKey } from '../services/idempotency-key'

export interface SelectedImage {
  path: string
  size: number
  fileName: string
  mimeType: 'image/jpeg' | 'image/png'
  webFile?: Blob
}

export interface UploadFileInput {
  url: string
  path: string
  body?: Blob
  headers: Record<string, string>
  onProgress?: (percentage: number) => void
  signal?: AbortSignal
}

export interface DownloadExportInput {
  url: string
  fileName: string
}

export interface UnsavedNavigationGuard {
  release: () => Promise<void>
  dispose: () => void
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

function imageMimeType(type: string | undefined, source: string, defaultToJpeg = false): SelectedImage['mimeType'] {
  const normalized = type?.split(';')[0]?.trim().toLowerCase()
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'image/jpeg'
  if (normalized === 'image/png') return 'image/png'

  const path = source.toLowerCase().split('?')[0] ?? source.toLowerCase()
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  if (path.endsWith('.png')) return 'image/png'
  if (defaultToJpeg) return 'image/jpeg'
  throw new Error('仅支持 JPG 或 PNG 图片')
}

function imageFileName(name: string | undefined, path: string, mimeType: SelectedImage['mimeType'], index: number) {
  const pathSegment = path.split('/').pop()?.split('?')[0]
  const candidate = name?.trim() || (pathSegment?.includes('.') ? pathSegment.trim() : '')
  return candidate || `photo-${index + 1}.${mimeType === 'image/png' ? 'png' : 'jpg'}`
}

async function settleH5BeforeNavigation(): Promise<void> {
  if (Taro.getEnv() !== Taro.ENV_TYPE.WEB) return
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
  })
}

function createUnsavedNavigationGuard(
  message: string,
  confirmLeave: () => Promise<boolean>,
): UnsavedNavigationGuard {
  if (Taro.getEnv() !== Taro.ENV_TYPE.WEB) {
    Taro.enableAlertBeforeUnload({ message })
    let active = true
    const disable = () => {
      if (!active) return
      active = false
      Taro.disableAlertBeforeUnload()
    }
    return { release: async () => disable(), dispose: disable }
  }

  const marker = `baby-mp-unsaved-${Date.now()}-${Math.random().toString(36).slice(2)}`
  let active = true
  let armed = false
  let confirmationPending = false
  const beforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault()
    event.returnValue = message
  }
  const arm = () => {
    window.history.pushState({ ...window.history.state, [marker]: true }, '', window.location.href)
    armed = true
  }
  const removeListeners = () => {
    window.removeEventListener('beforeunload', beforeUnload)
    window.removeEventListener('popstate', onPopState)
  }
  const onPopState = async () => {
    if (!active) return
    armed = false
    // Restore the marker before opening an async modal so repeated browser
    // back gestures cannot escape past the edit route while confirmation is
    // still pending.
    arm()
    if (confirmationPending) return
    confirmationPending = true
    const confirmed = await confirmLeave().catch(() => false)
    confirmationPending = false
    if (!active) return
    if (confirmed) {
      active = false
      removeListeners()
      if (armed && window.history.state?.[marker]) {
        await new Promise<void>((resolve) => {
          let settled = false
          const done = () => {
            if (settled) return
            settled = true
            window.removeEventListener('popstate', done)
            resolve()
          }
          window.addEventListener('popstate', done, { once: true })
          window.history.back()
          window.setTimeout(done, 250)
        })
        armed = false
      }
      await settleH5BeforeNavigation()
      await Taro.navigateBack()
    }
  }

  window.addEventListener('beforeunload', beforeUnload)
  window.addEventListener('popstate', onPopState)
  arm()

  return {
    release: async () => {
      if (!active) return
      active = false
      removeListeners()
      if (!armed || !window.history.state?.[marker]) return
      await new Promise<void>((resolve) => {
        let settled = false
        const done = () => {
          if (settled) return
          settled = true
          window.removeEventListener('popstate', done)
          resolve()
        }
        window.addEventListener('popstate', done, { once: true })
        window.history.back()
        window.setTimeout(done, 250)
      })
      armed = false
    },
    dispose: () => {
      if (!active) return
      active = false
      removeListeners()
      if (armed && window.history.state?.[marker]) {
        const nextState = { ...window.history.state }
        delete nextState[marker]
        window.history.replaceState(nextState, '', window.location.href)
      }
    },
  }
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
    const isWeb = Taro.getEnv() === Taro.ENV_TYPE.WEB
    return result.tempFiles.map((file, index) => {
      const webFile = file.originalFileObj
      const mimeType = imageMimeType(webFile?.type || file.type, webFile?.name || file.path, !isWeb)
      return {
        path: file.path,
        size: webFile?.size ?? file.size,
        fileName: imageFileName(webFile?.name, file.path, mimeType, index),
        mimeType,
        ...(webFile ? { webFile } : {}),
      }
    })
  },
  compressImage: async (image: SelectedImage, quality = 82): Promise<SelectedImage> => {
    // Taro H5 4.x does not implement compressImage. Keep the browser File so
    // retries upload the exact selected bytes instead of fetching a missing
    // tempFilePath (which can accidentally resolve to the SPA document).
    if (Taro.getEnv() === Taro.ENV_TYPE.WEB) return image

    const result = await Taro.compressImage({ src: image.path, quality })
    if (!result.tempFilePath) throw new Error('图片压缩结果不可用')
    const info = await Taro.getFileInfo({ filePath: result.tempFilePath })
    if (!('size' in info)) throw new Error('无法读取压缩图片大小')
    return { ...image, path: result.tempFilePath, size: info.size, webFile: undefined }
  },
  uploadFile: async ({ url, path, body, headers, onProgress, signal }: UploadFileInput): Promise<void> => {
    throwIfUploadAborted(signal)
    if (Taro.getEnv() === Taro.ENV_TYPE.WEB) {
      let uploadBody = body
      if (!uploadBody) {
        if (!path) throw new Error('本地图片已不可用，请重新选择')
        const localResponse = await fetch(path, { signal })
        if (!localResponse.ok) throw new Error('无法读取待上传图片')
        uploadBody = await localResponse.blob()
      }
      if (uploadBody.size > MAX_BUFFERED_UPLOAD_BYTES) throw new Error('压缩后的图片不能超过 20MB')
      await uploadBlobWithProgress(url, uploadBody, headers, onProgress, signal)
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
  scrollToTop: () => Taro.pageScrollTo({ scrollTop: 0, duration: 0 }),
  scrollToElement: (selector: string) => Taro.pageScrollTo({ selector, duration: 200 }),
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
  guardUnsavedChanges: (message: string, confirmLeave: () => Promise<boolean>) =>
    createUnsavedNavigationGuard(message, confirmLeave),
  createIdempotencyKey,
  getRouteParams: () => Taro.getCurrentInstance().router?.params ?? {},
  getSystemInfo: () => Taro.getSystemInfo(),
  enableShareMenu: () => Taro.showShareMenu({ withShareTicket: false }),
}

export type PlatformAdapter = typeof platform

export function usePlatformShareMessage(message?: { title: string; path: string }) {
  useShareAppMessage(() => message ?? { title: '宝宝成长记', path: '/pages/home/index' })
}
