import { createHash } from 'node:crypto'

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  BabyGender,
  ExportStatus,
  InviteStatus,
  MediaPurpose,
  MediaStatus,
  MemberRole,
  MemberStatus,
  Prisma,
  type Baby as PrismaBaby,
} from '@prisma/client'

import type { Baby } from '@baby-mp/contracts'

import type { Environment } from '../config/environment'
import { naturalDateInTimeZone } from '../common/time/natural-date'
import { PrismaService } from '../database/prisma.service'
import { MediaService } from '../media/media.service'
import type { CreateBabyDto, UpdateBabyDto } from './baby.dto'

type BabyWithAvatar = PrismaBaby & {
  avatarMedia: null | {
    objectKey: string
    status: MediaStatus
  }
}
type BabyWithMembership = BabyWithAvatar & { members: Array<{ role: MemberRole }> }
const CREATE_OPERATION = 'babies.create'

@Injectable()
export class BabiesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService)
    private readonly config: ConfigService<Environment, true>,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  async list(userId: string): Promise<Baby[]> {
    const memberships = await this.prisma.babyMember.findMany({
      where: { userId, status: MemberStatus.active, baby: { deletedAt: null } },
      include: { baby: { include: { avatarMedia: { select: { objectKey: true, status: true } } } } },
      orderBy: { joinedAt: 'asc' },
    })
    return Promise.all(memberships.map((membership) => this.toBaby(membership.baby, membership.role)))
  }

  async get(userId: string, babyId: string): Promise<Baby> {
    const baby = await this.prisma.baby.findFirst({
      where: { id: babyId, deletedAt: null },
      include: {
        avatarMedia: { select: { objectKey: true, status: true } },
        members: { where: { userId, status: MemberStatus.active }, select: { role: true } },
      },
    })
    if (!baby?.members[0]) throw new NotFoundException('资源不存在')
    return this.toBaby(baby, baby.members[0].role)
  }

  async create(userId: string, key: string, input: CreateBabyDto): Promise<Baby> {
    this.assertIdempotencyKey(key)
    const dates = this.validateDates(input.birthDate, input.birthTime)
    const normalized = { ...input, name: input.name.trim() }
    if (!normalized.name) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED', message: '提交内容有误',
        details: [{ field: 'name', reason: '昵称不能为空' }],
      })
    }
    const requestHash = createHash('sha256')
      .update(this.stableJson(normalized))
      .digest('hex')

    const execute = async (): Promise<Baby> => this.prisma.$transaction(async (tx) => {
      const existing = await tx.idempotencyKey.findUnique({
        where: { userId_operation_key: { userId, operation: CREATE_OPERATION, key } },
      })
      if (existing) return this.replay(existing.requestHash, requestHash, existing.responseBody)

      await tx.idempotencyKey.create({
        data: {
          userId, operation: CREATE_OPERATION, key, requestHash,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      })
      const baby = await tx.baby.create({
        data: {
          name: normalized.name,
          gender: normalized.gender as BabyGender,
          birthDate: dates.birthDate,
          birthTime: dates.birthTime,
          birthHeightCm: normalized.birthHeightCm,
          birthWeightKg: normalized.birthWeightKg,
          createdBy: userId,
          members: { create: { userId, role: MemberRole.admin, status: MemberStatus.active } },
        },
      })
      const response = await this.toBaby(
        { ...baby, avatarMedia: null },
        MemberRole.admin,
      )
      await tx.idempotencyKey.update({
        where: { userId_operation_key: { userId, operation: CREATE_OPERATION, key } },
        data: { responseCode: 201, responseBody: response },
      })
      return response
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await execute()
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
          const existing = await this.prisma.idempotencyKey.findUnique({
            where: { userId_operation_key: { userId, operation: CREATE_OPERATION, key } },
          })
          if (existing) return this.replay(existing.requestHash, requestHash, existing.responseBody)
          if (error.code === 'P2034' && attempt === 0) continue
          throw new ConflictException({ code: 'CONFLICT', message: '请求冲突，请重试' })
        }
        throw error
      }
    }
    throw new ConflictException({ code: 'CONFLICT', message: '请求冲突，请重试' })
  }

  async update(userId: string, babyId: string, input: UpdateBabyDto): Promise<Baby> {
    const current = await this.prisma.baby.findFirst({
      where: { id: babyId, deletedAt: null },
      include: { members: { where: { userId, status: MemberStatus.active }, select: { role: true } } },
    })
    if (!current?.members[0]) throw new NotFoundException('资源不存在')
    const dates = input.birthDate || input.birthTime
      ? this.validateDates(input.birthDate ?? this.dateOnly(current.birthDate), input.birthTime)
      : undefined
    const name = input.name?.trim()
    if (input.name !== undefined && !name) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '提交内容有误', details: [{ field: 'name', reason: '昵称不能为空' }] })
    }
    const update = (client: Prisma.TransactionClient | PrismaService) =>
      client.baby.updateMany({
        where: { id: babyId, deletedAt: null, version: input.version },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(input.gender !== undefined ? { gender: input.gender as BabyGender } : {}),
          ...(input.birthDate !== undefined ? { birthDate: dates!.birthDate } : {}),
          ...(input.birthTime !== undefined ? { birthTime: input.birthTime === null ? null : dates!.birthTime } : {}),
          ...(input.birthHeightCm !== undefined ? { birthHeightCm: input.birthHeightCm } : {}),
          ...(input.birthWeightKg !== undefined ? { birthWeightKg: input.birthWeightKg } : {}),
          ...(input.avatarMediaId !== undefined ? { avatarMediaId: input.avatarMediaId } : {}),
          version: { increment: 1 },
        },
      })
    const result = input.avatarMediaId
      ? await this.prisma.$transaction(async (tx) => {
        const avatar = await tx.media.findFirst({
          where: {
            id: input.avatarMediaId!,
            babyId,
            purpose: MediaPurpose.record_image,
            status: MediaStatus.ready,
            deletedAt: null,
            mimeType: { in: ['image/jpeg', 'image/png'] },
          },
          select: { id: true },
        })
        if (!avatar) {
          throw new BadRequestException({
            code: 'VALIDATION_FAILED',
            message: '头像图片不可用',
            details: [{ field: 'avatarMediaId', reason: '头像必须是当前宝宝已完成上传的 JPEG 或 PNG 图片' }],
          })
        }
        return update(tx)
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      : await update(this.prisma)
    if (result.count !== 1) {
      throw new ConflictException({ code: 'VERSION_CONFLICT', message: '内容已被其他成员更新，请刷新后重试' })
    }
    return this.get(userId, babyId)
  }

  async remove(userId: string, babyId: string, requestId?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const membership = await tx.babyMember.findFirst({
        where: {
          userId,
          babyId,
          role: MemberRole.admin,
          status: MemberStatus.active,
          baby: { deletedAt: null },
        },
        select: { id: true },
      })
      if (!membership) throw new NotFoundException('资源不存在')

      const deletedAt = new Date()
      const deleted = await tx.baby.updateMany({
        where: { id: babyId, deletedAt: null },
        data: { deletedAt, version: { increment: 1 } },
      })
      if (deleted.count !== 1) throw new NotFoundException('资源不存在')

      await Promise.all([
        tx.babyMember.updateMany({
          where: { babyId, status: MemberStatus.active },
          data: {
            status: MemberStatus.removed,
            removedAt: deletedAt,
            removedBy: userId,
            version: { increment: 1 },
          },
        }),
        tx.familyInvite.updateMany({
          where: { babyId, status: InviteStatus.pending },
          data: { status: InviteStatus.revoked, revokedAt: deletedAt },
        }),
        tx.exportJob.updateMany({
          where: { babyId, status: { in: [ExportStatus.pending, ExportStatus.processing] } },
          data: {
            status: ExportStatus.failed,
            errorCode: 'BABY_DELETED',
            workerLeaseId: null,
            leaseExpiresAt: null,
          },
        }),
        tx.auditLog.create({
          data: {
            actorUserId: userId,
            babyId,
            action: 'baby.deleted',
            resourceType: 'baby',
            resourceId: babyId,
            requestId,
            metadata: {},
          },
        }),
      ])
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  }

  private replay(storedHash: string, requestHash: string, body: Prisma.JsonValue | null): Baby {
    if (storedHash !== requestHash) {
      throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: '幂等键已用于不同请求' })
    }
    if (!body) throw new ConflictException({ code: 'CONFLICT', message: '请求正在处理中，请稍后重试' })
    return body as unknown as Baby
  }

  private assertIdempotencyKey(key: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Idempotency-Key 必须是 UUID' })
    }
  }

  private validateDates(birthDate: string, birthTime?: string | null): { birthDate: Date; birthTime: Date | null } {
    const date = new Date(`${birthDate}T00:00:00.000Z`)
    if (
      Number.isNaN(date.getTime()) ||
      this.dateOnly(date) !== birthDate ||
      birthDate > this.localDateOnly(new Date())
    ) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '提交内容有误', details: [{ field: 'birthDate', reason: '出生日期不能晚于今天' }] })
    }
    return {
      birthDate: date,
      birthTime: birthTime ? new Date(`1970-01-01T${birthTime}:00.000Z`) : null,
    }
  }

  private async toBaby(
    baby: BabyWithAvatar | BabyWithMembership,
    role: MemberRole,
  ): Promise<Baby> {
    return {
      id: baby.id,
      name: baby.name,
      gender: baby.gender,
      birthDate: this.dateOnly(baby.birthDate),
      birthTime: baby.birthTime ? baby.birthTime.toISOString().slice(11, 16) : null,
      birthHeightCm: baby.birthHeightCm === null ? null : Number(baby.birthHeightCm),
      birthWeightKg: baby.birthWeightKg === null ? null : Number(baby.birthWeightKg),
      avatarUrl: baby.avatarMedia
        ? await this.media.accessUrlFor(baby.avatarMedia)
        : null,
      role,
      version: baby.version,
      createdAt: baby.createdAt.toISOString(),
      updatedAt: baby.updatedAt.toISOString(),
    }
  }

  private dateOnly(value: Date): string {
    return value.toISOString().slice(0, 10)
  }

  private localDateOnly(value: Date): string {
    return naturalDateInTimeZone(
      value,
      this.config.get('BUSINESS_TIME_ZONE', { infer: true }),
    )
  }

  private stableJson(value: Record<string, unknown>): string {
    return JSON.stringify(Object.keys(value).sort().reduce<Record<string, unknown>>((result, key) => {
      result[key] = value[key]
      return result
    }, {}))
  }
}
