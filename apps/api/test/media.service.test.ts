import { BadRequestException, UnprocessableEntityException } from '@nestjs/common'
import { MediaStatus, MemberRole } from '@prisma/client'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

import type { PrismaService } from '../src/database/prisma.service'
import { MediaService } from '../src/media/media.service'
import type { S3StorageService } from '../src/media/s3-storage.service'

const userId = 'a1111111-1111-4111-8111-111111111111'
const babyId = 'b1111111-1111-4111-8111-111111111111'
const mediaId = 'c1111111-1111-4111-8111-111111111111'

function mediaFixture() {
  return {
    id: mediaId,
    ownerUserId: userId,
    babyId,
    storageProvider: 's3',
    bucket: 'private',
    objectKey: 'media/immutable.png',
    uploadObjectKey: 'uploads/temporary.png',
    mimeType: 'image/png',
    sizeBytes: BigInt(10),
    width: null,
    height: null,
    sha256: null,
    status: MediaStatus.pending,
    createdAt: new Date(),
    readyAt: null,
    deletedAt: null,
    purgedAt: null,
  }
}

describe('MediaService', () => {
  it('decodes the image and promotes the temporary upload to an immutable key', async () => {
    const bytes = await sharp({
      create: { width: 2, height: 3, channels: 3, background: '#fff' },
    }).png().toBuffer()
    const media = { ...mediaFixture(), sizeBytes: BigInt(bytes.length) }
    let updateData: Record<string, unknown> = {}
    const prisma = {
      media: {
        findFirst: vi.fn().mockResolvedValue(media),
        updateMany: vi.fn().mockImplementation(({ data }) => {
          updateData = { ...updateData, ...data }
          return { count: 1 }
        }),
        findUniqueOrThrow: vi.fn().mockImplementation(() => ({ ...media, ...updateData })),
      },
      babyMember: { findFirst: vi.fn().mockResolvedValue({ role: MemberRole.admin }) },
    }
    const storage = {
      head: vi.fn().mockResolvedValue({ contentLength: bytes.length, contentType: 'image/png' }),
      read: vi.fn().mockResolvedValue(bytes),
      promote: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      createAccessUrl: vi.fn().mockResolvedValue('https://storage.test/signed'),
    }
    const service = new MediaService(
      prisma as unknown as PrismaService,
      storage as unknown as S3StorageService,
    )

    const result = await service.complete(userId, mediaId, { width: 99, height: 99 })

    expect(storage.promote).toHaveBeenCalledWith(
      'uploads/temporary.png',
      'media/immutable.png',
      'image/png',
    )
    expect(updateData).toMatchObject({ width: 2, height: 3, status: MediaStatus.ready })
    expect(updateData).not.toHaveProperty('objectKey')
    expect(result).toMatchObject({ width: 2, height: 3, accessUrl: 'https://storage.test/signed' })
  })

  it('rejects content that is not a decodable image before promotion', async () => {
    const media = mediaFixture()
    const prisma = {
      media: {
        findFirst: vi.fn().mockResolvedValue(media),
        update: vi.fn().mockResolvedValue({ ...media, status: MediaStatus.failed }),
      },
      babyMember: { findFirst: vi.fn().mockResolvedValue({ role: MemberRole.admin }) },
    }
    const storage = {
      head: vi.fn().mockResolvedValue({ contentLength: 10, contentType: 'image/png' }),
      read: vi.fn().mockResolvedValue(new Uint8Array(10)),
      promote: vi.fn(),
    }
    const service = new MediaService(
      prisma as unknown as PrismaService,
      storage as unknown as S3StorageService,
    )

    await expect(service.complete(userId, mediaId, { width: 1, height: 1 }))
      .rejects.toBeInstanceOf(UnprocessableEntityException)
    expect(storage.promote).not.toHaveBeenCalled()
    expect(prisma.media.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: MediaStatus.failed },
    }))
  })

  it('maps an unsupported MIME type to a stable business error', async () => {
    const prisma = {
      babyMember: { findFirst: vi.fn().mockResolvedValue({ role: MemberRole.editor }) },
    }
    const service = new MediaService(
      prisma as unknown as PrismaService,
      { bucket: 'private' } as unknown as S3StorageService,
    )
    const error = await service.createUpload(userId, babyId, {
      fileName: 'bad.gif', mimeType: 'image/gif', sizeBytes: 10,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BadRequestException)
    expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' })
  })
})
