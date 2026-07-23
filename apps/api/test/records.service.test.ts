import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { MemberRole, RecordType } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

import type { PrismaService } from '../src/database/prisma.service'
import type { MediaService } from '../src/media/media.service'
import { RecordsService } from '../src/records/records.service'

const userId = 'a1111111-1111-4111-8111-111111111111'
const babyId = 'b1111111-1111-4111-8111-111111111111'
const recordId = 'c1111111-1111-4111-8111-111111111111'

const record = {
  id: recordId,
  babyId,
  type: RecordType.note,
  title: null,
  content: '正文',
  occurredAt: new Date('2026-07-17T00:00:00.000Z'),
  createdBy: userId,
  updatedBy: userId,
  metadata: {},
  version: 1,
  createdAt: new Date('2026-07-17T00:00:01.000Z'),
  updatedAt: new Date('2026-07-17T00:00:01.000Z'),
  deletedAt: null,
  deletedBy: null,
  measurement: null,
  creator: { id: userId, displayName: null },
  media: [],
}

describe('RecordsService', () => {
  it('binds an opaque timeline cursor to its baby and filter context', async () => {
    const prisma = {
      babyMember: { findFirst: vi.fn().mockResolvedValue({ role: MemberRole.admin, baby: { birthDate: new Date('2025-01-01') } }) },
      record: { findMany: vi.fn().mockResolvedValue([record, { ...record, id: 'd1111111-1111-4111-8111-111111111111' }]) },
    }
    const service = new RecordsService(
      prisma as unknown as PrismaService,
      { accessUrlFor: vi.fn() } as unknown as MediaService,
      { get: vi.fn().mockReturnValue('Asia/Shanghai') } as never,
    )
    const first = await service.list(userId, babyId, { type: 'note', limit: 1 })
    expect(first.meta.nextCursor).toEqual(expect.any(String))

    await service.list(userId, babyId, { type: 'note', limit: 1, cursor: first.meta.nextCursor! })
    expect(prisma.record.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: expect.any(Array) }),
    }))

    await expect(service.list(userId, babyId, {
      type: 'measurement', limit: 1, cursor: first.meta.nextCursor!,
    })).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects viewer writes inside the same transaction that checks membership', async () => {
    const prisma = {
      babyMember: { findFirst: vi.fn().mockResolvedValue({ role: MemberRole.viewer, baby: { birthDate: new Date('2025-01-01') } }) },
      $transaction: vi.fn().mockImplementation((work: (client: unknown) => unknown) => work(prisma)),
    }
    const service = new RecordsService(
      prisma as unknown as PrismaService,
      {} as MediaService,
      { get: vi.fn().mockReturnValue('Asia/Shanghai') } as never,
    )

    await expect(service.create(userId, babyId, 'e1111111-1111-4111-8111-111111111111', {
      type: 'note', content: '正文', occurredAt: '2026-07-17T08:00:00+08:00', mediaIds: [],
    })).rejects.toBeInstanceOf(ForbiddenException)
  })
})
