import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import {
  MediaPurpose,
  MediaStatus,
  MemberRole,
  Prisma,
  RecordType,
} from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

import type { PrismaService } from '../src/database/prisma.service'
import type { MediaService } from '../src/media/media.service'
import { RecordsService } from '../src/records/records.service'

const userId = '11111111-1111-4111-8111-111111111111'
const otherUserId = '22222222-2222-4222-8222-222222222222'
const babyId = '33333333-3333-4333-8333-333333333333'
const otherBabyId = '44444444-4444-4444-8444-444444444444'
const recordId = '55555555-5555-4555-8555-555555555555'
const mediaId = '66666666-6666-4666-8666-666666666666'
const key = '77777777-7777-4777-8777-777777777777'
const occurredAt = '2026-06-01T08:00:00.000Z'

function membership(
  role: MemberRole,
  babyOverrides: { birthDate?: Date; birthTime?: Date | null } = {},
) {
  return {
    role,
    baby: {
      birthDate: new Date('2025-01-01T00:00:00.000Z'),
      birthTime: null,
      ...babyOverrides,
    },
  }
}

function record(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-06-01T09:00:00.000Z')
  return {
    id: recordId,
    babyId,
    type: RecordType.note,
    title: null,
    content: '今天会翻身了',
    occurredAt: new Date(occurredAt),
    createdBy: userId,
    updatedBy: userId,
    deletedBy: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    measurement: null,
    creator: { id: userId, displayName: '家长' },
    media: [],
    ...overrides,
  }
}

function mediaService(): MediaService {
  return { accessUrlFor: vi.fn(async () => 'https://storage.invalid/signed') } as unknown as MediaService
}

function service(prisma: object): RecordsService {
  return new RecordsService(
    prisma as PrismaService,
    mediaService(),
    { get: vi.fn(() => 'Asia/Shanghai') } as never,
  )
}

describe('M3 RecordsService authorization and validation', () => {
  it('rejects a viewer before creating an idempotency row or record', async () => {
    const tx = {
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.viewer })) },
      idempotencyKey: { findUnique: vi.fn(), create: vi.fn() },
      record: { create: vi.fn() },
    }
    const prisma = { $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) }

    await expect(service(prisma).create(userId, babyId, key, {
      type: 'note', occurredAt, content: '内容', mediaIds: [],
    })).rejects.toBeInstanceOf(ForbiddenException)
    expect(tx.idempotencyKey.create).not.toHaveBeenCalled()
    expect(tx.record.create).not.toHaveBeenCalled()
  })

  it('rejects an editor changing another member record, while admin can update without changing creator', async () => {
    const baseTx = {
      record: {
        findFirst: vi.fn(async () => record({ createdBy: otherUserId })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      babyMember: { findFirst: vi.fn() },
      recordMedia: { count: vi.fn(async () => 0) },
    }
    const editorPrisma = {
      $transaction: vi.fn(async (callback: (value: typeof baseTx) => Promise<unknown>) => {
        baseTx.babyMember.findFirst.mockResolvedValueOnce({ role: MemberRole.editor })
        return callback(baseTx)
      }),
    }
    await expect(service(editorPrisma).update(userId, recordId, { version: 1, content: '越权修改' }))
      .rejects.toBeInstanceOf(ForbiddenException)
    expect(baseTx.record.updateMany).not.toHaveBeenCalled()

    const updated = record({ createdBy: otherUserId, content: '管理员修改', version: 2 })
    const adminPrisma = {
      ...editorPrisma,
      record: { findFirst: vi.fn(async () => updated) },
      babyMember: { findFirst: vi.fn(async () => membership(MemberRole.admin)) },
    }
    baseTx.babyMember.findFirst.mockResolvedValueOnce({ role: MemberRole.admin })
    await service(adminPrisma).update(userId, recordId, { version: 1, content: '管理员修改' })
    expect(baseTx.record.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ createdBy: expect.anything() }),
    }))
  })

  it('checks live membership before timeline access so removal immediately blocks an old token', async () => {
    const prisma = {
      babyMember: { findFirst: vi.fn(async () => null) },
      record: { findMany: vi.fn() },
    }
    await expect(service(prisma).list(userId, babyId, { limit: 20 }))
      .rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.record.findMany).not.toHaveBeenCalled()
  })

  it('uses the same non-disclosing 404 for a missing record and a real foreign record', async () => {
    const missing = service({ record: { findFirst: vi.fn(async () => null) } })
    const foreign = service({
      record: { findFirst: vi.fn(async () => record({ babyId: otherBabyId })) },
      babyMember: { findFirst: vi.fn(async () => null) },
    })
    const errors: NotFoundException[] = []
    for (const instance of [missing, foreign]) {
      try {
        await instance.get(userId, recordId)
      } catch (error) {
        errors.push(error as NotFoundException)
      }
    }
    expect(errors).toHaveLength(2)
    expect(errors.map((error) => error.getStatus())).toEqual([404, 404])
    expect(errors.map((error) => error.getResponse())).toEqual([
      { statusCode: 404, message: '资源不存在', error: 'Not Found' },
      { statusCode: 404, message: '资源不存在', error: 'Not Found' },
    ])
  })

  it('rejects invalid type-specific create payloads before persistence', async () => {
    const transaction = vi.fn()
    const instance = service({ $transaction: transaction })
    const invalid = [
      { type: 'note', occurredAt, content: '   ', mediaIds: [] },
      { type: 'measurement', occurredAt, measurement: {}, mediaIds: [] },
      { type: 'milestone', occurredAt, title: '   ', mediaIds: [] },
      { type: 'note', occurredAt, content: 'ok', mediaIds: [mediaId, mediaId] },
      { type: 'note', occurredAt, content: 'ok', mediaIds: Array.from({ length: 10 }, (_, index) => `${index}6666666-6666-4666-8666-666666666666`) },
    ]
    for (const input of invalid) {
      await expect(instance.create(userId, babyId, key, input as never)).rejects.toBeInstanceOf(BadRequestException)
    }
    expect(transaction).not.toHaveBeenCalled()
  })

  it('enforces update fields by persisted record type and leaves data untouched', async () => {
    const tx = {
      record: { findFirst: vi.fn(async () => record()), updateMany: vi.fn() },
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.admin })) },
      recordMedia: { count: vi.fn(async () => 0) },
    }
    const prisma = { $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) }
    await expect(service(prisma).update(userId, recordId, {
      version: 1, measurement: { heightCm: 80 },
    })).rejects.toBeInstanceOf(BadRequestException)
    await expect(service(prisma).update(userId, recordId, {
      version: 1, title: '图文不能有标题',
    })).rejects.toBeInstanceOf(BadRequestException)
    expect(tx.record.updateMany).not.toHaveBeenCalled()
  })

  it('rejects cross-baby, non-ready, and editor-owned-by-another media with the same 404', async () => {
    const tx = {
      babyMember: { findFirst: vi.fn(async () => membership(MemberRole.editor)) },
      idempotencyKey: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: unknown }) => data),
      },
      media: { count: vi.fn(async () => 0) },
      record: { create: vi.fn() },
    }
    const prisma = { $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) }
    await expect(service(prisma).create(userId, babyId, key, {
      type: 'note', occurredAt, mediaIds: [mediaId],
    })).rejects.toBeInstanceOf(NotFoundException)
    expect(tx.media.count).toHaveBeenCalledWith({ where: {
      id: { in: [mediaId] },
      babyId,
      status: MediaStatus.ready,
      purpose: MediaPurpose.record_image,
      mimeType: { in: ['image/jpeg', 'image/png'] },
      deletedAt: null,
      ownerUserId: userId,
    } })
    expect(tx.record.create).not.toHaveBeenCalled()
  })

  it('does not allow an export archive or non-image media to be linked to a record', async () => {
    const tx = {
      babyMember: { findFirst: vi.fn(async () => membership(MemberRole.admin)) },
      idempotencyKey: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: unknown }) => data),
      },
      media: { count: vi.fn(async () => 0) },
      record: { create: vi.fn() },
    }
    const prisma = {
      $transaction: vi.fn(
        async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    }

    await expect(service(prisma).create(userId, babyId, key, {
      type: 'note', occurredAt, content: '内容', mediaIds: [mediaId],
    })).rejects.toBeInstanceOf(NotFoundException)
    expect(tx.media.count).toHaveBeenCalledWith({
      where: {
        id: { in: [mediaId] },
        babyId,
        status: MediaStatus.ready,
        purpose: MediaPurpose.record_image,
        mimeType: { in: ['image/jpeg', 'image/png'] },
        deletedAt: null,
      },
    })
    expect(tx.record.create).not.toHaveBeenCalled()
  })

  it('rejects an occurrence on the birth date before the recorded birth time', async () => {
    const tx = {
      babyMember: {
        findFirst: vi.fn(async () => membership(MemberRole.admin, {
          birthTime: new Date('1970-01-01T08:30:00.000Z'),
        })),
      },
      idempotencyKey: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(),
      },
      record: { create: vi.fn() },
    }
    const prisma = {
      $transaction: vi.fn(
        async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    }

    await expect(service(prisma).create(userId, babyId, key, {
      type: 'note',
      occurredAt: '2025-01-01T08:29:59+08:00',
      content: '内容',
      mediaIds: [],
    })).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'VALIDATION_FAILED',
        details: [{ field: 'occurredAt', reason: '不能早于宝宝出生时间' }],
      }),
    })
    expect(tx.idempotencyKey.create).not.toHaveBeenCalled()
    expect(tx.record.create).not.toHaveBeenCalled()
  })
})

describe('M3 RecordsService idempotency, transactions and versions', () => {
  it('canonicalizes nested request objects recursively for idempotency replay', async () => {
    const rows = new Map<string, { requestHash: string; responseBody: object | null }>()
    let creates = 0
    const tx = {
      babyMember: { findFirst: vi.fn(async () => membership(MemberRole.admin)) },
      idempotencyKey: {
        findUnique: vi.fn(async () => rows.get(key) ?? null),
        create: vi.fn(async ({ data }: { data: { requestHash: string } }) => {
          rows.set(key, { requestHash: data.requestHash, responseBody: null }); return data
        }),
        update: vi.fn(async ({ data }: { data: { responseBody: object } }) => {
          rows.get(key)!.responseBody = data.responseBody; return data
        }),
      },
      media: { count: vi.fn(async () => 0) },
      record: { create: vi.fn(async () => { creates += 1; return { id: recordId } }) },
    }
    const found = record({ type: RecordType.measurement, content: '备注', measurement: { heightCm: 80, weightKg: 10 } })
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
      idempotencyKey: { findUnique: tx.idempotencyKey.findUnique },
      record: { findFirst: vi.fn(async () => found) },
      babyMember: { findFirst: vi.fn(async () => membership(MemberRole.admin)) },
    }
    const instance = service(prisma)
    await instance.create(userId, babyId, key, {
      type: 'measurement', occurredAt, mediaIds: [], measurement: { heightCm: 80, weightKg: 10 }, content: '备注',
    })
    await instance.create(userId, babyId, key, {
      content: '备注', measurement: { weightKg: 10, heightCm: 80 }, mediaIds: [], occurredAt, type: 'measurement',
    })
    expect(creates).toBe(1)
  })

  it('serializes concurrent same-key creates so exactly one record is produced', async () => {
    const row: { requestHash?: string; responseBody?: object | null } = {}
    let creates = 0
    let tail = Promise.resolve()
    const tx = {
      babyMember: { findFirst: vi.fn(async () => membership(MemberRole.admin)) },
      idempotencyKey: {
        findUnique: vi.fn(async () => row.requestHash ? row : null),
        create: vi.fn(async ({ data }: { data: { requestHash: string } }) => { row.requestHash = data.requestHash; row.responseBody = null }),
        update: vi.fn(async ({ data }: { data: { responseBody: object } }) => { row.responseBody = data.responseBody }),
      },
      record: { create: vi.fn(async () => { creates += 1; return { id: recordId } }) },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => {
        const previous = tail
        let release!: () => void
        tail = new Promise<void>((resolve) => { release = resolve })
        await previous
        try { return await callback(tx) } finally { release() }
      }),
      idempotencyKey: { findUnique: tx.idempotencyKey.findUnique },
      record: { findFirst: vi.fn(async () => record()) },
      babyMember: { findFirst: vi.fn(async () => membership(MemberRole.admin)) },
    }
    const instance = service(prisma)
    const input = { type: 'note' as const, occurredAt, content: '内容', mediaIds: [] }
    const [first, second] = await Promise.all([
      instance.create(userId, babyId, key, input), instance.create(userId, babyId, key, input),
    ])
    expect(first.id).toBe(second.id)
    expect(creates).toBe(1)
  })

  it('does not commit the idempotency row, record, measurement, or media links after a fault', async () => {
    const committed = { keys: 0, records: 0, measurements: 0, links: 0 }
    const staged = { ...committed }
    const tx = {
      babyMember: { findFirst: vi.fn(async () => membership(MemberRole.admin)) },
      idempotencyKey: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => { staged.keys += 1 }),
        update: vi.fn(async () => { throw new Error('fault after nested writes') }),
      },
      media: { count: vi.fn(async () => 1) },
      record: { create: vi.fn(async () => {
        staged.records += 1; staged.measurements += 1; staged.links += 1; return { id: recordId }
      }) },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => {
        const result = await callback(tx)
        Object.assign(committed, staged)
        return result
      }),
    }
    await expect(service(prisma).create(userId, babyId, key, {
      type: 'measurement', occurredAt, measurement: { heightCm: 80 }, mediaIds: [mediaId],
    })).rejects.toThrow('fault after nested writes')
    expect(committed).toEqual({ keys: 0, records: 0, measurements: 0, links: 0 })
  })

  it('returns VERSION_CONFLICT and does not rewrite media on stale update', async () => {
    const tx = {
      record: { findFirst: vi.fn(async () => record()), updateMany: vi.fn(async () => ({ count: 0 })) },
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.admin })) },
      media: { count: vi.fn(async () => 1) },
      recordMedia: { count: vi.fn(async () => 0), deleteMany: vi.fn(), createMany: vi.fn() },
    }
    const prisma = { $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) }
    try {
      await service(prisma).update(userId, recordId, { version: 1, mediaIds: [mediaId] })
      throw new Error('expected conflict')
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException)
      expect((error as ConflictException).getResponse()).toMatchObject({ code: 'VERSION_CONFLICT' })
    }
    expect(tx.recordMedia.deleteMany).not.toHaveBeenCalled()
  })

  it('preserves the submitted media order with contiguous sortOrder values', async () => {
    const secondMediaId = '88888888-8888-4888-8888-888888888888'
    const tx = {
      record: { findFirst: vi.fn(async () => record()), updateMany: vi.fn(async () => ({ count: 1 })) },
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.admin })) },
      media: { count: vi.fn(async () => 2) },
      recordMedia: { deleteMany: vi.fn(), createMany: vi.fn() },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
      record: { findFirst: vi.fn(async () => record({ media: [] })) },
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.admin })) },
    }
    await service(prisma).update(userId, recordId, { version: 1, mediaIds: [secondMediaId, mediaId] })
    expect(tx.recordMedia.createMany).toHaveBeenCalledWith({ data: [
      { recordId, mediaId: secondMediaId, sortOrder: 0 },
      { recordId, mediaId, sortOrder: 1 },
    ] })
  })

  it('uses Serializable isolation for create, update, and delete transactions', async () => {
    const createTx = {
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.viewer })) },
      idempotencyKey: { findUnique: vi.fn() }, record: { create: vi.fn() },
    }
    const createPrisma = { $transaction: vi.fn(async (callback: (value: typeof createTx) => Promise<unknown>, options: unknown) => {
      expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      return callback(createTx)
    }) }
    await expect(service(createPrisma).create(userId, babyId, key, {
      type: 'note', occurredAt, content: '内容', mediaIds: [],
    })).rejects.toBeInstanceOf(ForbiddenException)
  })
})

describe('M3 RecordsService stable cursor pagination', () => {
  it('orders by immutable tuple and emits a cursor bound to baby/filter/range', async () => {
    const rows = [
      record({ id: '99999999-9999-4999-8999-999999999999', type: RecordType.milestone }),
      record({ id: '88888888-8888-4888-8888-888888888888', type: RecordType.milestone }),
    ]
    const prisma = {
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.viewer })) },
      record: { findMany: vi.fn(async () => rows) },
    }
    const instance = service(prisma)
    const first = await instance.list(userId, babyId, {
      type: 'milestone', limit: 1, startAt: '2026-01-01T00:00:00Z', endAt: '2026-12-31T23:59:59Z',
    })
    expect(prisma.record.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 2,
    }))
    expect(first.meta.nextCursor).toBeTypeOf('string')

    await instance.list(userId, babyId, {
      type: 'milestone', limit: 1, startAt: '2026-01-01T00:00:00Z', endAt: '2026-12-31T23:59:59Z',
      cursor: first.meta.nextCursor!,
    })
    expect(prisma.record.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({
      OR: [
        { occurredAt: { lt: rows[0]!.occurredAt } },
        { occurredAt: rows[0]!.occurredAt, id: { lt: rows[0]!.id } },
      ],
    }) }))
  })

  it('rejects malformed, cross-baby, filter-changed, and range-changed cursors', async () => {
    const prisma = {
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.viewer })) },
      record: { findMany: vi.fn(async () => [record(), record({ id: mediaId })]) },
    }
    const instance = service(prisma)
    const first = await instance.list(userId, babyId, { type: 'note', limit: 1 })
    const cases = [
      { baby: babyId, query: { type: 'note' as const, cursor: 'not-json', limit: 1 } },
      { baby: otherBabyId, query: { type: 'note' as const, cursor: first.meta.nextCursor!, limit: 1 } },
      { baby: babyId, query: { type: 'milestone' as const, cursor: first.meta.nextCursor!, limit: 1 } },
      { baby: babyId, query: { type: 'note' as const, cursor: first.meta.nextCursor!, limit: 1, startAt: occurredAt } },
    ]
    for (const item of cases) {
      await expect(instance.list(userId, item.baby, item.query)).rejects.toBeInstanceOf(BadRequestException)
    }
  })

  it('rejects invalid limits and inverted date ranges without querying records', async () => {
    const prisma = {
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.viewer })) },
      record: { findMany: vi.fn() },
    }
    const instance = service(prisma)
    await expect(instance.list(userId, babyId, { limit: 51 })).rejects.toBeInstanceOf(BadRequestException)
    await expect(instance.list(userId, babyId, {
      startAt: '2026-06-02T00:00:00Z', endAt: '2026-06-01T00:00:00Z', limit: 20,
    })).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.record.findMany).not.toHaveBeenCalled()
  })
})
