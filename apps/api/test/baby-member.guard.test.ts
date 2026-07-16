import { NotFoundException, type ExecutionContext } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import { describe, expect, it, vi } from 'vitest'

import { BabyMemberGuard } from '../src/families/authorization/baby-member.guard'
import type {
  BabyMembershipRepository,
  BabyResourceResolver,
} from '../src/families/authorization/baby-authorization.port'

const userId = '11111111-1111-4111-8111-111111111111'
const babyId = '22222222-2222-4222-8222-222222222222'

function context() {
  const request = { user: { id: userId } }
  return {
    request,
    execution: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
    } as unknown as ExecutionContext,
  }
}

describe('BabyMemberGuard', () => {
  it('forbids an editor from patching an admin-only baby resource', async () => {
    const { execution } = context()
    const guard = new BabyMemberGuard(
      { getAllAndOverride: vi.fn(() => ['admin']) } as unknown as Reflector,
      { resolve: vi.fn(async () => ({ babyId })) } as BabyResourceResolver,
      {
        findActiveMembership: vi.fn(async () => ({ userId, babyId, role: 'editor' })),
      } as BabyMembershipRepository,
    )

    await expect(guard.canActivate(execution)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('checks current membership on every request so removal blocks an existing access token immediately', async () => {
    const { execution } = context()
    let membershipActive = true
    const findActiveMembership = vi.fn(async () => membershipActive
      ? { userId, babyId, role: 'admin' as const }
      : null)
    const guard = new BabyMemberGuard(
      { getAllAndOverride: vi.fn(() => ['admin']) } as unknown as Reflector,
      { resolve: vi.fn(async () => ({ babyId })) } as BabyResourceResolver,
      { findActiveMembership } as BabyMembershipRepository,
    )

    await expect(guard.canActivate(execution)).resolves.toBe(true)
    membershipActive = false
    await expect(guard.canActivate(execution)).rejects.toBeInstanceOf(NotFoundException)
    expect(findActiveMembership).toHaveBeenCalledTimes(2)
  })

  it('uses the same not-found response for a missing resource and an inaccessible existing resource', async () => {
    const makeGuard = (resourceExists: boolean) => new BabyMemberGuard(
      { getAllAndOverride: vi.fn() } as unknown as Reflector,
      {
        resolve: vi.fn(async () => resourceExists ? { babyId } : null),
      } as BabyResourceResolver,
      {
        findActiveMembership: vi.fn(async () => null),
      } as BabyMembershipRepository,
    )
    const missingError = await makeGuard(false).canActivate(context().execution)
      .catch((error: unknown) => error)
    const foreignError = await makeGuard(true).canActivate(context().execution)
      .catch((error: unknown) => error)

    expect(missingError).toBeInstanceOf(NotFoundException)
    expect(foreignError).toBeInstanceOf(NotFoundException)
    expect((missingError as NotFoundException).getResponse())
      .toEqual((foreignError as NotFoundException).getResponse())
  })
})
