import { randomUUID } from 'node:crypto'

import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  ExportStatus,
  MediaPurpose,
  MediaStatus,
  Prisma,
  type ExportJob,
  type Media,
} from '@prisma/client'

import { PrismaService } from '../database/prisma.service'
import { S3StorageService } from '../media/s3-storage.service'
import {
  buildExportFiles,
  extensionFor,
  type ExportSnapshot,
} from './export-format'
import {
  bytesSource,
  createZipStream,
  ExportArchiveTooLargeError,
  type ZipEntry,
} from './zip-stream'

const MAX_ATTEMPTS = 3
const LEASE_MILLISECONDS = 30 * 60 * 1000
const LEASE_HEARTBEAT_MILLISECONDS = 60 * 1000
const RETRY_DELAYS = [60_000, 5 * 60_000, 15 * 60_000] as const
const PACKAGE_RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1000
const MAX_RECORDS = 10_000
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024

class PermanentExportError extends Error {
  constructor(readonly code: 'EXPORT_TOO_LARGE' | 'SOURCE_MEDIA_UNAVAILABLE' | 'EXPORT_SOURCE_INVALID') {
    super(code)
  }
}

interface ClaimedJob extends ExportJob {
  workerLeaseId: string
}

class ExportLeaseHeartbeat {
  private timer: ReturnType<typeof setTimeout> | undefined
  private renewal: Promise<void> | undefined
  private failure: unknown
  private stopped = false

  constructor(private readonly renew: () => Promise<void>) {}

  async start(): Promise<void> {
    await this.renewNow()
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    this.assertHealthy()
    const result = await operation()
    this.assertHealthy()
    return result
  }

  async renewNow(): Promise<void> {
    this.assertHealthy()
    if (this.stopped) throw new Error('Export worker heartbeat was stopped')
    this.clearTimer()
    if (!this.renewal) {
      this.renewal = this.renew()
        .catch((error: unknown) => {
          this.failure = error
        })
        .finally(() => {
          this.renewal = undefined
        })
    }
    await this.renewal
    this.assertHealthy()
    this.schedule()
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.clearTimer()
    await this.renewal
    this.assertHealthy()
  }

  private schedule(): void {
    if (this.stopped || this.failure || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.renewNow().catch(() => undefined)
    }, LEASE_HEARTBEAT_MILLISECONDS)
    this.timer.unref?.()
  }

  private clearTimer(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private assertHealthy(): void {
    if (this.failure) throw this.failure
  }
}

@Injectable()
export class ExportWorker {
  private readonly logger = new Logger(ExportWorker.name)

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3StorageService) private readonly storage: S3StorageService,
  ) {}

  async registerHeartbeat(instanceId: string, at = new Date()): Promise<void> {
    await this.prisma.workerHeartbeat.create({
      data: {
        instanceId,
        workerName: 'export-worker',
        startedAt: at,
      },
    })
  }

  async recordHeartbeatSuccess(instanceId: string, at = new Date()): Promise<void> {
    await this.prisma.workerHeartbeat.updateMany({
      where: { instanceId, workerName: 'export-worker', stoppedAt: null },
      data: { lastSuccessAt: at },
    })
  }

  async recordHeartbeatFailure(instanceId: string, at = new Date()): Promise<void> {
    await this.prisma.workerHeartbeat.updateMany({
      where: { instanceId, workerName: 'export-worker', stoppedAt: null },
      data: { lastFailureAt: at },
    })
  }

  async stopHeartbeat(instanceId: string, at = new Date()): Promise<void> {
    await this.prisma.workerHeartbeat.updateMany({
      where: { instanceId, workerName: 'export-worker', stoppedAt: null },
      data: { stoppedAt: at },
    })
  }

  async processOnce(now = new Date()): Promise<boolean> {
    await this.recoverExpiredLeases(now)
    const job = await this.claim(now)
    if (!job) return false
    await this.process(job, now)
    return true
  }

  async cleanupExpired(now = new Date()): Promise<number> {
    const candidates = await this.prisma.exportJob.findMany({
      where: {
        resultMediaId: { not: null },
        resultMedia: {
          purpose: MediaPurpose.export_archive,
          purgedAt: null,
        },
        OR: [
          { status: ExportStatus.completed, expiresAt: { lte: now } },
          { status: ExportStatus.expired, resultMedia: { purgedAt: null } },
        ],
      },
      include: { resultMedia: true },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: 100,
    })
    let cleaned = 0
    for (const candidate of candidates) {
      const media = candidate.resultMedia
      if (!media) continue
      try {
        const claimed = await this.prisma.$transaction(async (tx) => {
          if (candidate.status === ExportStatus.completed) {
            const result = await tx.exportJob.updateMany({
              where: { id: candidate.id, status: ExportStatus.completed, expiresAt: { lte: now } },
              data: { status: ExportStatus.expired },
            })
            if (result.count !== 1) return false
          }
          const marked = await tx.media.updateMany({
            where: { id: media.id, purpose: MediaPurpose.export_archive, purgedAt: null },
            data: { status: MediaStatus.deleted, deletedAt: media.deletedAt ?? now },
          })
          return marked.count === 1
        })
        if (!claimed) continue
        await this.storage.delete(media.objectKey)
        await this.prisma.media.updateMany({
          where: { id: media.id, purpose: MediaPurpose.export_archive, purgedAt: null },
          data: { purgedAt: new Date() },
        })
        cleaned += 1
      } catch {
        this.logger.warn(JSON.stringify({ message: 'export_cleanup_retry', exportId: candidate.id }))
      }
    }
    const orphans = await this.prisma.media.findMany({
      where: {
        purpose: MediaPurpose.export_archive,
        purgedAt: null,
        exportResults: { none: {} },
        OR: [
          { status: MediaStatus.deleted },
          { status: MediaStatus.pending, createdAt: { lt: new Date(now.getTime() - LEASE_MILLISECONDS) } },
        ],
      },
      take: 100,
    })
    for (const media of orphans) {
      try {
        await this.storage.delete(media.objectKey)
        await this.prisma.media.updateMany({
          where: { id: media.id, purpose: MediaPurpose.export_archive, purgedAt: null, exportResults: { none: {} } },
          data: { status: MediaStatus.deleted, deletedAt: media.deletedAt ?? now, purgedAt: new Date() },
        })
        cleaned += 1
      } catch {
        this.logger.warn(JSON.stringify({ message: 'export_orphan_cleanup_retry', mediaId: media.id }))
      }
    }
    try {
      cleaned += await this.storage.abortStaleMultipartUploads(
        'exports/',
        new Date(now.getTime() - LEASE_MILLISECONDS),
      )
    } catch {
      this.logger.warn(JSON.stringify({ message: 'export_multipart_cleanup_retry' }))
    }
    return cleaned
  }

  private async recoverExpiredLeases(now: Date): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.exportJob.updateMany({
        where: {
          status: ExportStatus.processing,
          leaseExpiresAt: { lte: now },
          attemptCount: { lt: MAX_ATTEMPTS },
        },
        data: {
          status: ExportStatus.pending,
          resultMediaId: null,
          workerLeaseId: null,
          leaseExpiresAt: null,
          nextAttemptAt: now,
          errorCode: null,
        },
      }),
      this.prisma.exportJob.updateMany({
        where: {
          status: ExportStatus.processing,
          leaseExpiresAt: { lte: now },
          attemptCount: { gte: MAX_ATTEMPTS },
        },
        data: {
          status: ExportStatus.failed,
          resultMediaId: null,
          workerLeaseId: null,
          leaseExpiresAt: null,
          errorCode: 'EXPORT_PROCESSING_FAILED',
        },
      }),
    ])
  }

  private async claim(now: Date): Promise<ClaimedJob | null> {
    for (let scan = 0; scan < 5; scan += 1) {
      const candidate = await this.prisma.exportJob.findFirst({
        where: {
          status: ExportStatus.pending,
          resultMediaId: null,
          nextAttemptAt: { lte: now },
          attemptCount: { lt: MAX_ATTEMPTS },
        },
        orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      })
      if (!candidate) return null
      const leaseId = randomUUID()
      const claimed = await this.prisma.exportJob.updateMany({
        where: {
          id: candidate.id,
          status: ExportStatus.pending,
          resultMediaId: null,
          nextAttemptAt: { lte: now },
          attemptCount: candidate.attemptCount,
        },
        data: {
          status: ExportStatus.processing,
          workerLeaseId: leaseId,
          leaseExpiresAt: new Date(now.getTime() + LEASE_MILLISECONDS),
          startedAt: candidate.startedAt ?? now,
          attemptCount: { increment: 1 },
          errorCode: null,
        },
      })
      if (claimed.count !== 1) continue
      const job = await this.prisma.exportJob.findUniqueOrThrow({ where: { id: candidate.id } })
      return { ...job, workerLeaseId: leaseId }
    }
    return null
  }

  private async process(job: ClaimedJob, generatedAt: Date): Promise<void> {
    let artifact: Media | undefined
    const heartbeat = new ExportLeaseHeartbeat(() => this.renewLease(job))
    try {
      await heartbeat.start()
      const scope = this.scope(job)
      const snapshot = await heartbeat.run(() => this.snapshot(job.babyId))
      await heartbeat.renewNow()
      const files = buildExportFiles(job.id, generatedAt, scope.includeMedia, snapshot)
      await heartbeat.renewNow()
      const mediaObjects = this.uniqueMedia(snapshot)
      if (scope.includeMedia) {
        await heartbeat.run(() => this.validateMediaObjects(mediaObjects))
        await heartbeat.renewNow()
      }

      const createdArtifact = await heartbeat.run(() => this.prisma.$transaction(async (tx) => {
        const created = await tx.media.create({
          data: {
            ownerUserId: job.requestedBy,
            babyId: job.babyId,
            bucket: this.storage.bucket,
            objectKey: `exports/${randomUUID()}.zip`,
            mimeType: 'application/zip',
            sizeBytes: 0,
            status: MediaStatus.pending,
            purpose: MediaPurpose.export_archive,
          },
        })
        const linked = await tx.exportJob.updateMany({
          where: {
            id: job.id,
            status: ExportStatus.processing,
            workerLeaseId: job.workerLeaseId,
            resultMediaId: null,
          },
          data: { resultMediaId: created.id },
        })
        if (linked.count !== 1) throw new Error('Export worker lease was lost')
        return created
      }))
      artifact = createdArtifact
      await heartbeat.renewNow()

      const entries: ZipEntry[] = [
        { name: 'manifest.json', source: () => bytesSource(files.manifest) },
        { name: 'json/export.json', source: () => bytesSource(files.canonical) },
        { name: 'csv/baby.csv', source: () => bytesSource(files.babyCsv) },
        { name: 'csv/records.csv', source: () => bytesSource(files.recordsCsv) },
        { name: 'csv/measurements.csv', source: () => bytesSource(files.measurementsCsv) },
        { name: 'csv/media.csv', source: () => bytesSource(files.mediaCsv) },
      ]
      if (scope.includeMedia) {
        for (const media of mediaObjects.values()) {
          entries.push({
            name: `media/${media.id}.${extensionFor(media.mimeType)}`,
            source: () => this.streamMedia(job, media.objectKey, heartbeat),
          })
        }
      }

      const stored = await heartbeat.run(() => this.storage.uploadMultipart(
        createdArtifact.objectKey,
        createdArtifact.mimeType,
        createZipStream(entries, generatedAt, MAX_ARCHIVE_BYTES),
      ))
      const head = await heartbeat.run(() => this.storage.head(createdArtifact.objectKey))
      if (!head || head.contentLength !== stored.sizeBytes || head.contentType !== 'application/zip') {
        throw new Error('Stored export verification failed')
      }

      await heartbeat.stop()
      const completedAt = new Date()
      await this.prisma.$transaction(async (tx) => {
        const updatedMedia = await tx.media.updateMany({
          where: {
            id: createdArtifact.id,
            purpose: MediaPurpose.export_archive,
            status: MediaStatus.pending,
          },
          data: {
            status: MediaStatus.ready,
            sizeBytes: stored.sizeBytes,
            sha256: stored.sha256,
            readyAt: completedAt,
          },
        })
        const completed = await tx.exportJob.updateMany({
          where: {
            id: job.id,
            status: ExportStatus.processing,
            workerLeaseId: job.workerLeaseId,
            resultMediaId: createdArtifact.id,
          },
          data: {
            status: ExportStatus.completed,
            resultMediaId: createdArtifact.id,
            completedAt,
            expiresAt: new Date(completedAt.getTime() + PACKAGE_RETENTION_MILLISECONDS),
            workerLeaseId: null,
            leaseExpiresAt: null,
            errorCode: null,
          },
        })
        if (updatedMedia.count !== 1 || completed.count !== 1) throw new Error('Export worker lease was lost')
      })
    } catch (error) {
      try {
        await heartbeat.stop()
      } catch {
        // Preserve the processing error while still waiting for any in-flight
        // renewal to settle before artifact cleanup and retry state changes.
      }
      if (artifact) await this.discardArtifact(artifact)
      await this.failOrRetry(job, error)
    }
  }

  private async snapshot(babyId: string): Promise<ExportSnapshot> {
    return this.prisma.$transaction(async (tx) => {
      const baby = await tx.baby.findFirst({
        where: { id: babyId, deletedAt: null },
        include: { avatarMedia: true },
      })
      if (!baby) throw new PermanentExportError('EXPORT_SOURCE_INVALID')
      const records = await tx.record.findMany({
        where: { babyId, deletedAt: null },
        include: {
          creator: { select: { id: true, displayName: true } },
          measurement: true,
          media: { include: { media: true }, orderBy: { sortOrder: 'asc' } },
        },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        take: MAX_RECORDS + 1,
      })
      if (records.length > MAX_RECORDS) throw new PermanentExportError('EXPORT_TOO_LARGE')

      const avatar = baby.avatarMedia
      const avatarMedia = avatar &&
        avatar.purpose === MediaPurpose.record_image &&
        avatar.status === MediaStatus.ready &&
        avatar.deletedAt === null
        ? this.snapshotMedia(avatar)
        : null

      return {
        baby: {
          id: baby.id,
          name: baby.name,
          gender: baby.gender,
          birthDate: baby.birthDate.toISOString().slice(0, 10),
          birthTime: baby.birthTime?.toISOString().slice(11, 16) ?? null,
          birthHeightCm: baby.birthHeightCm === null ? null : Number(baby.birthHeightCm),
          birthWeightKg: baby.birthWeightKg === null ? null : Number(baby.birthWeightKg),
          createdAt: baby.createdAt.toISOString(),
          updatedAt: baby.updatedAt.toISOString(),
          avatarMediaId: avatarMedia?.id ?? null,
        },
        avatarMedia,
        records: records.map((record) => ({
          id: record.id,
          type: record.type,
          title: record.title,
          content: record.content,
          occurredAt: record.occurredAt.toISOString(),
          createdAt: record.createdAt.toISOString(),
          updatedAt: record.updatedAt.toISOString(),
          version: record.version,
          createdBy: record.creator,
          measurement: record.measurement ? {
            heightCm: record.measurement.heightCm === null ? null : Number(record.measurement.heightCm),
            weightKg: record.measurement.weightKg === null ? null : Number(record.measurement.weightKg),
          } : null,
          media: record.media.map((link) => ({
            ...this.snapshotMedia(link.media),
            sortOrder: link.sortOrder,
          })),
        })),
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  }

  private snapshotMedia(media: Media) {
    if (
      media.purpose !== MediaPurpose.record_image ||
      media.status !== MediaStatus.ready ||
      media.deletedAt !== null ||
      !['image/jpeg', 'image/png'].includes(media.mimeType)
    ) {
      throw new PermanentExportError('SOURCE_MEDIA_UNAVAILABLE')
    }
    return {
      id: media.id,
      mimeType: media.mimeType,
      sizeBytes: Number(media.sizeBytes),
      width: media.width,
      height: media.height,
      objectKey: media.objectKey,
    }
  }

  private uniqueMedia(snapshot: ExportSnapshot) {
    const result = new Map<string, NonNullable<ExportSnapshot['avatarMedia']>>()
    if (snapshot.avatarMedia) result.set(snapshot.avatarMedia.id, snapshot.avatarMedia)
    for (const record of snapshot.records) {
      for (const media of record.media) result.set(media.id, media)
    }
    return result
  }

  private async validateMediaObjects(media: Map<string, NonNullable<ExportSnapshot['avatarMedia']>>): Promise<void> {
    let totalBytes = 0
    for (const item of media.values()) {
      totalBytes += item.sizeBytes
      if (totalBytes > MAX_ARCHIVE_BYTES) throw new PermanentExportError('EXPORT_TOO_LARGE')
      const object = await this.storage.head(item.objectKey)
      if (!object || object.contentLength !== item.sizeBytes || object.contentType !== item.mimeType) {
        throw new PermanentExportError('SOURCE_MEDIA_UNAVAILABLE')
      }
    }
  }

  private async *streamMedia(
    job: ClaimedJob,
    objectKey: string,
    heartbeat?: ExportLeaseHeartbeat,
  ): AsyncGenerator<Uint8Array> {
    const renew = () => heartbeat ? heartbeat.renewNow() : this.renewLease(job)
    await renew()
    const source = await this.storage.readStream(objectKey)
    let renewedAt = Date.now()
    for await (const chunk of source) {
      if (Date.now() - renewedAt >= 60_000) {
        await renew()
        renewedAt = Date.now()
      }
      yield chunk
    }
  }

  private async renewLease(job: ClaimedJob): Promise<void> {
    const renewed = await this.prisma.exportJob.updateMany({
      where: { id: job.id, status: ExportStatus.processing, workerLeaseId: job.workerLeaseId },
      data: { leaseExpiresAt: new Date(Date.now() + LEASE_MILLISECONDS) },
    })
    if (renewed.count !== 1) throw new Error('Export worker lease was lost')
  }

  private async discardArtifact(artifact: Media): Promise<void> {
    let purged = false
    try {
      await this.storage.delete(artifact.objectKey)
      purged = true
    } catch {
      this.logger.warn(JSON.stringify({ message: 'export_artifact_delete_retry', mediaId: artifact.id }))
    }
    await this.prisma.media.updateMany({
      where: { id: artifact.id, purpose: MediaPurpose.export_archive },
      data: {
        status: MediaStatus.deleted,
        deletedAt: artifact.deletedAt ?? new Date(),
        ...(purged ? { purgedAt: new Date() } : {}),
      },
    })
  }

  private async failOrRetry(job: ClaimedJob, error: unknown): Promise<void> {
    const permanentCode = error instanceof PermanentExportError
      ? error.code
      : error instanceof ExportArchiveTooLargeError
        ? 'EXPORT_TOO_LARGE'
        : null
    const shouldRetry = !permanentCode && job.attemptCount < MAX_ATTEMPTS
    const result = await this.prisma.exportJob.updateMany({
      where: {
        id: job.id,
        status: ExportStatus.processing,
        workerLeaseId: job.workerLeaseId,
      },
      data: shouldRetry ? {
        status: ExportStatus.pending,
        resultMediaId: null,
        nextAttemptAt: new Date(Date.now() + RETRY_DELAYS[Math.min(job.attemptCount - 1, RETRY_DELAYS.length - 1)]!),
        workerLeaseId: null,
        leaseExpiresAt: null,
        errorCode: null,
      } : {
        status: ExportStatus.failed,
        resultMediaId: null,
        workerLeaseId: null,
        leaseExpiresAt: null,
        errorCode: permanentCode ?? 'EXPORT_PROCESSING_FAILED',
      },
    })
    if (result.count === 1) {
      this.logger.warn(JSON.stringify({
        message: shouldRetry ? 'export_processing_retry' : 'export_processing_failed',
        exportId: job.id,
        attempt: job.attemptCount,
        errorCode: permanentCode ?? 'EXPORT_PROCESSING_FAILED',
      }))
    }
  }

  private scope(job: ExportJob): { includeMedia: boolean } {
    const scope = job.scope
    if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
      throw new PermanentExportError('EXPORT_SOURCE_INVALID')
    }
    const value = scope as Record<string, Prisma.JsonValue>
    if (
      value.version !== 1 || value.format !== 'zip' || typeof value.includeMedia !== 'boolean' ||
      !Array.isArray(value.representations) || value.representations.join(',') !== 'json,csv'
    ) {
      throw new PermanentExportError('EXPORT_SOURCE_INVALID')
    }
    return { includeMedia: value.includeMedia }
  }
}
