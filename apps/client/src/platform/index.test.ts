import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  chooseImage: vi.fn(),
  compressImage: vi.fn(),
  disableAlertBeforeUnload: vi.fn(),
  enableAlertBeforeUnload: vi.fn(),
  getEnv: vi.fn(),
  pageScrollTo: vi.fn(),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    ENV_TYPE: { WEB: 'WEB', WEAPP: 'WEAPP' },
    chooseImage: mocks.chooseImage,
    compressImage: mocks.compressImage,
    disableAlertBeforeUnload: mocks.disableAlertBeforeUnload,
    enableAlertBeforeUnload: mocks.enableAlertBeforeUnload,
    getEnv: mocks.getEnv,
    pageScrollTo: mocks.pageScrollTo,
  },
  useShareAppMessage: vi.fn(),
}))

import { platform } from './index'

describe('browser image platform adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getEnv.mockReturnValue('WEB')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the original browser File, name, MIME, and byte size', async () => {
    const webFile = new File(['png-image'], '宝宝照片.PNG', { type: 'image/png' })
    mocks.chooseImage.mockResolvedValue({
      tempFiles: [{
        path: 'blob:http://localhost/opaque-id',
        size: 1,
        type: 'image',
        originalFileObj: webFile,
      }],
    })

    await expect(platform.chooseImages(1)).resolves.toEqual([{
      path: 'blob:http://localhost/opaque-id',
      size: webFile.size,
      fileName: '宝宝照片.PNG',
      mimeType: 'image/png',
      webFile,
    }])
  })

  it('returns the original browser File without invoking unsupported H5 compression', async () => {
    const webFile = new File(['png-image'], 'photo.png', { type: 'image/png' })
    const selected = {
      path: 'blob:http://localhost/opaque-id',
      size: webFile.size,
      fileName: webFile.name,
      mimeType: 'image/png' as const,
      webFile,
    }

    await expect(platform.compressImage(selected)).resolves.toBe(selected)
    expect(mocks.compressImage).not.toHaveBeenCalled()
  })

  it('keeps scrolling and native unsaved-change protection behind the adapter', async () => {
    mocks.getEnv.mockReturnValue('WEAPP')
    mocks.pageScrollTo.mockResolvedValue(undefined)

    await platform.scrollToTop()
    await platform.scrollToElement('#record-field-content')
    const guard = platform.guardUnsavedChanges('尚未保存', vi.fn())
    await guard.release()

    expect(mocks.pageScrollTo).toHaveBeenNthCalledWith(1, { scrollTop: 0, duration: 0 })
    expect(mocks.pageScrollTo).toHaveBeenNthCalledWith(2, { selector: '#record-field-content', duration: 200 })
    expect(mocks.enableAlertBeforeUnload).toHaveBeenCalledWith({ message: '尚未保存' })
    expect(mocks.disableAlertBeforeUnload).toHaveBeenCalled()
  })

  it('asks before an H5 browser back action and rearms the guard when editing continues', async () => {
    const listeners = new Map<string, (event?: unknown) => unknown>()
    let historyState: Record<string, unknown> = {}
    const pushState = vi.fn((state: Record<string, unknown>) => { historyState = state })
    const replaceState = vi.fn((state: Record<string, unknown>) => { historyState = state })
    vi.stubGlobal('window', {
      addEventListener: vi.fn((name: string, listener: (event?: unknown) => unknown) => listeners.set(name, listener)),
      removeEventListener: vi.fn((name: string) => listeners.delete(name)),
      history: {
        get state() { return historyState },
        pushState,
        replaceState,
      },
      location: { href: 'https://example.test/pages/records/edit' },
    })
    const confirmLeave = vi.fn().mockResolvedValue(false)

    const guard = platform.guardUnsavedChanges('尚未保存', confirmLeave)
    await listeners.get('popstate')?.()

    expect(confirmLeave).toHaveBeenCalledOnce()
    expect(pushState).toHaveBeenCalledTimes(2)
    guard.dispose()
    expect(replaceState).toHaveBeenCalledOnce()
  })
})
