import { beforeEach, describe, expect, it, vi } from 'vitest'

const platformMock = vi.hoisted(() => ({
  getStorage: vi.fn(), setStorage: vi.fn(), removeStorage: vi.fn(), reLaunch: vi.fn(),
}))
vi.mock('../../platform', () => ({ platform: platformMock }))

const token = 'A'.repeat(43)

describe('pending family invite context', () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks()
    platformMock.setStorage.mockResolvedValue(undefined)
    platformMock.removeStorage.mockResolvedValue(undefined)
    platformMock.reLaunch.mockResolvedValue(undefined)
  })

  it('persists a valid share token through login without putting it in the next route', async () => {
    platformMock.getStorage.mockResolvedValue(token)
    const context = await import('./invite-context')
    await expect(context.rememberInviteToken(token)).resolves.toBe(true)
    await expect(context.resumePendingInvite()).resolves.toBe(true)
    expect(platformMock.setStorage).toHaveBeenCalledWith('baby-mp.pending-family-invite.v1', token)
    expect(platformMock.reLaunch).toHaveBeenCalledWith('/pages/family/invite?resume=1')
    expect(platformMock.reLaunch.mock.calls[0]?.[0]).not.toContain(token)
  })

  it('rejects malformed tokens and clears malformed persisted context', async () => {
    platformMock.getStorage.mockResolvedValue('token-in-url')
    const context = await import('./invite-context')
    await expect(context.rememberInviteToken('short')).resolves.toBe(false)
    await expect(context.pendingInviteToken()).resolves.toBeUndefined()
    expect(platformMock.setStorage).not.toHaveBeenCalled()
    expect(platformMock.removeStorage).toHaveBeenCalledWith('baby-mp.pending-family-invite.v1')
  })

  it('does not redirect after terminal invite state clears context', async () => {
    platformMock.getStorage.mockResolvedValue(undefined)
    const context = await import('./invite-context')
    await context.clearPendingInvite()
    await expect(context.resumePendingInvite()).resolves.toBe(false)
    expect(platformMock.reLaunch).not.toHaveBeenCalled()
  })
})
