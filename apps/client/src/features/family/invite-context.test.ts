import { beforeEach, describe, expect, it, vi } from 'vitest'

const platformMock = vi.hoisted(() => ({
  getStorage: vi.fn(), setStorage: vi.fn(), removeStorage: vi.fn(), reLaunch: vi.fn(), login: vi.fn(),
}))
const previewFamilyInviteMock = vi.hoisted(() => vi.fn())
const platformLoginMock = vi.hoisted(() => vi.fn())
const saveSessionMock = vi.hoisted(() => vi.fn())
const resolveAuthenticatedLandingMock = vi.hoisted(() => vi.fn())
vi.mock('../../platform', () => ({ platform: platformMock }))
vi.mock('./api', () => ({ previewFamilyInvite: previewFamilyInviteMock }))
vi.mock('../auth/api', () => ({ platformLogin: platformLoginMock }))
vi.mock('../auth/store', () => ({ saveSession: saveSessionMock }))
vi.mock('../auth/navigation', () => ({ resolveAuthenticatedLanding: resolveAuthenticatedLandingMock }))

const token = 'A'.repeat(43)

describe('pending family invite context', () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks()
    platformMock.setStorage.mockResolvedValue(undefined)
    platformMock.removeStorage.mockResolvedValue(undefined)
    platformMock.reLaunch.mockResolvedValue(undefined)
    platformMock.login.mockResolvedValue({ code: 'temporary-code' })
    platformLoginMock.mockReset()
    saveSessionMock.mockReset()
    resolveAuthenticatedLandingMock.mockReset()
    previewFamilyInviteMock.mockReset()
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

  it('keeps the invite retryable when its safe login preview temporarily fails', async () => {
    platformMock.getStorage.mockResolvedValue(token)
    previewFamilyInviteMock.mockRejectedValue(new Error('network down'))
    const context = await import('./invite-context')

    await expect(context.loadPendingInviteLoginSummary()).resolves.toEqual({ pending: true })
    await expect(context.pendingInviteToken()).resolves.toBe(token)
    expect(platformMock.removeStorage).not.toHaveBeenCalled()
  })

  it('keeps the pending invite token retryable after login fails', async () => {
    platformMock.getStorage.mockResolvedValue(token)
    previewFamilyInviteMock.mockResolvedValue({
      baby: { id: '11111111-1111-4111-8111-111111111111', name: '小星星', avatarUrl: null },
      inviter: { id: '22222222-2222-4222-8222-222222222222', displayName: '妈妈', avatarUrl: null },
      role: 'viewer',
      status: 'pending',
      expiresAt: '2026-07-23T00:00:00.000Z',
    })
    platformLoginMock.mockRejectedValue(new Error('platform login failed'))
    const context = await import('./invite-context')
    const { completePlatformLogin } = await import('../../pages/auth/login-flow')

    await context.loadPendingInviteLoginSummary(token)
    await expect(completePlatformLogin()).rejects.toThrow('platform login failed')

    await expect(context.pendingInviteToken()).resolves.toBe(token)
    expect(platformMock.login).toHaveBeenCalledOnce()
    expect(platformLoginMock).toHaveBeenCalledWith('temporary-code')
    expect(saveSessionMock).not.toHaveBeenCalled()
    expect(resolveAuthenticatedLandingMock).not.toHaveBeenCalled()
    expect(platformMock.removeStorage).not.toHaveBeenCalled()
    expect(platformMock.setStorage).toHaveBeenCalledWith('baby-mp.pending-family-invite.v1', token)
  })

  it('returns a token-free safe summary for the login page', async () => {
    platformMock.getStorage.mockResolvedValue(token)
    previewFamilyInviteMock.mockResolvedValue({
      baby: { id: '11111111-1111-4111-8111-111111111111', name: '小星星', avatarUrl: null },
      inviter: { id: '22222222-2222-4222-8222-222222222222', displayName: '妈妈', avatarUrl: null },
      role: 'viewer',
      status: 'pending',
      expiresAt: '2026-07-23T00:00:00.000Z',
    })
    const context = await import('./invite-context')

    const summary = await context.loadPendingInviteLoginSummary()
    expect(summary).toEqual({ pending: true, babyName: '小星星', inviterName: '妈妈' })
    expect(JSON.stringify(summary)).not.toContain(token)
  })
})
