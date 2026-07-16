import Taro from '@tarojs/taro'

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
}

export const platform = {
  login: () => Taro.login(),
  chooseImages: async (count = 9): Promise<SelectedImage[]> => {
    const result = await Taro.chooseImage({ count, sourceType: ['album', 'camera'] })
    return result.tempFiles.map((file) => ({ path: file.path, size: file.size }))
  },
  compressImage: async (image: SelectedImage, quality = 82): Promise<SelectedImage> => {
    const result = await Taro.compressImage({ src: image.path, quality })
    const info = await Taro.getFileInfo({ filePath: result.tempFilePath })
    if (!('size' in info)) throw new Error('无法读取压缩图片大小')
    return { path: result.tempFilePath, size: info.size }
  },
  uploadFile: async ({ url, path, headers, onProgress }: UploadFileInput): Promise<void> => {
    onProgress?.(0)
    if (Taro.getEnv() === Taro.ENV_TYPE.WEB) {
      const body = await fetch(path).then((response) => response.blob())
      const response = await fetch(url, { method: 'PUT', headers, body })
      if (!response.ok) throw new Error(`上传失败（${response.status}）`)
      onProgress?.(100)
      return
    }

    const data = await new Promise<ArrayBuffer>((resolve, reject) => {
      Taro.getFileSystemManager().readFile({
        filePath: path,
        success: (result) => resolve(result.data as ArrayBuffer),
        fail: reject,
      })
    })
    const response = await Taro.request<ArrayBuffer>({
      url,
      method: 'PUT',
      header: headers,
      data,
    })
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`上传失败（${response.statusCode}）`)
    }
    onProgress?.(100)
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
  navigateTo: (url: string) => Taro.navigateTo({ url }),
  redirectTo: (url: string) => Taro.redirectTo({ url }),
  reLaunch: (url: string) => Taro.reLaunch({ url }),
  switchTab: (url: string) => Taro.switchTab({ url }),
  navigateBack: () => Taro.navigateBack(),
  showToast: async (title: string, icon: 'none' | 'success' = 'none') => {
    if (Taro.getEnv() === Taro.ENV_TYPE.WEB) {
      const toast = document.createElement('div')
      toast.setAttribute('role', 'status')
      toast.textContent = `${icon === 'success' ? '✓ ' : ''}${title}`
      Object.assign(toast.style, {
        position: 'fixed',
        left: '50%',
        bottom: '72px',
        zIndex: '9999',
        transform: 'translateX(-50%)',
        padding: '10px 16px',
        borderRadius: '8px',
        background: 'rgba(35, 31, 29, 0.9)',
        color: '#fff',
        fontSize: '14px',
        pointerEvents: 'none',
      })
      document.body.appendChild(toast)
      window.setTimeout(() => toast.remove(), 1_500)
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
