import { ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common'
import { ExportStatus, MediaPurpose, MediaStatus, MemberRole, MemberStatus } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

import type { PrismaService } from '../src/database/prisma.service'
import { ExportsService } from '../src/exports/exports.service'
import type { S3StorageService } from '../src/media/s3-storage.service'

const userId = '11111111-1111-4111-8111-111111111111'
const babyId = '22222222-2222-4222-8222-222222222222'
const exportId = '33333333-3333-4333-8333-333333333333'
const mediaId = '44444444-4444-4444-8444-444444444444'
const key = '55555555-5555-4555-8555-555555555555'
const now = new Date('2026-07-17T00:00:00.000Z')

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: exportId, babyId, requestedBy: userId, status: ExportStatus.pending,
    scope: { version: 1, format: 'zip', includeMedia: false, representations: ['json', 'csv'] },
    resultMediaId: null, errorCode: null, attemptCount: 0, nextAttemptAt: now,
    workerLeaseId: null, leaseExpiresAt: null, startedAt: null, completedAt: null,
    expiresAt: null, createdAt: now, updatedAt: now,
    ...overrides,
  }
}

function service(prisma: object, storage: object = {}) {
  return new ExportsService(prisma as PrismaService, storage as S3StorageService)
}

describe('M6 ExportsService creation, ACL, and idempotency', () => {
  it('creates one pending job with a versioned fixed scope and low-sensitivity audit atomically', async () => {
    let createData: Record<string, unknown> = {}
    let auditData: Record<string, unknown> = {}
    const tx = {
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.admin })) },
      idempotencyKey: { findUnique: vi.fn(async () => null), create: vi.fn(), update: vi.fn() },
      exportJob: {
        count: vi.fn(async () => 0),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { createData = data; return job() }),
      },
      auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { auditData = data }) },
    }
    const prisma = { $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) }
    const created = await service(prisma).create(userId, babyId, key, { includeMedia: false, format: 'zip' }, 'request-1')
    expect(created).toMatchObject({ id: exportId, status: 'pending', includeMedia: false, downloadUrl: null })
    expect(createData).toMatchObject({ babyId, requestedBy: userId, scope: {
      version: 1, format: 'zip', includeMedia: false, representations: ['json', 'csv'],
    } })
    expect(auditData).toMatchObject({
      action: 'export.created', resourceId: exportId, requestId: 'request-1',
      metadata: { format: 'zip', includeMedia: false },
    })
    expect(JSON.stringify(auditData)).not.toContain('小宝')
  })

  it('replays a same-key job before rate limiting and rejects changed request bodies', async () => {
    let storedHash = ''
    const initial = {
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.admin })) },
      idempotencyKey: { findUnique: vi.fn(async () => null), create: vi.fn(), update: vi.fn() },
      exportJob: { count: vi.fn(async () => 0), create: vi.fn(async () => job()) },
      auditLog: { create: vi.fn() },
    }
    initial.idempotencyKey.create = vi.fn(async ({ data }: { data: { requestHash: string } }) => { storedHash = data.requestHash })
    const replay = {
      babyMember: initial.babyMember,
      idempotencyKey: { findUnique: vi.fn(async () => ({ requestHash: storedHash, responseBody: { exportId } })) },
      exportJob: { findUnique: vi.fn(async () => job()), count: vi.fn() },
    }
    let round = 0
    const prisma = { $transaction: vi.fn(async (callback: (value: never) => Promise<unknown>) => {
      round += 1
      return callback((round === 1 ? initial : replay) as never)
    }) }
    const exports = service(prisma)
    await exports.create(userId, babyId, key, { includeMedia: false, format: 'zip' })
    await expect(exports.create(userId, babyId, key, { includeMedia: false, format: 'zip' })).resolves.toMatchObject({ id: exportId })
    expect(replay.exportJob.count).not.toHaveBeenCalled()
    await expect(exports.create(userId, babyId, key, { includeMedia: true, format: 'zip' }))
      .rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } })
  })

  it('uses live membership: outsider gets a non-disclosing 404 and known editor gets 403', async () => {
    const outsider = { babyMember: { findFirst: vi.fn(async () => null) } }
    await expect(service(outsider).list(userId, babyId, {})).rejects.toBeInstanceOf(NotFoundException)

    const editor = { babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.editor })) } }
    await expect(service(editor).list(userId, babyId, {})).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('always scopes list queries to the authorized baby and uses a stable descending cursor', async () => {
    const findMany = vi.fn(async () => [job(), job({
      id: '66666666-6666-4666-8666-666666666666', createdAt: new Date(now.getTime() - 1),
    })])
    const prisma = {
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.admin })) },
      exportJob: { findMany },
    }
    const result = await service(prisma).list(userId, babyId, { limit: 1 })
    expect(result.data).toHaveLength(1)
    expect(result.meta.nextCursor).toEqual(expect.any(String))
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { babyId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 2,
    }))
  })

  it('returns an effective expired status from list and detail without exposing a URL', async () => {
    const completedButExpired = job({
      status: ExportStatus.completed,
      completedAt: new Date('2026-07-01T00:00:00.000Z'),
      expiresAt: new Date('2026-07-08T00:00:00.000Z'),
      resultMediaId: mediaId,
    })
    const prisma = {
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.admin })) },
      exportJob: {
        findMany: vi.fn(async () => [completedButExpired]),
        findUnique: vi.fn(async () => completedButExpired),
      },
    }
    await expect(service(prisma).list(userId, babyId, {})).resolves.toMatchObject({
      data: [{ id: exportId, status: ExportStatus.expired, downloadUrl: null }],
    })
    await expect(service(prisma).get(userId, exportId)).resolves.toMatchObject({
      id: exportId,
      status: ExportStatus.expired,
      downloadUrl: null,
    })
  })

  it('rate limits a second active export without creating another idempotency row', async () => {
    const tx = {
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.admin })) },
      idempotencyKey: { findUnique: vi.fn(async () => null), create: vi.fn() },
      exportJob: { count: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0) },
    }
    const prisma = { $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) }
    const error = await service(prisma).create(
      userId,
      babyId,
      key,
      { includeMedia: false, format: 'zip' },
    ).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(HttpException)
    expect((error as HttpException).getStatus()).toBe(429)
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'RATE_LIMITED' })
    expect(tx.idempotencyKey.create).not.toHaveBeenCalled()
  })
})

describe('M6 export download authorization and audit', () => {
  it('only returns a short URL from the dedicated endpoint after writing its audit row', async () => {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const exportJob = job({
      status: ExportStatus.completed, completedAt: now, expiresAt, resultMediaId: mediaId,
      resultMedia: {
        id: mediaId, purpose: MediaPurpose.export_archive, status: MediaStatus.ready,
        deletedAt: null, objectKey: 'exports/private-random.zip',
      },
    })
    const auditCreate = vi.fn()
    const storage = {
      head: vi.fn(async () => ({ contentLength: 100, contentType: 'application/zip' })),
      createExportDownloadUrl: vi.fn(async () => 'https://storage.invalid/private?signed=secret'),
    }
    const prisma = {
      exportJob: { findUnique: vi.fn(async () => exportJob), updateMany: vi.fn() },
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.admin, status: MemberStatus.active })) },
      auditLog: { create: auditCreate },
    }
    const result = await service(prisma, storage).createDownloadUrl(userId, exportId, 'request-2')
    expect(result.downloadUrl).toContain('signed=secret')
    expect(storage.createExportDownloadUrl).toHaveBeenCalledWith('exports/private-random.zip', exportId, expect.any(Number))
    expect(auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'export.download_url.issued', resourceId: exportId, requestId: 'request-2',
      metadata: expect.objectContaining({ format: 'zip', includeMedia: false }),
    }) })
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain('signed=secret')
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain('private-random')
  })

  it('immediately denies a removed or downgraded administrator even with an old token', async () => {
    const prisma = {
      exportJob: { findUnique: vi.fn(async () => job({ status: ExportStatus.completed })) },
      babyMember: { findFirst: vi.fn(async () => null) },
    }
    await expect(service(prisma).get(userId, exportId)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('marks an elapsed completed job expired before refusing to issue a signed URL', async () => {
    const exportJob = job({
      status: ExportStatus.completed,
      completedAt: now,
      expiresAt: new Date('2026-07-17T00:00:01.000Z'),
      resultMediaId: mediaId,
      resultMedia: {
        id: mediaId,
        purpose: MediaPurpose.export_archive,
        status: MediaStatus.ready,
        deletedAt: null,
        objectKey: 'exports/private-random.zip',
      },
    })
    const prisma = {
      exportJob: {
        findUnique: vi.fn(async () => exportJob),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.admin })) },
      auditLog: { create: vi.fn() },
    }
    const storage = { head: vi.fn(), createExportDownloadUrl: vi.fn() }
    const error = await service(prisma, storage).createDownloadUrl(userId, exportId)
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ConflictException)
    expect((error as ConflictException).getResponse()).toMatchObject({ code: 'EXPORT_EXPIRED' })
    expect(prisma.exportJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: ExportStatus.expired },
    }))
    expect(storage.createExportDownloadUrl).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it('does not disclose export existence when an outsider requests its download URL', async () => {
    const prisma = {
      exportJob: { findUnique: vi.fn(async () => job()) },
      babyMember: { findFirst: vi.fn(async () => null) },
    }
    await expect(service(prisma).createDownloadUrl(userId, exportId))
      .rejects.toBeInstanceOf(NotFoundException)
  })
})
