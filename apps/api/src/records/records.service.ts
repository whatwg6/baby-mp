import { createHash } from 'node:crypto'

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  MediaStatus,
  MemberRole,
  MemberStatus,
  Prisma,
  RecordType as PrismaRecordType,
} from '@prisma/client'

import {
  createRecordInputSchema,
  timelineQuerySchema,
  updateRecordInputSchema,
  type CreateRecordInput,
  type Record as GrowthRecord,
  type TimelineResponse,
  type UpdateRecordInput,
} from '@baby-mp/contracts'

import { PrismaService } from '../database/prisma.service'
import { MediaService } from '../media/media.service'
import { naturalDateInTimeZone } from '../common/time/natural-date'
import type { Environment } from '../config/environment'
import type { CreateRecordDto, TimelineQueryDto, UpdateRecordDto } from './record.dto'

const CREATE_OPERATION = 'records.create'
const recordInclude = {
  measurement: true,
  creator: { select: { id: true, displayName: true } },
  media: { orderBy: { sortOrder: 'asc' as const }, include: { media: true } },
} satisfies Prisma.RecordInclude
type RecordWithDetails = Prisma.RecordGetPayload<{ include: typeof recordInclude }>

interface CursorValue {
  occurredAt: string
  id: string
  babyId: string
  type: string | null
  startAt: string | null
  endAt: string | null
}

@Injectable()
export class RecordsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MediaService) private readonly mediaService: MediaService,
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>,
  ) {}

  async list(userId: string, babyId: string, rawQuery: TimelineQueryDto): Promise<TimelineResponse> {
    const role = await this.requireMember(userId, babyId)
    const parsed = timelineQuerySchema.safeParse(rawQuery)
    if (!parsed.success) throw this.validationError(parsed.error)
    const query = parsed.data
    const cursor = query.cursor ? this.decodeCursor(query.cursor, {
      babyId,
      type: query.type ?? null,
      startAt: query.startAt ? new Date(query.startAt).toISOString() : null,
      endAt: query.endAt ? new Date(query.endAt).toISOString() : null,
    }) : null
    const records = await this.prisma.record.findMany({
      where: {
        babyId,
        deletedAt: null,
        ...(query.type ? { type: query.type as PrismaRecordType } : {}),
        ...(query.startAt || query.endAt ? {
          occurredAt: {
            ...(query.startAt ? { gte: new Date(query.startAt) } : {}),
            ...(query.endAt ? { lte: new Date(query.endAt) } : {}),
          },
        } : {}),
        ...(cursor ? {
          OR: [
            { occurredAt: { lt: new Date(cursor.occurredAt) } },
            { occurredAt: new Date(cursor.occurredAt), id: { lt: cursor.id } },
          ],
        } : {}),
      },
      include: recordInclude,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    })
    const hasMore = records.length > query.limit
    const page = records.slice(0, query.limit)
    const data = await Promise.all(page.map((record) => this.toRecord(record, userId, role)))
    const last = page.at(-1)
    return {
      data,
      meta: {
        nextCursor: hasMore && last ? this.encodeCursor({
          occurredAt: last.occurredAt.toISOString(),
          id: last.id,
          babyId,
          type: query.type ?? null,
          startAt: query.startAt ? new Date(query.startAt).toISOString() : null,
          endAt: query.endAt ? new Date(query.endAt).toISOString() : null,
        }) : null,
      },
    }
  }

  async create(userId: string, babyId: string, key: string, rawInput: CreateRecordDto): Promise<GrowthRecord> {
    this.assertIdempotencyKey(key)
    const parsed = createRecordInputSchema.safeParse(rawInput)
    if (!parsed.success) throw this.validationError(parsed.error)
    const input = parsed.data
    const requestHash = this.hash({ babyId, ...input })

    const execute = () => this.prisma.$transaction(async (tx) => {
      const membership = await this.activeMembership(tx, userId, babyId)
      if (!membership) throw new NotFoundException('资源不存在')
      if (membership.role === MemberRole.viewer) throw new ForbiddenException('当前角色不能创建记录')
      const existing = await tx.idempotencyKey.findUnique({
        where: { userId_operation_key: { userId, operation: CREATE_OPERATION, key } },
      })
      if (existing) return this.replayId(existing.requestHash, requestHash, existing.responseBody)
      this.validateOccurredAt(input.occurredAt, membership.baby.birthDate)
      await tx.idempotencyKey.create({
        data: {
          userId,
          operation: CREATE_OPERATION,
          key,
          requestHash,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      })
      await this.validateMedia(tx, babyId, userId, membership.role, input.mediaIds)
      const record = await tx.record.create({
        data: {
          babyId,
          type: input.type as PrismaRecordType,
          title: input.type === 'milestone' ? input.title.trim() : null,
          content: input.content?.trim() || null,
          occurredAt: new Date(input.occurredAt),
          createdBy: userId,
          updatedBy: userId,
          ...(input.type === 'measurement' ? {
            measurement: {
              create: {
                heightCm: input.measurement.heightCm,
                weightKg: input.measurement.weightKg,
              },
            },
          } : {}),
          ...(input.mediaIds.length ? {
            media: { create: input.mediaIds.map((mediaId, sortOrder) => ({ mediaId, sortOrder })) },
          } : {}),
        },
        select: { id: true },
      })
      await tx.idempotencyKey.update({
        where: { userId_operation_key: { userId, operation: CREATE_OPERATION, key } },
        data: { responseCode: 201, responseBody: { recordId: record.id } },
      })
      return record.id
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    let recordId: string | null = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        recordId = await execute()
        break
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
          const existing = await this.prisma.idempotencyKey.findUnique({
            where: { userId_operation_key: { userId, operation: CREATE_OPERATION, key } },
          })
          if (existing) {
            recordId = this.replayId(existing.requestHash, requestHash, existing.responseBody)
            break
          }
          if (error.code === 'P2034' && attempt < 2) continue
          throw new ConflictException({ code: 'CONFLICT', message: '请求冲突，请重试' })
        }
        throw error
      }
    }
    if (!recordId) throw new ConflictException({ code: 'CONFLICT', message: '请求冲突，请重试' })
    return this.get(userId, recordId)
  }

  async get(userId: string, recordId: string): Promise<GrowthRecord> {
    const record = await this.prisma.record.findFirst({
      where: { id: recordId, deletedAt: null },
      include: recordInclude,
    })
    if (!record) throw new NotFoundException('资源不存在')
    const role = await this.requireMember(userId, record.babyId)
    return this.toRecord(record, userId, role)
  }

  async update(userId: string, recordId: string, rawInput: UpdateRecordDto): Promise<GrowthRecord> {
    const parsed = updateRecordInputSchema.safeParse(rawInput)
    if (!parsed.success) throw this.validationError(parsed.error)
    const input = parsed.data
    await this.prisma.$transaction(async (tx) => {
      const record = await tx.record.findFirst({ where: { id: recordId, deletedAt: null } })
      if (!record) throw new NotFoundException('资源不存在')
      const membership = await this.activeMembership(tx, userId, record.babyId)
      if (!membership) throw new NotFoundException('资源不存在')
      this.assertCanManage(membership.role, record.createdBy, userId)
      this.validateUpdateForType(record.type, input)
      if (input.occurredAt) this.validateOccurredAt(input.occurredAt, membership.baby.birthDate)
      if (input.mediaIds) await this.validateMedia(tx, record.babyId, userId, membership.role, input.mediaIds)

      const nextTitle = input.title !== undefined ? input.title?.trim() || null : record.title
      const nextContent = input.content !== undefined ? input.content?.trim() || null : record.content
      const nextMediaCount = input.mediaIds?.length ?? await tx.recordMedia.count({ where: { recordId } })
      if (record.type === PrismaRecordType.milestone && !nextTitle) {
        throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '里程碑标题不能为空' })
      }
      if (record.type === PrismaRecordType.note && !nextContent && nextMediaCount === 0) {
        throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '图文记录必须包含正文或图片' })
      }
      if (record.type === PrismaRecordType.measurement && nextContent && nextContent.length > 500) {
        throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '测量备注不能超过 500 字' })
      }

      const result = await tx.record.updateMany({
        where: { id: recordId, deletedAt: null, version: input.version },
        data: {
          ...(input.title !== undefined ? { title: nextTitle } : {}),
          ...(input.content !== undefined ? { content: nextContent } : {}),
          ...(input.occurredAt ? { occurredAt: new Date(input.occurredAt) } : {}),
          updatedBy: userId,
          version: { increment: 1 },
        },
      })
      if (result.count !== 1) throw this.versionConflict()

      if (input.measurement) {
        await tx.measurementRecord.update({
          where: { recordId },
          data: { heightCm: input.measurement.heightCm, weightKg: input.measurement.weightKg },
        })
      }
      if (input.mediaIds) {
        await tx.recordMedia.deleteMany({ where: { recordId } })
        if (input.mediaIds.length) {
          await tx.recordMedia.createMany({
            data: input.mediaIds.map((mediaId, sortOrder) => ({ recordId, mediaId, sortOrder })),
          })
        }
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return this.get(userId, recordId)
  }

  async remove(userId: string, recordId: string, version: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const record = await tx.record.findFirst({ where: { id: recordId, deletedAt: null } })
      if (!record) throw new NotFoundException('资源不存在')
      const membership = await this.activeMembership(tx, userId, record.babyId)
      if (!membership) throw new NotFoundException('资源不存在')
      this.assertCanManage(membership.role, record.createdBy, userId)
      const result = await tx.record.updateMany({
        where: { id: recordId, deletedAt: null, version },
        data: { deletedAt: new Date(), deletedBy: userId, updatedBy: userId, version: { increment: 1 } },
      })
      if (result.count !== 1) throw this.versionConflict()
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  }

  private validateUpdateForType(type: PrismaRecordType, input: UpdateRecordInput): void {
    if (type !== PrismaRecordType.measurement && input.measurement !== undefined) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '该记录类型不支持测量数据' })
    }
    if (type !== PrismaRecordType.milestone && input.title !== undefined) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '该记录类型不支持标题' })
    }
  }

  private async validateMedia(
    tx: Prisma.TransactionClient,
    babyId: string,
    userId: string,
    role: MemberRole,
    mediaIds: string[],
  ): Promise<void> {
    if (new Set(mediaIds).size !== mediaIds.length) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '图片不能重复关联' })
    }
    if (!mediaIds.length) return
    const count = await tx.media.count({
      where: {
        id: { in: mediaIds },
        babyId,
        status: MediaStatus.ready,
        deletedAt: null,
        ...(role === MemberRole.admin ? {} : { ownerUserId: userId }),
      },
    })
    if (count !== mediaIds.length) throw new NotFoundException('资源不存在')
  }

  private async toRecord(record: RecordWithDetails, userId: string, role: MemberRole): Promise<GrowthRecord> {
    const canManage = role === MemberRole.admin || (role === MemberRole.editor && record.createdBy === userId)
    const media = await Promise.all(record.media.map(async (link) => ({
      id: link.media.id,
      mimeType: link.media.mimeType,
      width: link.media.width,
      height: link.media.height,
      sizeBytes: Number(link.media.sizeBytes),
      status: link.media.status,
      accessUrl: await this.mediaService.accessUrlFor(link.media),
      sortOrder: link.sortOrder,
    })))
    return {
      id: record.id,
      babyId: record.babyId,
      type: record.type,
      title: record.title,
      content: record.content,
      occurredAt: record.occurredAt.toISOString(),
      measurement: record.measurement ? {
        heightCm: record.measurement.heightCm === null ? null : Number(record.measurement.heightCm),
        weightKg: record.measurement.weightKg === null ? null : Number(record.measurement.weightKg),
      } : null,
      media,
      createdBy: { id: record.creator.id, displayName: record.creator.displayName, avatarUrl: null },
      permissions: { canEdit: canManage, canDelete: canManage },
      version: record.version,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    }
  }

  private async requireMember(userId: string, babyId: string): Promise<MemberRole> {
    const membership = await this.activeMembership(this.prisma, userId, babyId)
    if (!membership) throw new NotFoundException('资源不存在')
    return membership.role
  }

  private activeMembership(client: Prisma.TransactionClient | PrismaService, userId: string, babyId: string) {
    return client.babyMember.findFirst({
      where: { userId, babyId, status: MemberStatus.active, baby: { deletedAt: null } },
      select: { role: true, baby: { select: { birthDate: true } } },
    })
  }

  private assertCanManage(role: MemberRole, creatorId: string, userId: string): void {
    if (role === MemberRole.admin) return
    if (role === MemberRole.editor && creatorId === userId) return
    throw new ForbiddenException('当前角色不能修改这条记录')
  }

  private validateOccurredAt(value: string, birthDate: Date): void {
    const occurredAt = new Date(value)
    const timeZone = this.config.get('BUSINESS_TIME_ZONE', { infer: true })
    const occurredNaturalDate = naturalDateInTimeZone(occurredAt, timeZone)
    const birthNaturalDate = birthDate.toISOString().slice(0, 10)
    if (occurredNaturalDate < birthNaturalDate) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '记录时间不能早于宝宝出生日期',
        details: [{ field: 'occurredAt', reason: '不能早于宝宝出生日期' }],
      })
    }
    if (occurredAt.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '记录时间不能晚于当前时间',
        details: [{ field: 'occurredAt', reason: '不能超过当前时间 5 分钟' }],
      })
    }
  }

  private assertIdempotencyKey(key: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Idempotency-Key 必须是 UUID' })
    }
  }

  private replayId(storedHash: string, requestHash: string, body: Prisma.JsonValue | null): string {
    if (storedHash !== requestHash) {
      throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: '幂等键已用于不同请求' })
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || !('recordId' in body) || typeof body.recordId !== 'string') {
      throw new ConflictException({ code: 'CONFLICT', message: '请求正在处理中，请稍后重试' })
    }
    return body.recordId
  }

  private hash(input: CreateRecordInput & { babyId: string }): string {
    return createHash('sha256').update(this.stableJson(input)).digest('hex')
  }

  private stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.stableJson(item)).join(',')}]`
    if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>
      return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${this.stableJson(object[key])}`).join(',')}}`
    }
    return JSON.stringify(value)
  }

  private encodeCursor(cursor: CursorValue): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
  }

  private decodeCursor(
    value: string,
    context: Pick<CursorValue, 'babyId' | 'type' | 'startAt' | 'endAt'>,
  ): CursorValue {
    try {
      const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<CursorValue>
      if (
        typeof cursor.occurredAt !== 'string' || Number.isNaN(new Date(cursor.occurredAt).getTime()) ||
        typeof cursor.id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor.id) ||
        cursor.babyId !== context.babyId || cursor.type !== context.type ||
        cursor.startAt !== context.startAt || cursor.endAt !== context.endAt
      ) throw new Error('invalid')
      return {
        occurredAt: new Date(cursor.occurredAt).toISOString(),
        id: cursor.id,
        babyId: context.babyId,
        type: context.type,
        startAt: context.startAt,
        endAt: context.endAt,
      }
    } catch {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '分页游标无效' })
    }
  }

  private validationError(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): BadRequestException {
    return new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: '提交内容有误',
      details: error.issues.map((issue) => ({ field: issue.path.join('.'), reason: issue.message })),
    })
  }

  private versionConflict(): ConflictException {
    return new ConflictException({ code: 'VERSION_CONFLICT', message: '内容已被其他成员更新，请刷新后重试' })
  }
}
