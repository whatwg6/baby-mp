import { createHash, randomUUID } from 'node:crypto'

import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { MediaPurpose, MediaStatus, MemberRole, MemberStatus, Prisma, type Media as PrismaMedia } from '@prisma/client'
import sharp from 'sharp'

import type { Media, MediaUploadResponse } from '@baby-mp/contracts'

import { PrismaService } from '../database/prisma.service'
import type { CompleteMediaUploadDto, CreateMediaUploadDto } from './media.dto'
import { S3StorageService } from './s3-storage.service'

const maxImageBytes = 20 * 1024 * 1024
const allowedMimeTypes = new Set(['image/jpeg', 'image/png'])

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name)

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3StorageService) private readonly storage: S3StorageService,
  ) {}

  async registerCleanupHeartbeat(instanceId: string, at = new Date()): Promise<void> {
    await this.prisma.workerHeartbeat.create({
      data: {
        instanceId,
        workerName: 'media-cleanup',
        startedAt: at,
      },
    })
  }

  async recordCleanupHeartbeatSuccess(instanceId: string, at = new Date()): Promise<void> {
    await this.prisma.workerHeartbeat.updateMany({
      where: { instanceId, workerName: 'media-cleanup', stoppedAt: null },
      data: { lastSuccessAt: at },
    })
  }

  async recordCleanupHeartbeatFailure(instanceId: string, at = new Date()): Promise<void> {
    await this.prisma.workerHeartbeat.updateMany({
      where: { instanceId, workerName: 'media-cleanup', stoppedAt: null },
      data: { lastFailureAt: at },
    })
  }

  async stopCleanupHeartbeat(instanceId: string, at = new Date()): Promise<void> {
    await this.prisma.workerHeartbeat.updateMany({
      where: { instanceId, workerName: 'media-cleanup', stoppedAt: null },
      data: { stoppedAt: at },
    })
  }

  async createUpload(userId: string, babyId: string, input: CreateMediaUploadDto): Promise<MediaUploadResponse['data']> {
    await this.requireWritableMember(userId, babyId)
    if (!allowedMimeTypes.has(input.mimeType)) {
      throw new BadRequestException({ code: 'UNSUPPORTED_MEDIA_TYPE', message: '仅支持 JPEG 和 PNG 图片' })
    }
    if (input.sizeBytes > maxImageBytes) {
      throw new HttpException({ code: 'UPLOAD_TOO_LARGE', message: '图片大小不能超过 20MB' }, HttpStatus.PAYLOAD_TOO_LARGE)
    }

    const id = randomUUID()
    const extension = input.mimeType === 'image/jpeg' ? 'jpg' : input.mimeType.split('/')[1]
    const uploadObjectKey = `uploads/${randomUUID()}.${extension}`
    const objectKey = `media/${randomUUID()}.${extension}`
    const media = await this.prisma.media.create({
      data: {
        id,
        ownerUserId: userId,
        babyId,
        bucket: this.storage.bucket,
        objectKey,
        uploadObjectKey,
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.sizeBytes),
        sha256: input.sha256?.toLowerCase(),
      },
    })

    try {
      const url = await this.storage.createUploadUrl(uploadObjectKey, media.mimeType, input.sizeBytes)
      return {
        mediaId: media.id,
        upload: {
          method: 'PUT',
          url,
          headers: { 'Content-Type': media.mimeType },
          expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        },
      }
    } catch (error) {
      await this.prisma.media.update({ where: { id }, data: { status: MediaStatus.failed } })
      throw error
    }
  }

  async complete(userId: string, mediaId: string, _input: CompleteMediaUploadDto): Promise<Media> {
    const media = await this.findAuthorized(userId, mediaId)
    const membership = await this.activeMembership(userId, media.babyId)
    if (!membership || (media.ownerUserId !== userId && membership.role !== MemberRole.admin)) {
      throw new ForbiddenException('只有上传者或管理员可以确认上传')
    }
    if (media.status === MediaStatus.ready) {
      await this.deleteTrackedUpload(media)
      return this.toMedia(media, await this.storage.createAccessUrl(media.objectKey))
    }
    if (media.status !== MediaStatus.pending && media.status !== MediaStatus.uploaded) {
      throw new UnprocessableEntityException({ code: 'UPLOAD_INCOMPLETE', message: '上传不可完成' })
    }

    if (!media.uploadObjectKey) {
      throw new UnprocessableEntityException({ code: 'UPLOAD_INCOMPLETE', message: '上传不可完成' })
    }
    const object = await this.storage.head(media.uploadObjectKey)
    if (!object) {
      throw new UnprocessableEntityException({ code: 'UPLOAD_INCOMPLETE', message: '尚未检测到上传文件' })
    }
    if (object.contentLength !== Number(media.sizeBytes) || object.contentType !== media.mimeType) {
      await this.prisma.media.update({ where: { id: media.id }, data: { status: MediaStatus.failed } })
      throw new UnprocessableEntityException({ code: 'UPLOAD_INCOMPLETE', message: '上传文件与申请信息不一致' })
    }

    let actualWidth: number
    let actualHeight: number
    try {
      const bytes = await this.storage.read(media.uploadObjectKey)
      if (media.sha256 && createHash('sha256').update(bytes).digest('hex') !== media.sha256) {
        throw new Error('digest mismatch')
      }
      const metadata = await sharp(bytes, { failOn: 'error' }).metadata()
      const expectedFormat = media.mimeType === 'image/jpeg' ? 'jpeg' : 'png'
      if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) throw new Error('invalid image')
      actualWidth = metadata.width
      actualHeight = metadata.height
    } catch {
      await this.prisma.media.update({ where: { id: media.id }, data: { status: MediaStatus.failed } })
      throw new UnprocessableEntityException({ code: 'UPLOAD_INCOMPLETE', message: '上传内容不是有效图片' })
    }

    await this.storage.promote(media.uploadObjectKey, media.objectKey, media.mimeType)
    let claimed: { count: number }
    try {
      claimed = await this.prisma.media.updateMany({
        where: { id: media.id, status: { in: [MediaStatus.pending, MediaStatus.uploaded] } },
        data: {
          status: MediaStatus.ready,
          width: actualWidth,
          height: actualHeight,
          readyAt: new Date(),
        },
      })
    } catch (error) {
      const current = await this.prisma.media.findUnique({ where: { id: media.id } })
      if (current?.status !== MediaStatus.ready) await this.storage.delete(media.objectKey)
      throw error
    }
    if (claimed.count !== 1) {
      const current = await this.findAuthorized(userId, mediaId)
      if (current.status !== MediaStatus.ready) {
        await this.storage.delete(media.objectKey)
        throw new UnprocessableEntityException({ code: 'UPLOAD_INCOMPLETE', message: '上传不可完成' })
      }
      return this.toMedia(current, await this.storage.createAccessUrl(current.objectKey))
    }
    await this.deleteTrackedUpload(media)
    const ready = await this.prisma.media.findUniqueOrThrow({ where: { id: media.id } })
    return this.toMedia(ready, await this.storage.createAccessUrl(ready.objectKey))
  }

  async get(userId: string, mediaId: string): Promise<Media> {
    const media = await this.findAuthorized(userId, mediaId)
    const accessUrl = media.status === MediaStatus.ready
      ? await this.storage.createAccessUrl(media.objectKey)
      : null
    return this.toMedia(media, accessUrl)
  }

  async abandon(userId: string, mediaId: string): Promise<void> {
    const media = await this.claimForAbandon(userId, mediaId)
    try {
      await this.deleteStoredObjects(media)
      await this.prisma.media.update({
        where: { id: media.id },
        data: { purgedAt: new Date(), uploadObjectKey: null },
      })
    } catch {
      this.logger.warn(JSON.stringify({ message: 'media_physical_delete_deferred', mediaId }))
    }
  }

  async cleanupOrphans(cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)): Promise<number> {
    const trackedUploads = await this.prisma.media.findMany({
      where: { status: MediaStatus.ready, uploadObjectKey: { not: null } },
      take: 100,
    })
    for (const media of trackedUploads) await this.deleteTrackedUpload(media)

    const candidates = await this.prisma.media.findMany({
      where: {
        OR: [
          {
            createdAt: { lt: cutoff },
            deletedAt: null,
            status: { in: [MediaStatus.pending, MediaStatus.uploaded, MediaStatus.failed, MediaStatus.ready] },
          },
          { status: MediaStatus.deleted, purgedAt: null },
        ],
        records: { none: {} },
        userAvatars: { none: {} },
        babyAvatars: { none: {} },
        exportResults: { none: {} },
      },
      take: 100,
    })
    let cleaned = 0
    for (const media of candidates) {
      try {
        const claimed = media.status === MediaStatus.deleted
          ? media
          : await this.claimOrphan(media.id, cutoff)
        if (!claimed) continue
        await this.deleteStoredObjects(claimed)
        await this.prisma.media.update({
          where: { id: claimed.id },
          data: {
            status: MediaStatus.deleted,
            deletedAt: claimed.deletedAt ?? new Date(),
            purgedAt: new Date(),
            uploadObjectKey: null,
          },
        })
        cleaned += 1
      } catch {
        this.logger.warn(JSON.stringify({ message: 'orphan_media_cleanup_retry', mediaId: media.id }))
      }
    }
    return cleaned
  }

  async accessUrlFor(media: Pick<PrismaMedia, 'objectKey' | 'status'>): Promise<string | null> {
    return media.status === MediaStatus.ready ? this.storage.createAccessUrl(media.objectKey) : null
  }

  private async findAuthorized(userId: string, mediaId: string): Promise<PrismaMedia> {
    const media = await this.prisma.media.findFirst({
      where: { id: mediaId, deletedAt: null, purpose: MediaPurpose.record_image },
    })
    if (!media || !await this.activeMembership(userId, media.babyId)) throw new NotFoundException('资源不存在')
    return media
  }

  private async requireWritableMember(userId: string, babyId: string): Promise<void> {
    const membership = await this.activeMembership(userId, babyId)
    if (!membership) throw new NotFoundException('资源不存在')
    if (membership.role === MemberRole.viewer) throw new ForbiddenException('当前角色不能上传图片')
  }

  private activeMembership(userId: string, babyId: string) {
    return this.prisma.babyMember.findFirst({
      where: { userId, babyId, status: MemberStatus.active, baby: { deletedAt: null } },
      select: { role: true },
    })
  }

  private claimOrphan(mediaId: string, cutoff: Date): Promise<PrismaMedia | null> {
    return this.prisma.$transaction(async (tx) => {
      const media = await tx.media.findFirst({
        where: {
          id: mediaId,
          purpose: MediaPurpose.record_image,
          createdAt: { lt: cutoff },
          deletedAt: null,
          status: { in: [MediaStatus.pending, MediaStatus.uploaded, MediaStatus.failed, MediaStatus.ready] },
          records: { none: {} },
          userAvatars: { none: {} },
          babyAvatars: { none: {} },
          exportResults: { none: {} },
        },
      })
      if (!media) return null
      const result = await tx.media.updateMany({
        where: { id: media.id, status: media.status, deletedAt: null },
        data: { status: MediaStatus.failed },
      })
      return result.count === 1 ? { ...media, status: MediaStatus.failed } : null
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  }

  private claimForAbandon(userId: string, mediaId: string): Promise<PrismaMedia> {
    return this.prisma.$transaction(async (tx) => {
      const media = await tx.media.findFirst({
        where: { id: mediaId, deletedAt: null, purpose: MediaPurpose.record_image },
      })
      if (!media) throw new NotFoundException('资源不存在')
      const membership = await tx.babyMember.findFirst({
        where: {
          userId,
          babyId: media.babyId,
          status: MemberStatus.active,
          baby: { deletedAt: null },
        },
        select: { role: true },
      })
      if (!membership) throw new NotFoundException('资源不存在')
      if (media.ownerUserId !== userId && membership.role !== MemberRole.admin) {
        throw new ForbiddenException('只有上传者或管理员可以放弃图片')
      }
      const referenced = await tx.media.findFirst({
        where: {
          id: mediaId,
          OR: [
            { records: { some: {} } },
            { userAvatars: { some: {} } },
            { babyAvatars: { some: {} } },
          ],
        },
        select: { id: true },
      })
      if (referenced) throw new ForbiddenException('已关联业务数据的图片不能放弃')
      const deletedAt = new Date()
      const result = await tx.media.updateMany({
        where: { id: mediaId, deletedAt: null },
        data: { status: MediaStatus.deleted, deletedAt },
      })
      if (result.count !== 1) throw new NotFoundException('资源不存在')
      return { ...media, status: MediaStatus.deleted, deletedAt }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  }

  private async deleteTrackedUpload(media: PrismaMedia): Promise<void> {
    if (!media.uploadObjectKey) return
    try {
      await this.storage.delete(media.uploadObjectKey)
      await this.prisma.media.updateMany({
        where: { id: media.id, uploadObjectKey: media.uploadObjectKey },
        data: { uploadObjectKey: null },
      })
    } catch {
      this.logger.warn(JSON.stringify({ message: 'temporary_upload_delete_deferred', mediaId: media.id }))
    }
  }

  private async deleteStoredObjects(media: PrismaMedia): Promise<void> {
    if (media.uploadObjectKey) await this.storage.delete(media.uploadObjectKey)
    await this.storage.delete(media.objectKey)
  }

  private toMedia(media: PrismaMedia, accessUrl: string | null): Media {
    return {
      id: media.id,
      mimeType: media.mimeType,
      width: media.width,
      height: media.height,
      sizeBytes: Number(media.sizeBytes),
      status: media.status,
      accessUrl,
    }
  }
}
