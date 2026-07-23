import {
  ForbiddenException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { MediaStatus, MemberRole } from '@prisma/client'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

import type { PrismaService } from '../src/database/prisma.service'
import { MediaService } from '../src/media/media.service'
import type { S3StorageService } from '../src/media/s3-storage.service'

const userId = '11111111-1111-4111-8111-111111111111'
const otherUserId = '22222222-2222-4222-8222-222222222222'
const babyId = '33333333-3333-4333-8333-333333333333'
const mediaId = '44444444-4444-4444-8444-444444444444'
const secretKey = 'uploads/private-key-sentinel.png'
const signedUrl = 'https://storage.invalid/private?signature=signed-url-sentinel'

function media(overrides: Record<string, unknown> = {}) {
  return {
    id: mediaId,
    ownerUserId: userId,
    babyId,
    storageProvider: 's3',
    bucket: 'private',
    objectKey: secretKey,
    uploadObjectKey: secretKey,
    mimeType: 'image/png',
    sizeBytes: BigInt(10),
    width: null,
    height: null,
    sha256: null,
    status: MediaStatus.pending,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    readyAt: null,
    deletedAt: null,
    purgedAt: null,
    ...overrides,
  }
}

function service(prisma: object, storage: object = {}): MediaService {
  return new MediaService(prisma as PrismaService, {
    bucket: 'private',
    ...storage,
  } as S3StorageService)
}

describe('M3 MediaService authorization and ownership', () => {
  it('rejects viewer upload before creating a media row or signed PUT URL', async () => {
    const prisma = {
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.viewer })) },
      media: { create: vi.fn() },
    }
    const storage = { createUploadUrl: vi.fn() }
    await expect(service(prisma, storage).createUpload(userId, babyId, {
      fileName: 'photo.png', mimeType: 'image/png', sizeBytes: 10,
    })).rejects.toBeInstanceOf(ForbiddenException)
    expect(prisma.media.create).not.toHaveBeenCalled()
    expect(storage.createUploadUrl).not.toHaveBeenCalled()
  })

  it('uses identical non-disclosing 404s for missing, deleted, outsider, and removed-member reads without signing', async () => {
    const cases = [
      { found: null, membership: null },
      { found: null, membership: { role: MemberRole.admin } },
      { found: media(), membership: null },
      { found: media(), membership: null },
    ]
    const responses: unknown[] = []
    const createAccessUrl = vi.fn()
    for (const item of cases) {
      const instance = service({
        media: { findFirst: vi.fn(async () => item.found) },
        babyMember: { findFirst: vi.fn(async () => item.membership) },
      }, { createAccessUrl })
      try { await instance.get(otherUserId, mediaId) } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException)
        responses.push((error as NotFoundException).getResponse())
      }
    }
    expect(responses).toHaveLength(4)
    expect(new Set(responses.map((response) => JSON.stringify(response)))).toHaveLength(1)
    expect(createAccessUrl).not.toHaveBeenCalled()
  })

  it('allows only the owner or current admin to complete an upload', async () => {
    const found = media({ ownerUserId: otherUserId })
    const prisma = {
      media: { findFirst: vi.fn(async () => found) },
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.editor })) },
    }
    const storage = { head: vi.fn() }
    await expect(service(prisma, storage).complete(userId, mediaId, { width: 1, height: 1 }))
      .rejects.toBeInstanceOf(ForbiddenException)
    expect(storage.head).not.toHaveBeenCalled()
  })

  it('does not let a non-owner editor abandon media and does not reveal whether it exists', async () => {
    const tx = {
      media: {
        findFirst: vi.fn()
          .mockResolvedValueOnce(media({ ownerUserId: otherUserId })),
        updateMany: vi.fn(),
      },
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.editor })) },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    }
    await expect(service(prisma).abandon(userId, mediaId)).rejects.toBeInstanceOf(ForbiddenException)
    expect(tx.media.findFirst).toHaveBeenCalledTimes(1)
    expect(tx.media.updateMany).not.toHaveBeenCalled()
  })

  it('blocks abandon for media linked to any record so deleting one record cannot destroy shared bytes', async () => {
    const tx = {
      media: {
        findFirst: vi.fn()
          .mockResolvedValueOnce(media())
          .mockResolvedValueOnce({ id: mediaId }),
        updateMany: vi.fn(),
      },
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.editor })) },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    }
    const storage = { delete: vi.fn() }
    await expect(service(prisma, storage).abandon(userId, mediaId)).rejects.toBeInstanceOf(ForbiddenException)
    expect(storage.delete).not.toHaveBeenCalled()
  })
})

describe('M3 MediaService quarantine and completion state machine', () => {
  it('returns UPLOAD_INCOMPLETE without mutation when the temporary object is absent', async () => {
    const prisma = {
      media: { findFirst: vi.fn(async () => media()), update: vi.fn() },
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.admin })) },
    }
    const storage = { head: vi.fn(async () => null), promote: vi.fn() }
    try {
      await service(prisma, storage).complete(userId, mediaId, { width: 1, height: 1 })
      throw new Error('expected failure')
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityException)
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({ code: 'UPLOAD_INCOMPLETE' })
    }
    expect(prisma.media.update).not.toHaveBeenCalled()
    expect(storage.promote).not.toHaveBeenCalled()
  })

  it('marks size or MIME mismatches failed before reading or promotion', async () => {
    for (const metadata of [
      { contentLength: 9, contentType: 'image/png' },
      { contentLength: 10, contentType: 'image/jpeg' },
    ]) {
      const prisma = {
        media: {
          findFirst: vi.fn(async () => media()),
          update: vi.fn(async () => media({ status: MediaStatus.failed })),
        },
        babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.admin })) },
      }
      const storage = { head: vi.fn(async () => metadata), read: vi.fn(), promote: vi.fn() }
      await expect(service(prisma, storage).complete(userId, mediaId, { width: 1, height: 1 }))
        .rejects.toBeInstanceOf(UnprocessableEntityException)
      expect(prisma.media.update).toHaveBeenCalledWith({ where: { id: mediaId }, data: { status: MediaStatus.failed } })
      expect(storage.read).not.toHaveBeenCalled()
      expect(storage.promote).not.toHaveBeenCalled()
    }
  })

  it('verifies sha256 and real image bytes instead of trusting client dimensions', async () => {
    const bytes = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#fff' } }).png().toBuffer()
    const prisma = {
      media: {
        findFirst: vi.fn(async () => media({ sizeBytes: BigInt(bytes.length), sha256: '0'.repeat(64) })),
        update: vi.fn(async () => media({ status: MediaStatus.failed })),
      },
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.admin })) },
    }
    const storage = {
      head: vi.fn(async () => ({ contentLength: bytes.length, contentType: 'image/png' })),
      read: vi.fn(async () => bytes), promote: vi.fn(),
    }
    await expect(service(prisma, storage).complete(userId, mediaId, { width: 999, height: 999 }))
      .rejects.toBeInstanceOf(UnprocessableEntityException)
    expect(storage.promote).not.toHaveBeenCalled()
    expect(prisma.media.update).toHaveBeenCalledWith({ where: { id: mediaId }, data: { status: MediaStatus.failed } })
  })

  it('makes ready completion idempotent without reading or promoting the temporary object', async () => {
    const ready = media({
      status: MediaStatus.ready, objectKey: 'media/immutable.png', uploadObjectKey: secretKey, width: 2, height: 3,
    })
    const prisma = {
      media: { findFirst: vi.fn(async () => ready) },
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.admin })) },
    }
    const storage = {
      createAccessUrl: vi.fn(async () => signedUrl), head: vi.fn(), read: vi.fn(), promote: vi.fn(),
    }
    const result = await service(prisma, storage).complete(userId, mediaId, { width: 1, height: 1 })
    expect(result).toMatchObject({ status: MediaStatus.ready, width: 2, height: 3, accessUrl: signedUrl })
    expect(storage.createAccessUrl).toHaveBeenCalledWith('media/immutable.png')
    expect(storage.head).not.toHaveBeenCalled()
    expect(storage.promote).not.toHaveBeenCalled()
  })

  it('uses a CAS claim, preserves the shared immutable object, and returns the winner on concurrent completion', async () => {
    const bytes = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#fff' } }).png().toBuffer()
    const winner = media({ status: MediaStatus.ready, objectKey: 'media/winner.png', width: 2, height: 3 })
    const prisma = {
      media: {
        findFirst: vi.fn().mockResolvedValueOnce(media({ sizeBytes: BigInt(bytes.length) })).mockResolvedValueOnce(winner),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.admin })) },
    }
    const storage = {
      head: vi.fn(async () => ({ contentLength: bytes.length, contentType: 'image/png' })),
      read: vi.fn(async () => bytes), promote: vi.fn(), delete: vi.fn(), createAccessUrl: vi.fn(async () => signedUrl),
    }
    const result = await service(prisma, storage).complete(userId, mediaId, { width: 1, height: 1 })
    expect(prisma.media.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: mediaId, status: { in: [MediaStatus.pending, MediaStatus.uploaded] } },
    }))
    expect(storage.promote).toHaveBeenCalledWith(secretKey, secretKey, 'image/png')
    expect(storage.delete).not.toHaveBeenCalled()
    expect(result.accessUrl).toBe(signedUrl)
  })

  it('does not issue access URLs for pending, failed, or deleted media', async () => {
    for (const status of [MediaStatus.pending, MediaStatus.failed, MediaStatus.deleted]) {
      const createAccessUrl = vi.fn()
      const result = await service({}, { createAccessUrl }).accessUrlFor({ objectKey: secretKey, status })
      expect(result).toBeNull()
      expect(createAccessUrl).not.toHaveBeenCalled()
    }
  })
})

describe('M3 MediaService cleanup and low-sensitivity logging', () => {
  it('selects only old unlinked candidates, marks successful deletes, and retries failures later', async () => {
    const failedId = '55555555-5555-4555-8555-555555555555'
    const cutoff = new Date('2026-01-02T00:00:00.000Z')
    const candidates = [
      media({ uploadObjectKey: 'uploads/first-temporary.png' }),
      media({ id: failedId, objectKey: 'media/second-secret.png', uploadObjectKey: null }),
    ]
    const tx = {
      media: {
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
          candidates.find((candidate) => candidate.id === where.id) ?? null),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    }
    const prisma = {
      media: {
        findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(candidates),
        update: vi.fn(async () => undefined),
      },
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    }
    const storage = {
      delete: vi.fn(async (key: string) => { if (key.includes('second')) throw new Error('s3 failure containing signed-url-sentinel') }),
    }
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const count = await service(prisma, storage).cleanupOrphans(cutoff)
    expect(prisma.media.findMany).toHaveBeenNthCalledWith(1, {
      where: { status: MediaStatus.ready, uploadObjectKey: { not: null } },
      take: 100,
    })
    expect(prisma.media.findMany).toHaveBeenNthCalledWith(2, { where: {
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
    }, take: 100 })
    expect(count).toBe(1)
    expect(prisma.media.update).toHaveBeenCalledTimes(1)
    const output = warn.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain(failedId)
    expect(output).not.toContain('uploads/second-secret.png')
    expect(output).not.toContain('signed-url-sentinel')
  })

  it('never logs an object key, signed URL, or storage exception when physical abandon deletion fails', async () => {
    const tx = {
      media: {
        findFirst: vi.fn().mockResolvedValueOnce(media()).mockResolvedValueOnce(null),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      babyMember: { findFirst: vi.fn(async () => ({ role: MemberRole.admin })) },
    }
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
      media: { update: vi.fn() },
    }
    const storage = { delete: vi.fn(async () => { throw new Error(`failure ${secretKey} ${signedUrl}`) }) }
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    await service(prisma, storage).abandon(userId, mediaId)
    const output = warn.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain(mediaId)
    expect(output).not.toContain(secretKey)
    expect(output).not.toContain('signed-url-sentinel')
  })
})
