import { createHash } from 'node:crypto'

import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { BabyGender, InviteStatus, MemberRole, MemberStatus, Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

import type { PrismaService } from '../src/database/prisma.service'
import { FamiliesService } from '../src/families/families.service'

const userId = '11111111-1111-4111-8111-111111111111'
const otherUserId = '22222222-2222-4222-8222-222222222222'
const babyId = '33333333-3333-4333-8333-333333333333'
const memberId = '44444444-4444-4444-8444-444444444444'
const inviteId = '55555555-5555-4555-8555-555555555555'
const key = '66666666-6666-4666-8666-666666666666'
const now = new Date('2026-07-17T00:00:00.000Z')

function service(prisma: object) {
  return new FamiliesService(prisma as PrismaService, { get: vi.fn(() => 'unit-test-secret-value') } as never)
}

function invite(overrides: Record<string, unknown> = {}) {
  return {
    id: inviteId, babyId, role: MemberRole.editor,
    tokenHash: 'a'.repeat(64), status: InviteStatus.pending,
    expiresAt: new Date('2099-07-18T00:00:00.000Z'), createdBy: userId,
    acceptedBy: null, acceptedAt: null, revokedAt: null, createdAt: now,
    creator: { id: userId, displayName: '测试妈妈' },
    ...overrides,
  }
}

function baby() {
  return {
    id: babyId, name: '小宝', gender: BabyGender.unspecified,
    birthDate: new Date('2025-01-01T00:00:00.000Z'), birthTime: null,
    birthHeightCm: null, birthWeightKg: null, avatarMediaId: null,
    createdBy: userId, version: 1, createdAt: now, updatedAt: now, deletedAt: null,
  }
}

function member(overrides: Record<string, unknown> = {}) {
  return {
    id: memberId, babyId, userId: otherUserId, role: MemberRole.editor,
    status: MemberStatus.active, joinedAt: now, invitedBy: userId,
    removedAt: null, removedBy: null, version: 1, createdAt: now, updatedAt: now,
    user: { id: otherUserId, displayName: '测试爸爸' },
    ...overrides,
  }
}

describe('M5 family invite security and idempotency', () => {
  it('stores only a token hash and keeps the raw token out of idempotency/audit rows', async () => {
    let inviteCreateData: Record<string, unknown> = {}
    let idempotencyResponse: unknown
    let auditData: unknown
    const tx = {
      babyMember: { findFirst: vi.fn(async () => member({ userId, role: MemberRole.admin })) },
      idempotencyKey: {
        findUnique: vi.fn(async () => null), create: vi.fn(),
        update: vi.fn(async ({ data }: { data: { responseBody: unknown } }) => { idempotencyResponse = data.responseBody }),
      },
      familyInvite: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { inviteCreateData = data; return invite({ tokenHash: data.tokenHash }) }) },
      auditLog: { create: vi.fn(async ({ data }: { data: unknown }) => { auditData = data }) },
    }
    const prisma = { $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) }
    const created = await service(prisma).createInvite(userId, babyId, key, { role: 'editor', expiresInHours: 24 })
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(inviteCreateData.tokenHash).toBe(createHash('sha256').update(created.token).digest('hex'))
    expect(JSON.stringify({ inviteCreateData, idempotencyResponse, auditData })).not.toContain(created.token)
    expect(idempotencyResponse).toEqual({ inviteId })
  })

  it('rejects editor/viewer creation before persisting an invite', async () => {
    const tx = {
      babyMember: { findFirst: vi.fn(async () => member({ userId, role: MemberRole.editor })) },
      familyInvite: { create: vi.fn() },
    }
    const prisma = { $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) }
    await expect(service(prisma).createInvite(userId, babyId, key, { role: 'viewer', expiresInHours: 24 })).rejects.toBeInstanceOf(ForbiddenException)
    expect(tx.familyInvite.create).not.toHaveBeenCalled()
  })

  it('retries a same-key P2002 and replays the committed invite instead of returning conflict', async () => {
    let attempt = 0
    const tokenHash = createHash('sha256').update('irrelevant').digest('hex')
    const firstTx = {
      babyMember: { findFirst: vi.fn(async () => member({ userId, role: MemberRole.admin })) },
      idempotencyKey: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => { throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '6.11.1' }) }),
      },
    }
    const replayTx = {
      babyMember: firstTx.babyMember,
      idempotencyKey: { findUnique: vi.fn(async () => ({ requestHash: expect.any(String), responseBody: { inviteId } })) },
      familyInvite: { findUnique: vi.fn(async () => invite({ tokenHash })) },
    }
    let storedHash = ''
    replayTx.idempotencyKey.findUnique = vi.fn(async () => ({ requestHash: storedHash, responseBody: { inviteId } }))
    const prisma = { $transaction: vi.fn(async (callback: (value: never) => Promise<unknown>) => {
      attempt += 1
      if (attempt === 1) {
        const original = firstTx.idempotencyKey.create
        firstTx.idempotencyKey.create = vi.fn(async ({ data }: { data: { requestHash: string } }) => { storedHash = data.requestHash; return original() }) as never
        return callback(firstTx as never)
      }
      return callback(replayTx as never)
    }) }
    const created = await service(prisma).createInvite(userId, babyId, key, { role: 'editor', expiresInHours: 24 })
    expect(attempt).toBe(2)
    expect(created.id).toBe(inviteId)
  })

  it('previews only the safe baby/inviter summary and effective status', async () => {
    const token = 'A'.repeat(43)
    const prisma = { familyInvite: { findUnique: vi.fn(async () => invite({ baby: { id: babyId, name: '小宝' } })) } }
    const preview = await service(prisma).preview(token)
    expect(preview).toEqual({
      baby: { id: babyId, name: '小宝', avatarUrl: null },
      inviter: { id: userId, displayName: '测试妈妈', avatarUrl: null },
      role: 'editor', status: 'pending', expiresAt: '2099-07-18T00:00:00.000Z',
    })
    expect(preview).not.toHaveProperty('records')
    expect(preview).not.toHaveProperty('members')
  })
})

describe('M5 invite acceptance, membership and ACL', () => {
  it('restores a removed relationship, consumes the invite and audits atomically', async () => {
    const token = 'B'.repeat(43)
    const removed = member({ status: MemberStatus.removed, removedAt: now, removedBy: userId, version: 4 })
    let restoreData: Record<string, unknown> = {}
    let accepted = false
    const tx = {
      idempotencyKey: { findUnique: vi.fn(async () => null), create: vi.fn(), update: vi.fn() },
      familyInvite: {
        findUnique: vi.fn(async () => invite({ tokenHash: createHash('sha256').update(token).digest('hex') })),
        updateMany: vi.fn(async () => { accepted = true; return { count: 1 } }),
      },
      babyMember: {
        findUnique: vi.fn(async () => removed),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { restoreData = data; return member({ version: 5 }) }),
        findFirst: vi.fn(async () => member({ baby: baby() })),
      },
      auditLog: { create: vi.fn() },
    }
    const prisma = { $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) }
    const result = await service(prisma).acceptInvite(otherUserId, key, token, 'request-1')
    expect(accepted).toBe(true)
    expect(restoreData).toMatchObject({ status: MemberStatus.active, removedAt: null, removedBy: null, invitedBy: userId })
    expect(tx.auditLog.create).toHaveBeenCalledOnce()
    expect(result.baby.id).toBe(babyId)
  })

  it.each([
    [InviteStatus.revoked, 'INVITE_REVOKED'],
    [InviteStatus.accepted, 'INVITE_ALREADY_USED'],
    [InviteStatus.expired, 'INVITE_EXPIRED'],
  ])('rejects %s invitations with %s', async (status, code) => {
    const token = 'C'.repeat(43)
    const tx = {
      idempotencyKey: { findUnique: vi.fn(async () => null) },
      familyInvite: { findUnique: vi.fn(async () => invite({ status })) },
      babyMember: { findUnique: vi.fn(async () => null) },
    }
    const prisma = { $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) }
    try { await service(prisma).acceptInvite(otherUserId, key, token); throw new Error('expected rejection') }
    catch (error) { expect(error).toBeInstanceOf(ConflictException); expect((error as ConflictException).getResponse()).toMatchObject({ code }) }
  })

  it('returns ALREADY_A_MEMBER without consuming a pending invite', async () => {
    const tx = {
      idempotencyKey: { findUnique: vi.fn(async () => null) },
      familyInvite: { findUnique: vi.fn(async () => invite()), updateMany: vi.fn() },
      babyMember: { findUnique: vi.fn(async () => member()) },
    }
    const prisma = { $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) }
    await expect(service(prisma).acceptInvite(otherUserId, key, 'D'.repeat(43))).rejects.toMatchObject({ response: { code: 'ALREADY_A_MEMBER' } })
    expect(tx.familyInvite.updateMany).not.toHaveBeenCalled()
  })

  it('uses 404 for cross-baby member IDs and 403 for a known non-admin role', async () => {
    const crossTx = {
      babyMember: { findFirst: vi.fn().mockResolvedValueOnce(member({ userId, role: MemberRole.admin })).mockResolvedValueOnce(null) },
    }
    const crossPrisma = { $transaction: vi.fn(async (callback: (value: typeof crossTx) => Promise<unknown>) => callback(crossTx)) }
    await expect(service(crossPrisma).updateMember(userId, babyId, memberId, { version: 1, role: 'viewer' })).rejects.toBeInstanceOf(NotFoundException)

    const deniedTx = { babyMember: { findFirst: vi.fn(async () => member({ userId, role: MemberRole.editor })) } }
    const deniedPrisma = { $transaction: vi.fn(async (callback: (value: typeof deniedTx) => Promise<unknown>) => callback(deniedTx)) }
    await expect(service(deniedPrisma).removeMember(userId, babyId, memberId, 1)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('protects the last admin and writes audit in the same successful role-change transaction', async () => {
    const lastTx = {
      babyMember: {
        findFirst: vi.fn().mockResolvedValueOnce(member({ userId, role: MemberRole.admin })).mockResolvedValueOnce(member({ role: MemberRole.admin })),
        count: vi.fn(async () => 1), updateMany: vi.fn(),
      },
    }
    const lastPrisma = { $transaction: vi.fn(async (callback: (value: typeof lastTx) => Promise<unknown>) => callback(lastTx)) }
    await expect(service(lastPrisma).updateMember(userId, babyId, memberId, { version: 1, role: 'viewer' })).rejects.toMatchObject({ response: { code: 'LAST_ADMIN_REQUIRED' } })
    expect(lastTx.babyMember.updateMany).not.toHaveBeenCalled()

    const okTx = {
      babyMember: {
        findFirst: vi.fn().mockResolvedValueOnce(member({ userId, role: MemberRole.admin })).mockResolvedValueOnce(member({ role: MemberRole.editor })),
        updateMany: vi.fn(async () => ({ count: 1 })), findUniqueOrThrow: vi.fn(async () => member({ role: MemberRole.viewer, version: 2 })),
      },
      auditLog: { create: vi.fn() },
    }
    const okPrisma = { $transaction: vi.fn(async (callback: (value: typeof okTx) => Promise<unknown>) => callback(okTx)) }
    await service(okPrisma).updateMember(userId, babyId, memberId, { version: 1, role: 'viewer' }, 'request-2')
    expect(okTx.auditLog.create).toHaveBeenCalledOnce()
  })
})

describe('family self-leave', () => {
  it('removes only the current active membership and audits the self-service exit atomically', async () => {
    let updateWhere: Record<string, unknown> = {}
    let auditData: Record<string, unknown> = {}
    const current = member({ userId, role: MemberRole.editor, version: 3 })
    const tx = {
      babyMember: {
        findFirst: vi.fn(async () => current),
        updateMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          updateWhere = where
          return { count: 1 }
        }),
      },
      auditLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          auditData = data
        }),
      },
    }
    const prisma = { $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) }

    await service(prisma).leaveFamily(userId, babyId, 3, 'leave-request')

    expect(updateWhere).toEqual({
      id: memberId,
      babyId,
      userId,
      status: MemberStatus.active,
      version: 3,
    })
    expect(auditData).toMatchObject({
      actorUserId: userId,
      babyId,
      action: 'family.member.left',
      resourceType: 'baby_member',
      resourceId: memberId,
      requestId: 'leave-request',
      metadata: { previousRole: MemberRole.editor },
    })
  })

  it('does not reveal an unavailable or cross-baby membership', async () => {
    const tx = { babyMember: { findFirst: vi.fn(async () => null), updateMany: vi.fn() } }
    const prisma = { $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) }

    await expect(service(prisma).leaveFamily(userId, babyId, 1)).rejects.toBeInstanceOf(NotFoundException)
    expect(tx.babyMember.updateMany).not.toHaveBeenCalled()
  })

  it('prevents the last admin from leaving but allows an admin when another admin remains', async () => {
    const lastAdmin = member({ userId, role: MemberRole.admin })
    const lastTx = {
      babyMember: {
        findFirst: vi.fn(async () => lastAdmin),
        count: vi.fn(async () => 1),
        updateMany: vi.fn(),
      },
    }
    const lastPrisma = { $transaction: vi.fn(async (callback: (value: typeof lastTx) => Promise<unknown>) => callback(lastTx)) }

    await expect(service(lastPrisma).leaveFamily(userId, babyId, 1)).rejects.toMatchObject({
      response: { code: 'LAST_ADMIN_REQUIRED' },
    })
    expect(lastTx.babyMember.updateMany).not.toHaveBeenCalled()

    const okTx = {
      babyMember: {
        findFirst: vi.fn(async () => lastAdmin),
        count: vi.fn(async () => 2),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      auditLog: { create: vi.fn() },
    }
    const okPrisma = { $transaction: vi.fn(async (callback: (value: typeof okTx) => Promise<unknown>) => callback(okTx)) }

    await expect(service(okPrisma).leaveFamily(userId, babyId, 1)).resolves.toBeUndefined()
    expect(okTx.auditLog.create).toHaveBeenCalledOnce()
  })

  it('rejects a stale membership version without auditing a leave', async () => {
    const tx = {
      babyMember: {
        findFirst: vi.fn(async () => member({ userId, role: MemberRole.viewer, version: 2 })),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      auditLog: { create: vi.fn() },
    }
    const prisma = { $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) }

    await expect(service(prisma).leaveFamily(userId, babyId, 1)).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT' },
    })
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it('immediately denies the departed member when the same access token reads the family again', async () => {
    let active = true
    const current = member({ userId, role: MemberRole.viewer })
    const prisma = {
      babyMember: {
        findFirst: vi.fn(async () => active ? current : null),
        findMany: vi.fn(),
      },
      $transaction: vi.fn(async (callback: (value: {
        babyMember: {
          findFirst: () => Promise<ReturnType<typeof member> | null>
          updateMany: () => Promise<{ count: number }>
        }
        auditLog: { create: () => Promise<void> }
      }) => Promise<unknown>) => callback({
        babyMember: {
          findFirst: async () => active ? current : null,
          updateMany: async () => {
            active = false
            return { count: 1 }
          },
        },
        auditLog: { create: async () => undefined },
      })),
    }
    const families = service(prisma)

    await families.leaveFamily(userId, babyId, 1)

    await expect(families.listMembers(userId, babyId)).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.babyMember.findMany).not.toHaveBeenCalled()
  })
})
