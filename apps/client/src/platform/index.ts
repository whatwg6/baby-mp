import Taro from '@tarojs/taro'

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
  getSystemInfo: () => Taro.getSystemInfo(),
  enableShareMenu: () => Taro.showShareMenu({ withShareTicket: false }),
}

export type PlatformAdapter = typeof platform
