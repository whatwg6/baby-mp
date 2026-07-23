import { BadRequestException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import {
  BabyGender,
  ExportStatus,
  InviteStatus,
  MediaPurpose,
  MediaStatus,
  MemberRole,
  MemberStatus,
} from '@prisma/client'
import { validate } from 'class-validator'
import { describe, expect, it, vi } from 'vitest'

import { BabiesService } from '../src/babies/babies.service'
import { CreateBabyDto } from '../src/babies/baby.dto'
import type { Environment } from '../src/config/environment'
import type { PrismaService } from '../src/database/prisma.service'
import type { MediaService } from '../src/media/media.service'

const userId = '11111111-1111-4111-8111-111111111111'
const key = '22222222-2222-4222-8222-222222222222'
const input = {
  name: '安安',
  gender: 'female' as const,
  birthDate: '2025-01-02',
}

function config(): ConfigService<Environment, true> {
  return {
    get: vi.fn((name: keyof Environment) =>
      name === 'BUSINESS_TIME_ZONE' ? 'Asia/Shanghai' : undefined),
  } as unknown as ConfigService<Environment, true>
}

function mediaService(): MediaService {
  return {
    accessUrlFor: vi.fn(async () => 'https://media.example.test/avatar'),
  } as unknown as MediaService
}

function babyRecord() {
  const now = new Date('2026-01-01T00:00:00.000Z')
  return {
    id: '33333333-3333-4333-8333-333333333333',
    name: input.name,
    gender: BabyGender.female,
    birthDate: new Date(`${input.birthDate}T00:00:00.000Z`),
    birthTime: null,
    birthHeightCm: null,
    birthWeightKg: null,
    avatarMediaId: null,
    createdBy: userId,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
}

describe('BabiesService consistency', () => {
  it('creates only one baby for concurrent requests with the same idempotency key', async () => {
    const idempotency = new Map<string, {
      requestHash: string
      responseBody: unknown
    }>()
    let babyCreates = 0
    let transactionTail = Promise.resolve()

    const tx = {
      idempotencyKey: {
        findUnique: vi.fn(async () => idempotency.get(key) ?? null),
        create: vi.fn(async ({ data }: { data: { requestHash: string } }) => {
          idempotency.set(key, { requestHash: data.requestHash, responseBody: null })
          return data
        }),
        update: vi.fn(async ({ data }: { data: { responseBody: unknown } }) => {
          const row = idempotency.get(key)!
          row.responseBody = data.responseBody
          return row
        }),
      },
      baby: {
        create: vi.fn(async () => {
          babyCreates += 1
          return babyRecord()
        }),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => {
        const previous = transactionTail
        let release!: () => void
        transactionTail = new Promise<void>((resolve) => { release = resolve })
        await previous
        try {
          return await callback(tx)
        } finally {
          release()
        }
      }),
    } as unknown as PrismaService
    const service = new BabiesService(prisma, config(), mediaService())

    const [first, second] = await Promise.all([
      service.create(userId, key, input),
      service.create(userId, key, input),
    ])

    expect(first).toEqual(second)
    expect(first.id).toBe('33333333-3333-4333-8333-333333333333')
    expect(babyCreates).toBe(1)
    expect(tx.idempotencyKey.create).toHaveBeenCalledTimes(1)
  })

  it('does not start a transaction when service-level validation fails', async () => {
    const transaction = vi.fn()
    const service = new BabiesService(
      { $transaction: transaction } as unknown as PrismaService,
      config(),
      mediaService(),
    )

    await expect(service.create(userId, key, { ...input, name: '   ' }))
      .rejects.toBeInstanceOf(BadRequestException)
    await expect(service.create(userId, key, { ...input, birthDate: '2999-01-01' }))
      .rejects.toBeInstanceOf(BadRequestException)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('rejects invalid DTO fields before persistence is invoked', async () => {
    const invalidInputs = [
      { ...input, gender: 'unknown' },
      { ...input, birthTime: '25:00' },
      { ...input, birthHeightCm: 19 },
      { ...input, birthWeightKg: 301 },
    ]

    for (const value of invalidInputs) {
      const dto = Object.assign(new CreateBabyDto(), value)
      expect(await validate(dto)).not.toHaveLength(0)
    }
  })

  it('keeps baby, membership, and idempotency response uncommitted when the transaction fails', async () => {
    const committed = { babies: 0, memberships: 0, idempotencyKeys: 0, responses: 0 }
    const tx = {
      idempotencyKey: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: unknown }) => data),
        update: vi.fn(async () => {
          throw new Error('fault after baby and membership creation')
        }),
      },
      baby: {
        create: vi.fn(async () => babyRecord()),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => {
        const staged = { babies: 0, memberships: 0, idempotencyKeys: 0, responses: 0 }
        tx.idempotencyKey.create.mockImplementationOnce(async ({ data }: { data: unknown }) => {
          staged.idempotencyKeys += 1
          return data
        })
        tx.baby.create.mockImplementationOnce(async () => {
          staged.babies += 1
          staged.memberships += 1
          return babyRecord()
        })
        tx.idempotencyKey.update.mockImplementationOnce(async () => {
          staged.responses += 1
          throw new Error('fault after baby and membership creation')
        })
        const result = await callback(tx)
        Object.assign(committed, staged)
        return result
      }),
    } as unknown as PrismaService
    const service = new BabiesService(prisma, config(), mediaService())

    await expect(service.create(userId, key, input))
      .rejects.toThrow('fault after baby and membership creation')
    expect(tx.baby.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        members: { create: { userId, role: MemberRole.admin, status: MemberStatus.active } },
      }),
    }))
    expect(committed).toEqual({ babies: 0, memberships: 0, idempotencyKeys: 0, responses: 0 })
  })

  it('signs a short-lived URL for a ready baby avatar in list responses', async () => {
    const avatar = {
      objectKey: 'media/private-avatar.jpg',
      status: MediaStatus.ready,
    }
    const accessUrlFor = vi.fn(async () => 'https://media.example.test/signed-avatar')
    const findMany = vi.fn(async () => [{
      id: 'membership-1',
      role: MemberRole.admin,
      baby: { ...babyRecord(), avatarMediaId: '44444444-4444-4444-8444-444444444444', avatarMedia: avatar },
    }])
    const prisma = {
      babyMember: {
        findMany,
      },
    } as unknown as PrismaService
    const service = new BabiesService(
      prisma,
      config(),
      { accessUrlFor } as unknown as MediaService,
    )

    const result = await service.list(userId)

    expect(result[0]?.avatarUrl).toBe('https://media.example.test/signed-avatar')
    expect(accessUrlFor).toHaveBeenCalledWith(avatar)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
    }))
  })

  it('rejects an avatar that is not a ready image belonging to the target baby', async () => {
    const current = {
      ...babyRecord(),
      members: [{ role: MemberRole.admin }],
    }
    const updateMany = vi.fn()
    const tx = {
      media: {
        findFirst: vi.fn(async () => null),
      },
      baby: { updateMany },
    }
    const prisma = {
      baby: {
        findFirst: vi.fn(async () => current),
        updateMany,
      },
      $transaction: vi.fn(async (
        callback: (client: typeof tx) => Promise<unknown>,
      ) => callback(tx)),
    } as unknown as PrismaService
    const service = new BabiesService(prisma, config(), mediaService())
    const avatarMediaId = '44444444-4444-4444-8444-444444444444'

    await expect(service.update(userId, current.id, {
      version: 1,
      avatarMediaId,
    })).rejects.toBeInstanceOf(BadRequestException)

    expect(tx.media.findFirst).toHaveBeenCalledWith({
      where: {
        id: avatarMediaId,
        babyId: current.id,
        purpose: MediaPurpose.record_image,
        status: MediaStatus.ready,
        deletedAt: null,
        mimeType: { in: ['image/jpeg', 'image/png'] },
      },
      select: { id: true },
    })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('soft deletes a baby and immediately revokes access and active work atomically', async () => {
    const tx = {
      babyMember: {
        findFirst: vi.fn(async () => ({ id: '55555555-5555-4555-8555-555555555555' })),
        updateMany: vi.fn(async () => ({ count: 3 })),
      },
      baby: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      familyInvite: {
        updateMany: vi.fn(async () => ({ count: 2 })),
      },
      exportJob: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      auditLog: {
        create: vi.fn(async () => ({})),
      },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    } as unknown as PrismaService
    const service = new BabiesService(prisma, config(), mediaService())
    const babyId = babyRecord().id

    await service.remove(userId, babyId, 'request-1')

    expect(tx.babyMember.findFirst).toHaveBeenCalledWith({
      where: {
        userId,
        babyId,
        role: MemberRole.admin,
        status: MemberStatus.active,
        baby: { deletedAt: null },
      },
      select: { id: true },
    })
    expect(tx.baby.updateMany).toHaveBeenCalledWith({
      where: { id: babyId, deletedAt: null },
      data: { deletedAt: expect.any(Date), version: { increment: 1 } },
    })
    expect(tx.babyMember.updateMany).toHaveBeenCalledWith({
      where: { babyId, status: MemberStatus.active },
      data: {
        status: MemberStatus.removed,
        removedAt: expect.any(Date),
        removedBy: userId,
        version: { increment: 1 },
      },
    })
    expect(tx.familyInvite.updateMany).toHaveBeenCalledWith({
      where: { babyId, status: InviteStatus.pending },
      data: { status: InviteStatus.revoked, revokedAt: expect.any(Date) },
    })
    expect(tx.exportJob.updateMany).toHaveBeenCalledWith({
      where: {
        babyId,
        status: { in: [ExportStatus.pending, ExportStatus.processing] },
      },
      data: {
        status: ExportStatus.failed,
        resultMediaId: null,
        errorCode: 'BABY_DELETED',
        workerLeaseId: null,
        leaseExpiresAt: null,
      },
    })
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: userId,
        babyId,
        action: 'baby.deleted',
        resourceType: 'baby',
        resourceId: babyId,
        requestId: 'request-1',
        metadata: {},
      },
    })
  })
})
