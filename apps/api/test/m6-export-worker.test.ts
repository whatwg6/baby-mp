import { ExportStatus, MediaPurpose, MediaStatus } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

import type { PrismaService } from '../src/database/prisma.service'
import { runContinuousExportWorker } from '../src/exports/export-worker-loop'
import { ExportWorker } from '../src/exports/exports.worker'
import type { S3StorageService } from '../src/media/s3-storage.service'

const babyId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const exportId = '33333333-3333-4333-8333-333333333333'
const leaseId = '44444444-4444-4444-8444-444444444444'
const now = new Date('2026-07-17T00:00:00.000Z')

function job(attemptCount = 1) {
  return {
    id: exportId, babyId, requestedBy: userId, status: ExportStatus.processing,
    scope: { version: 1, format: 'zip', includeMedia: false, representations: ['json', 'csv'] },
    resultMediaId: null, errorCode: null, attemptCount, nextAttemptAt: now,
    workerLeaseId: leaseId, leaseExpiresAt: new Date(now.getTime() + 60_000),
    startedAt: now, completedAt: null, expiresAt: null, createdAt: now, updatedAt: now,
  }
}

function worker(prisma: object, storage: object = {}) {
  return new ExportWorker(prisma as PrismaService, storage as S3StorageService)
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function heartbeatProcessingFixture(
  renew: (call: number) => Promise<{ count: number }>,
) {
  const artifactId = '77777777-7777-4777-8777-777777777777'
  const artifact = {
    id: artifactId,
    objectKey: 'exports/heartbeat-artifact.zip',
    mimeType: 'application/zip',
    purpose: MediaPurpose.export_archive,
    status: MediaStatus.pending,
    deletedAt: null,
  }
  const transactionExportUpdate = vi.fn(async () => ({ count: 1 }))
  const transactionMediaUpdate = vi.fn(async () => ({ count: 1 }))
  const tx = {
    baby: { findFirst: vi.fn(async () => ({
      id: babyId,
      name: '测试宝宝',
      gender: 'unspecified',
      birthDate: new Date('2025-01-01T00:00:00.000Z'),
      birthTime: null,
      birthHeightCm: null,
      birthWeightKg: null,
      avatarMediaId: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      avatarMedia: null,
    })) },
    record: { findMany: vi.fn(async () => []) },
    media: { create: vi.fn(async () => artifact), updateMany: transactionMediaUpdate },
    exportJob: { updateMany: transactionExportUpdate },
  }
  let renewalCalls = 0
  const workerExportUpdate = vi.fn(async (args: { data: Record<string, unknown> }) => {
    if (!('status' in args.data) && 'leaseExpiresAt' in args.data) {
      renewalCalls += 1
      return renew(renewalCalls)
    }
    return { count: 1 }
  })
  const prisma = {
    $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    media: { updateMany: vi.fn(async () => ({ count: 1 })) },
    exportJob: { updateMany: workerExportUpdate },
  }
  const uploadStarted = deferred()
  const uploadReleased = deferred()
  let archive = Buffer.alloc(0)
  const storage = {
    bucket: 'private',
    uploadMultipart: vi.fn(async (
      _objectKey: string,
      _mimeType: string,
      body: AsyncIterable<Uint8Array>,
    ) => {
      uploadStarted.resolve()
      await uploadReleased.promise
      const chunks: Uint8Array[] = []
      for await (const chunk of body) chunks.push(chunk)
      archive = Buffer.concat(chunks)
      return { sizeBytes: archive.byteLength, sha256: '2'.repeat(64) }
    }),
    head: vi.fn(async () => ({ contentLength: archive.byteLength, contentType: 'application/zip' })),
    readStream: vi.fn(),
    delete: vi.fn(async () => undefined),
  }
  return {
    artifactId,
    prisma,
    storage,
    transactionExportUpdate,
    workerExportUpdate,
    uploadStarted,
    uploadReleased,
    renewalCalls: () => renewalCalls,
  }
}

describe('M6 export worker leases and retry state machine', () => {
  it('recovers expired leases before scanning due pending work', async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }))
    const prisma = {
      exportJob: { updateMany, findFirst: vi.fn(async () => null) },
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    }
    await expect(worker(prisma).processOnce(now)).resolves.toBe(false)
    expect(updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ status: ExportStatus.processing, attemptCount: { lt: 3 } }),
      data: expect.objectContaining({ status: ExportStatus.pending, workerLeaseId: null, leaseExpiresAt: null }),
    }))
    expect(updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ status: ExportStatus.processing, attemptCount: { gte: 3 } }),
      data: expect.objectContaining({ status: ExportStatus.failed, errorCode: 'EXPORT_PROCESSING_FAILED' }),
    }))
  })

  it('returns transient failures to pending but permanently fails the third attempt', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const subject = worker({ exportJob: { updateMany } }) as unknown as {
      failOrRetry(value: ReturnType<typeof job>, error: unknown): Promise<void>
    }
    await subject.failOrRetry(job(1), new Error('temporary S3 failure with secret details'))
    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: exportId, status: ExportStatus.processing, workerLeaseId: leaseId },
      data: expect.objectContaining({ status: ExportStatus.pending, errorCode: null, workerLeaseId: null }),
    }))
    await subject.failOrRetry(job(3), new Error('still unavailable'))
    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: ExportStatus.failed, errorCode: 'EXPORT_PROCESSING_FAILED' }),
    }))
  })

  it('claims a due job with one compare-and-swap lease update', async () => {
    const candidate = {
      ...job(0),
      status: ExportStatus.pending,
      workerLeaseId: null,
      leaseExpiresAt: null,
      startedAt: null,
    }
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const prisma = {
      exportJob: {
        findFirst: vi.fn(async () => candidate),
        updateMany,
        findUniqueOrThrow: vi.fn(async () => ({ ...candidate, status: ExportStatus.processing, attemptCount: 1 })),
      },
    }
    const subject = worker(prisma) as unknown as {
      claim(value: Date): Promise<ReturnType<typeof job> | null>
    }
    const claimed = await subject.claim(now)
    expect(claimed).toMatchObject({
      id: exportId,
      status: ExportStatus.processing,
      attemptCount: 1,
      workerLeaseId: expect.any(String),
    })
    expect(prisma.exportJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: ExportStatus.pending,
        resultMediaId: null,
        attemptCount: { lt: 3 },
      }),
    }))
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: exportId,
        status: ExportStatus.pending,
        attemptCount: 0,
      }),
      data: expect.objectContaining({
        status: ExportStatus.processing,
        attemptCount: { increment: 1 },
      }),
    }))
  })

  it('heartbeats the full includeMedia=false lifecycle without overlapping renewals and stops after completion', async () => {
    vi.useFakeTimers()
    const periodicRenewal = deferred()
    let blockPeriodicRenewal = false
    let activeRenewals = 0
    let maximumActiveRenewals = 0
    const fixture = heartbeatProcessingFixture(async () => {
      activeRenewals += 1
      maximumActiveRenewals = Math.max(maximumActiveRenewals, activeRenewals)
      if (blockPeriodicRenewal) await periodicRenewal.promise
      activeRenewals -= 1
      return { count: 1 }
    })
    const subject = worker(fixture.prisma, fixture.storage) as unknown as {
      process(value: ReturnType<typeof job>, valueNow: Date): Promise<void>
    }
    try {
      const processing = subject.process(job(1), now)
      await fixture.uploadStarted.promise

      // Initial and phase-boundary renewals cover snapshot, JSON/CSV build,
      // artifact creation, and entry into multipart upload even without photos.
      expect(fixture.renewalCalls()).toBeGreaterThanOrEqual(4)
      const renewalsBeforePeriodicTick = fixture.renewalCalls()
      blockPeriodicRenewal = true
      await vi.advanceTimersByTimeAsync(3 * 60_000)
      expect(fixture.renewalCalls()).toBe(renewalsBeforePeriodicTick + 1)
      expect(maximumActiveRenewals).toBe(1)

      blockPeriodicRenewal = false
      periodicRenewal.resolve()
      await Promise.resolve()
      fixture.uploadReleased.resolve()
      await processing

      expect(fixture.storage.readStream).not.toHaveBeenCalled()
      expect(fixture.transactionExportUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: ExportStatus.completed }),
      }))
      const renewalsAfterCompletion = fixture.renewalCalls()
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      expect(fixture.renewalCalls()).toBe(renewalsAfterCompletion)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not complete an artifact when a lifecycle heartbeat loses the lease', async () => {
    vi.useFakeTimers()
    let failNextRenewal = false
    const fixture = heartbeatProcessingFixture(async () => ({ count: failNextRenewal ? 0 : 1 }))
    const subject = worker(fixture.prisma, fixture.storage) as unknown as {
      process(value: ReturnType<typeof job>, valueNow: Date): Promise<void>
    }
    try {
      const processing = subject.process(job(1), now)
      await fixture.uploadStarted.promise
      failNextRenewal = true
      await vi.advanceTimersByTimeAsync(60_000)
      fixture.uploadReleased.resolve()
      await processing

      expect(fixture.transactionExportUpdate).not.toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: ExportStatus.completed }),
      }))
      expect(fixture.storage.delete).toHaveBeenCalledWith('exports/heartbeat-artifact.zip')
      expect(fixture.workerExportUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: exportId, status: ExportStatus.processing, workerLeaseId: leaseId },
        data: expect.objectContaining({ status: ExportStatus.pending }),
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('polls continuously, performs periodic cleanup, and exits when aborted while idle', async () => {
    const abort = new AbortController()
    const operations = {
      processOnce: vi.fn(async () => false),
      cleanupExpired: vi.fn(async () => 0),
    }
    const sleep = vi.fn(async (_milliseconds: number, signal: AbortSignal) => {
      expect(signal).toBe(abort.signal)
      abort.abort()
    })
    await runContinuousExportWorker(operations as unknown as ExportWorker, {
      signal: abort.signal,
      clock: () => now.getTime(),
      sleep,
    })
    expect(operations.processOnce).toHaveBeenCalledTimes(1)
    expect(operations.cleanupExpired).toHaveBeenCalledWith(now)
    expect(sleep).toHaveBeenCalledWith(2_000, abort.signal)
  })
})

describe('M6 export worker source isolation and cleanup', () => {
  it('materializes only the target baby and its non-deleted records in a repeatable-read snapshot', async () => {
    const recordFindMany = vi.fn(async () => [])
    const tx = {
      baby: { findFirst: vi.fn(async () => ({
        id: babyId, name: '小宝', gender: 'unspecified', birthDate: new Date('2025-01-01T00:00:00Z'),
        birthTime: null, birthHeightCm: null, birthWeightKg: null, avatarMediaId: null,
        createdAt: now, updatedAt: now, deletedAt: null, avatarMedia: null,
      })) },
      record: { findMany: recordFindMany },
    }
    const prisma = { $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) }
    const subject = worker(prisma) as unknown as { snapshot(value: string): Promise<unknown> }
    await subject.snapshot(babyId)
    expect(tx.baby.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: babyId, deletedAt: null } }))
    expect(recordFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { babyId, deletedAt: null },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    }))
  })

  it('expires before physical deletion and retries unpurged export-only artifacts', async () => {
    const mediaId = '55555555-5555-4555-8555-555555555555'
    const media = {
      id: mediaId, purpose: MediaPurpose.export_archive, status: MediaStatus.ready,
      objectKey: 'exports/random.zip', deletedAt: null, purgedAt: null,
    }
    const exportJob = {
      id: exportId, status: ExportStatus.completed, expiresAt: now,
      resultMediaId: mediaId, resultMedia: media,
    }
    const tx = {
      exportJob: { updateMany: vi.fn(async () => ({ count: 1 })) },
      media: { updateMany: vi.fn(async () => ({ count: 1 })) },
    }
    const prisma = {
      exportJob: { findMany: vi.fn(async () => [exportJob]) },
      media: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })) },
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    }
    const storage = {
      delete: vi.fn(async () => undefined),
      abortStaleMultipartUploads: vi.fn(async () => 0),
    }
    await expect(worker(prisma, storage).cleanupExpired(now)).resolves.toBe(1)
    expect(tx.exportJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: ExportStatus.expired },
    }))
    expect(storage.delete).toHaveBeenCalledWith('exports/random.zip')
  })

  it('retries cleanup when object deletion fails without falsely marking it purged', async () => {
    const mediaId = '55555555-5555-4555-8555-555555555555'
    const media = {
      id: mediaId,
      purpose: MediaPurpose.export_archive,
      status: MediaStatus.deleted,
      objectKey: 'exports/retry.zip',
      deletedAt: now,
      purgedAt: null,
    }
    const exportJob = {
      id: exportId,
      status: ExportStatus.expired,
      expiresAt: now,
      resultMediaId: mediaId,
      resultMedia: media,
    }
    const tx = {
      exportJob: { updateMany: vi.fn(async () => ({ count: 0 })) },
      media: { updateMany: vi.fn(async () => ({ count: 1 })) },
    }
    const prisma = {
      exportJob: { findMany: vi.fn(async () => [exportJob]) },
      media: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })) },
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    }
    const storage = {
      delete: vi.fn()
        .mockRejectedValueOnce(new Error('temporary object store failure'))
        .mockResolvedValueOnce(undefined),
      abortStaleMultipartUploads: vi.fn(async () => 0),
    }
    await expect(worker(prisma, storage).cleanupExpired(now)).resolves.toBe(0)
    expect(prisma.media.updateMany).not.toHaveBeenCalled()
    await expect(worker(prisma, storage).cleanupExpired(now)).resolves.toBe(1)
    expect(storage.delete).toHaveBeenCalledTimes(2)
    expect(prisma.media.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: mediaId, purgedAt: null }),
      data: expect.objectContaining({ purgedAt: expect.any(Date) }),
    }))
  })

  it('streams a complete archive without reading photo bytes when includeMedia is false', async () => {
    const sourceMediaId = '66666666-6666-4666-8666-666666666666'
    const artifactId = '77777777-7777-4777-8777-777777777777'
    const sourceMedia = {
      id: sourceMediaId,
      ownerUserId: userId,
      babyId,
      storageProvider: 's3',
      bucket: 'private',
      objectKey: 'media/private-source.jpg',
      uploadObjectKey: null,
      mimeType: 'image/jpeg',
      sizeBytes: BigInt(3),
      width: 10,
      height: 20,
      sha256: '1'.repeat(64),
      status: MediaStatus.ready,
      purpose: MediaPurpose.record_image,
      createdAt: now,
      readyAt: now,
      deletedAt: null,
      purgedAt: null,
    }
    const artifact = {
      ...sourceMedia,
      id: artifactId,
      objectKey: 'exports/private-artifact.zip',
      mimeType: 'application/zip',
      sizeBytes: BigInt(0),
      sha256: null,
      status: MediaStatus.pending,
      purpose: MediaPurpose.export_archive,
      width: null,
      height: null,
      readyAt: null,
    }
    const exportUpdate = vi.fn(async () => ({ count: 1 }))
    const mediaUpdate = vi.fn(async () => ({ count: 1 }))
    const tx = {
      baby: { findFirst: vi.fn(async () => ({
        id: babyId,
        name: '测试宝宝',
        gender: 'unspecified',
        birthDate: new Date('2025-01-01T00:00:00.000Z'),
        birthTime: null,
        birthHeightCm: null,
        birthWeightKg: null,
        avatarMediaId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        avatarMedia: null,
      })) },
      record: { findMany: vi.fn(async () => [{
        id: '88888888-8888-4888-8888-888888888888',
        babyId,
        type: 'note',
        title: null,
        content: '正文',
        occurredAt: now,
        createdBy: userId,
        updatedBy: userId,
        deletedBy: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        creator: { id: userId, displayName: '记录者' },
        measurement: null,
        media: [{ sortOrder: 0, media: sourceMedia }],
      }]) },
      media: { create: vi.fn(async () => artifact), updateMany: mediaUpdate },
      exportJob: { updateMany: exportUpdate },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
      media: { updateMany: vi.fn(async () => ({ count: 1 })) },
      exportJob: { updateMany: vi.fn(async () => ({ count: 1 })) },
    }
    let archive = Buffer.alloc(0)
    const storage = {
      bucket: 'private',
      uploadMultipart: vi.fn(async (
        _objectKey: string,
        _mimeType: string,
        body: AsyncIterable<Uint8Array>,
      ) => {
        const chunks: Uint8Array[] = []
        for await (const chunk of body) chunks.push(chunk)
        archive = Buffer.concat(chunks)
        return { sizeBytes: archive.byteLength, sha256: '2'.repeat(64) }
      }),
      head: vi.fn(async () => ({
        contentLength: archive.byteLength,
        contentType: 'application/zip',
      })),
      readStream: vi.fn(),
      delete: vi.fn(async () => undefined),
    }
    const subject = worker(prisma, storage) as unknown as {
      process(value: ReturnType<typeof job>, valueNow: Date): Promise<void>
    }
    await subject.process(job(1), now)
    expect(storage.readStream).not.toHaveBeenCalled()
    expect(archive.includes(Buffer.from('manifest.json'))).toBe(true)
    expect(archive.includes(Buffer.from(sourceMediaId))).toBe(true)
    expect(archive.includes(Buffer.from('"false",""'))).toBe(true)
    expect(exportUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: { resultMediaId: artifactId },
    }))
    expect(exportUpdate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ resultMediaId: artifactId }),
      data: expect.objectContaining({
        status: ExportStatus.completed,
        resultMediaId: artifactId,
      }),
    }))
    expect(mediaUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: MediaStatus.ready,
        sizeBytes: archive.byteLength,
      }),
    }))
  })
})
