import { describe, expect, it, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn())

vi.mock('../../services/api-client', () => ({
  createApiClient: () => ({ request: requestMock }),
}))

import { updateCurrentUser } from './api'

const USER_ID = '11111111-1111-4111-8111-111111111111'

describe('auth API', () => {
  it('updates the current user display name through the shared contract', async () => {
    const user = { id: USER_ID, displayName: '小雨妈妈', avatarUrl: null }
    requestMock.mockImplementationOnce(async ({ schema }) => {
      const parsed = schema.safeParse({ data: user })
      if (!parsed.success) throw parsed.error
      return parsed.data
    })

    await expect(updateCurrentUser('  小雨妈妈  ')).resolves.toEqual(user)

    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
      path: '/api/v1/users/me',
      method: 'PATCH',
      body: { displayName: '小雨妈妈' },
    }))
  })

  it('rejects a response that is not a valid user summary', async () => {
    requestMock.mockImplementationOnce(async ({ schema }) => {
      const parsed = schema.safeParse({ data: { id: 'wrong', displayName: '妈妈', avatarUrl: null } })
      if (!parsed.success) throw parsed.error
      return parsed.data
    })

    await expect(updateCurrentUser('妈妈')).rejects.toBeDefined()
  })
})
