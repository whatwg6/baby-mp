import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { describe, expect, it, vi } from 'vitest'

import { AuthenticationGuard } from '../src/auth/authentication.guard'
import type { RequestWithContext } from '../src/common/http/request-context'
import { UpdateCurrentUserDto } from '../src/users/user.dto'
import { UsersController } from '../src/users/users.controller'
import type { UsersService } from '../src/users/users.service'

const userId = '11111111-1111-4111-8111-111111111111'

describe('UsersController', () => {
  const pipe = new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  })

  it('authenticates the route and derives ownership only from request context', async () => {
    const updateCurrentUser = vi.fn(async () => ({ id: userId, displayName: '妈妈', avatarUrl: null }))
    const controller = new UsersController({ updateCurrentUser } as unknown as UsersService)
    const request = { user: { id: userId } } as RequestWithContext

    await expect(controller.updateMe(request, { displayName: '妈妈' }))
      .resolves.toEqual({ data: { id: userId, displayName: '妈妈', avatarUrl: null } })
    expect(updateCurrentUser).toHaveBeenCalledWith(userId, { displayName: '妈妈' })

    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      UsersController.prototype.updateMe,
    ) as unknown[]
    expect(guards).toContain(AuthenticationGuard)
  })

  it('trims valid input and rejects blank or extra fields before controller execution', async () => {
    await expect(pipe.transform(
      { displayName: '  妈妈  ' },
      { type: 'body', metatype: UpdateCurrentUserDto },
    )).resolves.toMatchObject({ displayName: '妈妈' })
    await expect(pipe.transform(
      { displayName: '   ' },
      { type: 'body', metatype: UpdateCurrentUserDto },
    )).rejects.toBeInstanceOf(BadRequestException)
    await expect(pipe.transform(
      { displayName: '妈妈', userId: crypto.randomUUID() },
      { type: 'body', metatype: UpdateCurrentUserDto },
    )).rejects.toBeInstanceOf(BadRequestException)
  })

  it('counts display-name length by Unicode code point', async () => {
    await expect(pipe.transform(
      { displayName: '😀'.repeat(80) },
      { type: 'body', metatype: UpdateCurrentUserDto },
    )).resolves.toMatchObject({ displayName: '😀'.repeat(80) })
    await expect(pipe.transform(
      { displayName: '😀'.repeat(81) },
      { type: 'body', metatype: UpdateCurrentUserDto },
    )).rejects.toBeInstanceOf(BadRequestException)
  })
})
