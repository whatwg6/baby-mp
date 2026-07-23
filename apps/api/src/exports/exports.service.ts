import { createHash } from 'node:crypto'

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  ExportStatus,
  MediaPurpose,
  MediaStatus,
  MemberRole,
  MemberStatus,
  Prisma,
  type ExportJob as PrismaExportJob,
} from '@prisma/client'

import {
  exportListQuerySchema,
  type ExportDownload,
  type ExportJob,
} from '@baby-mp/contracts'

import { PrismaService } from '../database/prisma.service'
import { S3StorageService } from '../media/s3-storage.service'
import type { CreateExportDto, ExportListQueryDto } from './export.dto'

const CREATE_EXPORT_OPERATION = 'exports.create'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CREATE_RATE_LIMIT_PER_HOUR = 3

interface ExportScope {
  version: 1
  format: 'zip'
  includeMedia: boolean
  representations: ['json', 'csv']
}

@Injectable()
export class ExportsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3StorageService) private readonly storage: S3StorageService,
  ) {}

  async create(
    userId: string,
    babyId: string,
    key: string,
    input: CreateExportDto,
    requestId?: string,
  ): Promise<ExportJob> {
    this.assertIdempotencyKey(key)
    const scope: ExportScope = {
      version: 1,
      format: 'zip',
      includeMedia: input.includeMedia,
      representations: ['json', 'csv'],
    }
    const requestHash = this.hash(JSON.stringify({ babyId, ...scope }))

    const execute = () => this.prisma.$transaction(async (tx) => {
      await this.requireAdmin(userId, babyId, tx)
      const existingKey = await tx.idempotencyKey.findUnique({
        where: { userId_operation_key: { userId, operation: CREATE_EXPORT_OPERATION, key } },
      })
      if (existingKey) {
        const exportId = this.replayId(existingKey.requestHash, requestHash, existingKey.responseBody)
        const job = await tx.exportJob.findUnique({ where: { id: exportId } })
        if (!job) throw new ConflictException({ code: 'CONFLICT', message: '导出任务状态异常' })
        return this.toExport(job)
      }

      const [active, recent] = await Promise.all([
        tx.exportJob.count({
          where: { requestedBy: userId, babyId, status: { in: [ExportStatus.pending, ExportStatus.processing] } },
        }),
        tx.exportJob.count({
          where: { requestedBy: userId, babyId, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
        }),
      ])
      if (active > 0 || recent >= CREATE_RATE_LIMIT_PER_HOUR) {
        throw new HttpException({ code: 'RATE_LIMITED', message: '导出任务创建过于频繁，请稍后再试' }, HttpStatus.TOO_MANY_REQUESTS)
      }

      await tx.idempotencyKey.create({
        data: {
          userId,
          operation: CREATE_EXPORT_OPERATION,
          key,
          requestHash,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      })
      const job = await tx.exportJob.create({
        data: { babyId, requestedBy: userId, scope: scope as unknown as Prisma.InputJsonValue },
      })
      await Promise.all([
        tx.idempotencyKey.update({
          where: { userId_operation_key: { userId, operation: CREATE_EXPORT_OPERATION, key } },
          data: { responseCode: 201, responseBody: { exportId: job.id } },
        }),
        tx.auditLog.create({
          data: {
            actorUserId: userId,
            babyId,
            action: 'export.created',
            resourceType: 'export_job',
            resourceId: job.id,
            requestId,
            metadata: { format: 'zip', includeMedia: input.includeMedia },
          },
        }),
      ])
      return this.toExport(job)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    return this.retryTransaction(execute)
  }

  async list(
    userId: string,
    babyId: string,
    query: ExportListQueryDto,
  ): Promise<{ data: ExportJob[]; meta: { nextCursor: string | null } }> {
    await this.requireAdmin(userId, babyId)
    const parsed = exportListQuerySchema.safeParse(query)
    if (!parsed.success) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '导出列表参数无效' })
    }
    const limit = parsed.data.limit
    const cursor = parsed.data.cursor ? this.decodeCursor(parsed.data.cursor) : undefined
    const jobs = await this.prisma.exportJob.findMany({
      where: {
        babyId,
        ...(cursor ? {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })
    const page = jobs.slice(0, limit)
    const last = page.at(-1)
    return {
      data: page.map((job) => this.toExport(job)),
      meta: {
        nextCursor: jobs.length > limit && last
          ? this.encodeCursor(last.createdAt, last.id)
          : null,
      },
    }
  }

  async get(userId: string, exportId: string): Promise<ExportJob> {
    const job = await this.findAuthorizedAdminJob(userId, exportId)
    return this.toExport(job)
  }

  async createDownloadUrl(
    userId: string,
    exportId: string,
    requestId?: string,
  ): Promise<ExportDownload['data']> {
    const job = await this.findAuthorizedAdminJob(userId, exportId, true)
    const now = new Date()
    if (job.status === ExportStatus.completed && job.expiresAt && job.expiresAt <= now) {
      await this.prisma.exportJob.updateMany({
        where: { id: job.id, status: ExportStatus.completed, expiresAt: { lte: now } },
        data: { status: ExportStatus.expired },
      })
      throw new ConflictException({ code: 'EXPORT_EXPIRED', message: '导出文件已过期，请重新创建' })
    }
    if (job.status === ExportStatus.expired) {
      throw new ConflictException({ code: 'EXPORT_EXPIRED', message: '导出文件已过期，请重新创建' })
    }
    if (
      job.status !== ExportStatus.completed ||
      !job.expiresAt ||
      !job.resultMedia ||
      job.resultMedia.purpose !== MediaPurpose.export_archive ||
      job.resultMedia.status !== MediaStatus.ready ||
      job.resultMedia.deletedAt
    ) {
      throw new ConflictException({ code: 'EXPORT_NOT_READY', message: '导出文件尚未准备好' })
    }
    if (!await this.storage.head(job.resultMedia.objectKey)) {
      throw new ConflictException({ code: 'EXPORT_NOT_READY', message: '导出文件暂不可用' })
    }
    const remainingSeconds = Math.floor((job.expiresAt.getTime() - now.getTime()) / 1000)
    if (remainingSeconds <= 0) {
      throw new ConflictException({ code: 'EXPORT_EXPIRED', message: '导出文件已过期，请重新创建' })
    }
    const ttlSeconds = Math.min(5 * 60, remainingSeconds)
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)
    const downloadUrl = await this.storage.createExportDownloadUrl(
      job.resultMedia.objectKey,
      job.id,
      ttlSeconds,
    )
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        babyId: job.babyId,
        action: 'export.download_url.issued',
        resourceType: 'export_job',
        resourceId: job.id,
        requestId,
        metadata: { format: 'zip', includeMedia: this.scope(job).includeMedia, ttlSeconds },
      },
    })
    return { downloadUrl, expiresAt: expiresAt.toISOString() }
  }

  private async findAuthorizedAdminJob(userId: string, exportId: string, includeResult = false) {
    const job = await this.prisma.exportJob.findUnique({
      where: { id: exportId },
      ...(includeResult ? { include: { resultMedia: true } } : {}),
    })
    if (!job) throw new NotFoundException('资源不存在')
    await this.requireAdmin(userId, job.babyId)
    return job as typeof job & { resultMedia?: {
      purpose: MediaPurpose
      status: MediaStatus
      deletedAt: Date | null
      objectKey: string
    } | null }
  }

  private async requireAdmin(
    userId: string,
    babyId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const member = await tx.babyMember.findFirst({
      where: { userId, babyId, status: MemberStatus.active, baby: { deletedAt: null } },
      select: { role: true },
    })
    if (!member) throw new NotFoundException('资源不存在')
    if (member.role !== MemberRole.admin) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: '仅管理员可以导出宝宝数据' })
    }
  }

  private toExport(job: PrismaExportJob): ExportJob {
    const scope = this.scope(job)
    const effectiveStatus = job.status === ExportStatus.completed && job.expiresAt && job.expiresAt <= new Date()
      ? ExportStatus.expired
      : job.status
    return {
      id: job.id,
      babyId: job.babyId,
      status: effectiveStatus,
      includeMedia: scope.includeMedia,
      format: scope.format,
      errorCode: job.errorCode,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
      expiresAt: job.expiresAt?.toISOString() ?? null,
      downloadUrl: null,
    }
  }

  private scope(job: Pick<PrismaExportJob, 'scope'>): ExportScope {
    const value = job.scope
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ConflictException({ code: 'CONFLICT', message: '导出范围状态异常' })
    }
    const scope = value as Record<string, Prisma.JsonValue>
    if (
      scope.version !== 1 || scope.format !== 'zip' || typeof scope.includeMedia !== 'boolean' ||
      !Array.isArray(scope.representations) || scope.representations.join(',') !== 'json,csv'
    ) {
      throw new ConflictException({ code: 'CONFLICT', message: '导出范围状态异常' })
    }
    return {
      version: 1,
      format: 'zip',
      includeMedia: scope.includeMedia,
      representations: ['json', 'csv'],
    }
  }

  private decodeCursor(value: string): { createdAt: Date; id: string } {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
      const createdAt = typeof parsed.createdAt === 'string' ? new Date(parsed.createdAt) : new Date(Number.NaN)
      if (!UUID_PATTERN.test(String(parsed.id)) || Number.isNaN(createdAt.getTime())) throw new Error()
      return { createdAt, id: String(parsed.id) }
    } catch {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '分页游标无效' })
    }
  }

  private encodeCursor(createdAt: Date, id: string): string {
    return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString('base64url')
  }

  private assertIdempotencyKey(key: string): void {
    if (!UUID_PATTERN.test(key)) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Idempotency-Key 必须是 UUID' })
    }
  }

  private replayId(storedHash: string, requestHash: string, body: Prisma.JsonValue | null): string {
    if (storedHash !== requestHash) {
      throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: '幂等键已用于不同请求' })
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ConflictException({ code: 'CONFLICT', message: '请求正在处理中，请稍后重试' })
    }
    const exportId = (body as Record<string, Prisma.JsonValue>).exportId
    if (typeof exportId !== 'string') {
      throw new ConflictException({ code: 'CONFLICT', message: '请求状态异常' })
    }
    return exportId
  }

  private hash(value: string): string { return createHash('sha256').update(value).digest('hex') }

  private async retryTransaction<T>(execute: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await execute() } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code) && attempt < 2) continue
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new HttpException({ code: 'RATE_LIMITED', message: '已有导出任务正在处理' }, HttpStatus.TOO_MANY_REQUESTS)
        }
        throw error
      }
    }
    throw new ConflictException({ code: 'CONFLICT', message: '请求冲突，请重试' })
  }
}
