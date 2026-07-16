import Taro from '@tarojs/taro'

import { createIdempotencyKey } from '../services/idempotency-key'

export interface SelectedImage {
  path: string
  size: number
}

export const platform = {
  login: () => Taro.login(),
  chooseImages: async (count = 9): Promise<SelectedImage[]> => {
    const result = await Taro.chooseImage({ count, sourceType: ['album', 'camera'] })
    return result.tempFiles.map((file) => ({ path: file.path, size: file.size }))
  },
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
  showToast: (title: string, icon: 'none' | 'success' = 'none') => Taro.showToast({ title, icon }),
  showModal: (title: string, content: string, confirmText = '确认', cancelText = '取消') =>
    Taro.showModal({ title, content, confirmText, cancelText }),
  createIdempotencyKey,
  getRouteParams: () => Taro.getCurrentInstance().router?.params ?? {},
  getSystemInfo: () => Taro.getSystemInfo(),
  enableShareMenu: () => Taro.showShareMenu({ withShareTicket: false }),
}

export type PlatformAdapter = typeof platform
