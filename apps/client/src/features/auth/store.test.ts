import { healthResponseSchema } from '@baby-mp/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const platformMock = vi.hoisted(() => ({
  getStorage: vi.fn(),
  setStorage: vi.fn().mockResolvedValue(undefined),
  removeStorage: vi.fn().mockResolvedValue(undefined),
  reLaunch: vi.fn().mockResolvedValue(undefined),
}))
const clearBabiesMock = vi.hoisted(() => vi.fn())
const refreshSessionMock = vi.hoisted(() => vi.fn())
const revokeSessionMock = vi.hoisted(() => vi.fn())
const updateCurrentUserMock = vi.hoisted(() => vi.fn())

vi.mock('@tarojs/taro', () => ({ default: { request: vi.fn() } }))
vi.mock('../../platform', () => ({ platform: platformMock }))
vi.mock('../babies/store', () => ({
  clearBabies: clearBabiesMock,
  loadBabies: vi.fn(),
}))
vi.mock('./api', () => ({
  refreshSession: refreshSessionMock,
  revokeSession: revokeSessionMock,
  updateCurrentUser: updateCurrentUserMock,
}))

const OLD_USER_ID = '11111111-1111-4111-8111-111111111111'
const NEW_USER_ID = '22222222-2222-4222-8222-222222222222'

function session(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: 'old-access',
    accessTokenExpiresAt: '2026-07-17T01:00:00.000Z',
    refreshToken: 'old-refresh',
    refreshTokenExpiresAt: '2099-07-17T01:00:00.000Z',
    user: { id: OLD_USER_ID, displayName: 'Test user', avatarUrl: null },
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('auth session store', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    platformMock.setStorage.mockResolvedValue(undefined)
    platformMock.removeStorage.mockResolvedValue(undefined)
    platformMock.reLaunch.mockResolvedValue(undefined)
  })

  it('clears an expired cold-start session and current baby before navigating to login', async () => {
    platformMock.getStorage.mockResolvedValue(session({
      refreshTokenExpiresAt: '2020-01-01T00:00:00.000Z',
    }))
    const { requireSession } = await import('./navigation')
    const { getAuthState } = await import('./store')

    await expect(requireSession()).resolves.toBe(false)

    expect(getAuthState()).toEqual({ status: 'anonymous' })
    expect(clearBabiesMock).toHaveBeenCalledTimes(1)
    expect(platformMock.removeStorage).toHaveBeenCalledWith('baby-mp.session.v1')
    expect(platformMock.reLaunch).toHaveBeenCalledWith('/pages/auth/index')
  })

  it.each([
    ['malformed access expiry', { accessTokenExpiresAt: 'not-a-date' }],
    ['non-ISO refresh expiry', { refreshTokenExpiresAt: '2099-07-17' }],
    ['invalid user id', { user: { id: 'user-1', displayName: null, avatarUrl: null } }],
  ])('rejects stored session data with %s', async (_label, overrides) => {
    platformMock.getStorage.mockResolvedValue(session(overrides))
    const { getAuthState, restoreAuth } = await import('./store')

    await restoreAuth()

    expect(getAuthState()).toEqual({ status: 'anonymous' })
    expect(clearBabiesMock).toHaveBeenCalledTimes(1)
  })

  it('refreshes an expired access token, persists rotation, and retries the original request', async () => {
    const rotated = session({
      accessToken: 'rotated-access',
      accessTokenExpiresAt: '2099-07-17T01:00:00.000Z',
      refreshToken: 'rotated-refresh',
    })
    refreshSessionMock.mockResolvedValue(rotated)
    const transport = vi.fn()
      .mockResolvedValueOnce({ statusCode: 401, data: { error: { code: 'AUTH_REQUIRED', message: 'expired' } } })
      .mockResolvedValueOnce({ statusCode: 200, data: { data: { status: 'ok', version: '0.1.0' } } })
    const { saveSession, getAuthState } = await import('./store')
    const { createApiClient } = await import('../../services/api-client')
    await saveSession(session({ accessTokenExpiresAt: '2020-01-01T00:00:00.000Z' }))

    await expect(createApiClient('http://localhost:3000', transport).request({
      path: '/api/v1/health', schema: healthResponseSchema,
    })).resolves.toEqual({ data: { status: 'ok', version: '0.1.0' } })

    expect(refreshSessionMock).toHaveBeenCalledOnce()
    expect(transport).toHaveBeenNthCalledWith(2, expect.objectContaining({
      header: expect.objectContaining({ Authorization: 'Bearer rotated-access' }),
    }))
    expect(platformMock.setStorage).toHaveBeenLastCalledWith('baby-mp.session.v1', rotated)
    expect(getAuthState()).toEqual({ status: 'authenticated', session: rotated })
  })

  it('clears local identity and navigates to login when refresh is invalid', async () => {
    refreshSessionMock.mockRejectedValue(new Error('refresh revoked'))
    const transport = vi.fn().mockResolvedValue({
      statusCode: 401,
      data: { error: { code: 'AUTH_REQUIRED', message: 'expired' } },
    })
    const { saveSession, getAuthState } = await import('./store')
    const { createApiClient } = await import('../../services/api-client')
    await saveSession(session())

    await expect(createApiClient('http://localhost:3000', transport).request({
      path: '/api/v1/health', schema: healthResponseSchema,
    })).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 })

    expect(getAuthState()).toEqual({ status: 'anonymous' })
    expect(clearBabiesMock).toHaveBeenCalledTimes(1)
    expect(platformMock.removeStorage).toHaveBeenCalledWith('baby-mp.session.v1')
    expect(platformMock.reLaunch).toHaveBeenCalledWith('/pages/auth/index')
  })

  it('does not let a delayed cold-start restore overwrite a newly saved session', async () => {
    const storedRead = deferred<ReturnType<typeof session>>()
    platformMock.getStorage.mockReturnValue(storedRead.promise)
    const { getAuthState, restoreAuth, saveSession } = await import('./store')
    const restore = restoreAuth()
    const newSession = session({
      accessToken: 'new-access', refreshToken: 'new-refresh',
      user: { id: NEW_USER_ID, displayName: 'New user', avatarUrl: null },
    })

    await saveSession(newSession)
    storedRead.resolve(session())
    await restore

    expect(getAuthState()).toEqual({ status: 'authenticated', session: newSession })
  })

  it('updates the current display name while preserving the latest tokens', async () => {
    const original = session()
    const updatedUser = { ...original.user, displayName: '小雨妈妈' }
    updateCurrentUserMock.mockResolvedValue(updatedUser)
    const { getAuthState, saveSession, updateDisplayName } = await import('./store')
    await saveSession(original)

    await updateDisplayName('小雨妈妈')

    const expected = { ...original, user: updatedUser }
    expect(updateCurrentUserMock).toHaveBeenCalledWith('小雨妈妈')
    expect(getAuthState()).toEqual({ status: 'authenticated', session: expected })
    expect(platformMock.setStorage).toHaveBeenLastCalledWith('baby-mp.session.v1', expected)
  })

  it('rejects a profile response for another user without replacing the session', async () => {
    const original = session()
    updateCurrentUserMock.mockResolvedValue({
      id: NEW_USER_ID, displayName: 'Wrong user', avatarUrl: null,
    })
    const { getAuthState, saveSession, updateDisplayName } = await import('./store')
    await saveSession(original)
    platformMock.setStorage.mockClear()

    await expect(updateDisplayName('Wrong user')).rejects.toThrow('登录状态已变化')

    expect(getAuthState()).toEqual({ status: 'authenticated', session: original })
    expect(platformMock.setStorage).not.toHaveBeenCalled()
  })

  it('does not let an in-flight profile update overwrite a newer login', async () => {
    const update = deferred<{ id: string, displayName: string, avatarUrl: null }>()
    updateCurrentUserMock.mockReturnValue(update.promise)
    const { getAuthState, saveSession, updateDisplayName } = await import('./store')
    await saveSession(session())
    const pending = updateDisplayName('Old account name')
    await vi.waitFor(() => expect(updateCurrentUserMock).toHaveBeenCalledOnce())
    const newer = session({
      accessToken: 'new-access', refreshToken: 'new-refresh',
      user: { id: NEW_USER_ID, displayName: 'New user', avatarUrl: null },
    })
    await saveSession(newer)
    update.resolve({ id: OLD_USER_ID, displayName: 'Old account name', avatarUrl: null })

    await expect(pending).rejects.toThrow('登录状态已变化')
    expect(getAuthState()).toEqual({ status: 'authenticated', session: newer })
  })

  it('does not let an in-flight profile update restore a logged-out session', async () => {
    const update = deferred<{ id: string, displayName: string, avatarUrl: null }>()
    updateCurrentUserMock.mockReturnValue(update.promise)
    const { clearSession, getAuthState, saveSession, updateDisplayName } = await import('./store')
    await saveSession(session())
    const pending = updateDisplayName('Old account name')
    await vi.waitFor(() => expect(updateCurrentUserMock).toHaveBeenCalledOnce())
    await clearSession()
    update.resolve({ id: OLD_USER_ID, displayName: 'Old account name', avatarUrl: null })

    await expect(pending).rejects.toThrow('登录状态已变化')
    expect(getAuthState()).toEqual({ status: 'anonymous' })
  })

  it('keeps an updated display name when an older token refresh finishes later', async () => {
    const refresh = deferred<ReturnType<typeof session>>()
    refreshSessionMock.mockReturnValue(refresh.promise)
    updateCurrentUserMock.mockResolvedValue({
      id: OLD_USER_ID, displayName: '小雨妈妈', avatarUrl: null,
    })
    const transport = vi.fn()
      .mockResolvedValueOnce({ statusCode: 401, data: { error: { code: 'AUTH_REQUIRED', message: 'expired' } } })
      .mockResolvedValueOnce({ statusCode: 200, data: { data: { status: 'ok', version: '0.1.0' } } })
    const { getAuthState, saveSession, updateDisplayName } = await import('./store')
    const { createApiClient } = await import('../../services/api-client')
    const original = session()
    await saveSession(original)
    const request = createApiClient('http://localhost:3000', transport).request({
      path: '/api/v1/health', schema: healthResponseSchema,
    })
    await vi.waitFor(() => expect(refreshSessionMock).toHaveBeenCalledOnce())

    const profileRequest = updateDisplayName('小雨妈妈')
    await vi.waitFor(() => expect(updateCurrentUserMock).toHaveBeenCalledOnce())
    const rotated = session({
      accessToken: 'rotated-access', refreshToken: 'rotated-refresh',
      user: { ...original.user, displayName: 'Test user' },
    })
    refresh.resolve(rotated)

    await expect(Promise.all([profileRequest, request])).resolves.toEqual([
      undefined,
      { data: { status: 'ok', version: '0.1.0' } },
    ])
    expect(getAuthState()).toEqual({
      status: 'authenticated',
      session: { ...rotated, user: { ...original.user, displayName: '小雨妈妈' } },
    })
  })

  it('keeps a profile update when refresh starts after the profile request', async () => {
    const update = deferred<{ id: string, displayName: string, avatarUrl: null }>()
    const refresh = deferred<ReturnType<typeof session>>()
    updateCurrentUserMock.mockReturnValue(update.promise)
    refreshSessionMock.mockReturnValue(refresh.promise)
    const transport = vi.fn()
      .mockResolvedValueOnce({ statusCode: 401, data: { error: { code: 'AUTH_REQUIRED', message: 'expired' } } })
      .mockResolvedValueOnce({ statusCode: 200, data: { data: { status: 'ok', version: '0.1.0' } } })
    const { getAuthState, saveSession, updateDisplayName } = await import('./store')
    const { createApiClient } = await import('../../services/api-client')
    const original = session()
    await saveSession(original)

    const profileRequest = updateDisplayName('小雨妈妈')
    await vi.waitFor(() => expect(updateCurrentUserMock).toHaveBeenCalledOnce())
    const apiRequest = createApiClient('http://localhost:3000', transport).request({
      path: '/api/v1/health', schema: healthResponseSchema,
    })
    await vi.waitFor(() => expect(refreshSessionMock).toHaveBeenCalledOnce())

    update.resolve({ id: OLD_USER_ID, displayName: '小雨妈妈', avatarUrl: null })
    refresh.resolve(session({
      accessToken: 'rotated-access', refreshToken: 'rotated-refresh',
      user: { ...original.user, displayName: 'Test user' },
    }))

    await expect(Promise.all([profileRequest, apiRequest])).resolves.toBeDefined()
    expect(getAuthState()).toEqual({
      status: 'authenticated',
      session: expect.objectContaining({
        accessToken: 'rotated-access',
        refreshToken: 'rotated-refresh',
        user: { ...original.user, displayName: '小雨妈妈' },
      }),
    })
  })

  it('does not clear a newer login when an older in-flight refresh fails', async () => {
    const refresh = deferred<ReturnType<typeof session>>()
    refreshSessionMock.mockReturnValue(refresh.promise)
    const transport = vi.fn().mockResolvedValue({
      statusCode: 401,
      data: { error: { code: 'AUTH_REQUIRED', message: 'expired' } },
    })
    const { getAuthState, saveSession } = await import('./store')
    const { createApiClient } = await import('../../services/api-client')
    await saveSession(session())
    const request = createApiClient('http://localhost:3000', transport).request({
      path: '/api/v1/health', schema: healthResponseSchema,
    })
    await vi.waitFor(() => expect(refreshSessionMock).toHaveBeenCalledOnce())
    const newSession = session({
      accessToken: 'new-access', refreshToken: 'new-refresh',
      user: { id: NEW_USER_ID, displayName: 'New user', avatarUrl: null },
    })
    await saveSession(newSession)
    refresh.reject(new Error('old refresh revoked'))

    await expect(request).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(getAuthState()).toEqual({ status: 'authenticated', session: newSession })
    expect(platformMock.reLaunch).not.toHaveBeenCalled()
  })

  it('coalesces concurrent invalid-refresh cleanup without duplicate navigation', async () => {
    const refresh = deferred<ReturnType<typeof session>>()
    refreshSessionMock.mockReturnValue(refresh.promise)
    const transport = vi.fn().mockResolvedValue({
      statusCode: 401,
      data: { error: { code: 'AUTH_REQUIRED', message: 'expired' } },
    })
    const { getAuthState, saveSession } = await import('./store')
    const { createApiClient } = await import('../../services/api-client')
    await saveSession(session())
    const client = createApiClient('http://localhost:3000', transport)
    const first = client.request({ path: '/api/v1/health', schema: healthResponseSchema })
    const second = client.request({ path: '/api/v1/health', schema: healthResponseSchema })
    await vi.waitFor(() => expect(refreshSessionMock).toHaveBeenCalledOnce())
    refresh.reject(new Error('refresh revoked'))

    await Promise.allSettled([first, second])

    expect(getAuthState()).toEqual({ status: 'anonymous' })
    expect(platformMock.reLaunch).toHaveBeenCalledTimes(1)
    expect(clearBabiesMock).toHaveBeenCalledTimes(1)
  })
})
