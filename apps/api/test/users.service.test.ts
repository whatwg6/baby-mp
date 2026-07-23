import { BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { PrismaService } from '../src/database/prisma.service'
import { UsersService } from '../src/users/users.service'

const userId = '11111111-1111-4111-8111-111111111111'

function service(prisma: object) {
  return new UsersService(prisma as PrismaService)
}

describe('UsersService', () => {
  it('trims and updates only the authenticated user id', async () => {
    const update = vi.fn(async () => ({ id: userId, displayName: '小雨妈妈' }))

    await expect(service({ user: { update } }).updateCurrentUser(
      userId,
      { displayName: '  小雨妈妈  ' },
    )).resolves.toEqual({ id: userId, displayName: '小雨妈妈', avatarUrl: null })

    expect(update).toHaveBeenCalledWith({
      where: { id: userId },
      data: { displayName: '小雨妈妈' },
      select: { id: true, displayName: true },
    })
  })

  it('rejects invalid input without echoing the submitted value', async () => {
    const submitted = `private-${'x'.repeat(81)}`
    const update = vi.fn()

    const failure = await service({ user: { update } })
      .updateCurrentUser(userId, { displayName: submitted })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(BadRequestException)
    expect(JSON.stringify((failure as BadRequestException).getResponse())).not.toContain(submitted)
    expect((failure as BadRequestException).getResponse()).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ field: 'displayName' }],
    })
    expect(update).not.toHaveBeenCalled()
  })
})
