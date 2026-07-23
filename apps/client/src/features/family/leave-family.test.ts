import { beforeEach, describe, expect, it, vi } from 'vitest'

const leaveFamilyMock = vi.hoisted(() => vi.fn())
const clearBabiesMock = vi.hoisted(() => vi.fn())
const loadBabiesMock = vi.hoisted(() => vi.fn())

vi.mock('./api', () => ({ leaveFamily: leaveFamilyMock }))
vi.mock('../babies/store', () => ({
  clearBabies: clearBabiesMock,
  loadBabies: loadBabiesMock,
}))

describe('family leave workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    leaveFamilyMock.mockResolvedValue(undefined)
  })

  it('clears the departed baby before loading and selecting another accessible baby', async () => {
    const remaining = [{ id: '22222222-2222-4222-8222-222222222222' }]
    loadBabiesMock.mockResolvedValue(remaining)

    await expect(
      import('./leave-family').then(({ leaveFamilyAndRefresh }) => leaveFamilyAndRefresh('11111111-1111-4111-8111-111111111111', 4)),
    ).resolves.toEqual({ remainingBabies: remaining, refreshFailed: false })

    expect(leaveFamilyMock).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 4)
    expect(clearBabiesMock).toHaveBeenCalledOnce()
    expect(loadBabiesMock).toHaveBeenCalledOnce()
    expect(clearBabiesMock.mock.invocationCallOrder[0]!).toBeLessThan(loadBabiesMock.mock.invocationCallOrder[0]!)
  })

  it('does not clear local baby context when the leave request itself fails', async () => {
    leaveFamilyMock.mockRejectedValue(new Error('退出失败'))
    const { leaveFamilyAndRefresh } = await import('./leave-family')

    await expect(leaveFamilyAndRefresh('11111111-1111-4111-8111-111111111111', 1)).rejects.toThrow('退出失败')
    expect(clearBabiesMock).not.toHaveBeenCalled()
    expect(loadBabiesMock).not.toHaveBeenCalled()
  })

  it('keeps the departed baby cleared when refreshing the remaining list fails', async () => {
    loadBabiesMock.mockRejectedValue(new Error('网络异常'))
    const { leaveFamilyAndRefresh } = await import('./leave-family')

    await expect(leaveFamilyAndRefresh('11111111-1111-4111-8111-111111111111', 1)).resolves.toEqual({
      remainingBabies: [],
      refreshFailed: true,
    })
    expect(clearBabiesMock).toHaveBeenCalledOnce()
  })
})
