import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  DataRightsRequestStatus,
  DataRightsRequestType,
  MemberStatus,
  Prisma,
  type DataRightsRequest as PrismaDataRightsRequest,
} from '@prisma/client'

import type {
  CreateDataRightsRequestInput,
  DataRightsRequest,
} from '@baby-mp/contracts'
import { createDataRightsRequestInputSchema } from '@baby-mp/contracts'

import { PrismaService } from '../database/prisma.service'

export type DataRightsOperatorTargetStatus = 'processing' | 'completed' | 'rejected'

@Injectable()
export class DataRightsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<DataRightsRequest[]> {
    const requests = await this.prisma.dataRightsRequest.findMany({
      where: { requesterUserId: userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    return requests.map((request) => this.toResponse(request))
  }

  async create(
    userId: string,
    rawInput: CreateDataRightsRequestInput,
    requestId?: string,
  ): Promise<DataRightsRequest> {
    const parsed = createDataRightsRequestInputSchema.safeParse(rawInput)
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '申请范围无效',
      })
    }

    const input = {
      type: parsed.data.type as DataRightsRequestType,
      babyId: parsed.data.babyId ?? null,
    }
    const activeRequestKey = this.activeRequestKey(userId, input.type, input.babyId)

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (input.babyId) await this.requireCurrentMembership(tx, userId, input.babyId)

        const duplicate = await tx.dataRightsRequest.findUnique({
          where: { activeRequestKey },
        })
        if (duplicate?.requesterUserId === userId) return this.toResponse(duplicate)

        const created = await tx.dataRightsRequest.create({
          data: {
            requesterUserId: userId,
            babyId: input.babyId,
            type: input.type,
            status: DataRightsRequestStatus.pending,
            activeRequestKey,
          },
        })
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            babyId: input.babyId,
            action: 'data_rights.request.created',
            resourceType: 'data_rights_request',
            resourceId: created.id,
            requestId,
            metadata: { type: input.type, scope: input.babyId ? 'baby' : 'account' },
          },
        })
        return this.toResponse(created)
      })
    } catch (error) {
      if (!this.isUniqueConflict(error)) throw error
      return this.prisma.$transaction(async (tx) => {
        if (input.babyId) await this.requireCurrentMembership(tx, userId, input.babyId)
        const duplicate = await tx.dataRightsRequest.findUnique({
          where: { activeRequestKey },
        })
        if (!duplicate || duplicate.requesterUserId !== userId) throw error
        return this.toResponse(duplicate)
      })
    }
  }

  async cancel(
    userId: string,
    requestIdToCancel: string,
    requestId?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.dataRightsRequest.findFirst({
        where: { id: requestIdToCancel, requesterUserId: userId },
      })
      if (!existing) throw new NotFoundException('资源不存在')
      if (existing.status !== DataRightsRequestStatus.pending) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: '仅待处理申请可以取消',
        })
      }

      const resolvedAt = new Date()
      const cancelled = await tx.dataRightsRequest.updateMany({
        where: {
          id: requestIdToCancel,
          requesterUserId: userId,
          status: DataRightsRequestStatus.pending,
        },
        data: {
          status: DataRightsRequestStatus.cancelled,
          activeRequestKey: null,
          resolvedAt,
        },
      })
      if (cancelled.count !== 1) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: '申请状态已变化，请刷新后重试',
        })
      }
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          babyId: existing.babyId,
          action: 'data_rights.request.cancelled',
          resourceType: 'data_rights_request',
          resourceId: existing.id,
          requestId,
          metadata: { type: existing.type, scope: existing.babyId ? 'baby' : 'account' },
        },
      })
    })
  }

  async transitionByOperator(
    requestIdToTransition: string,
    targetStatus: DataRightsOperatorTargetStatus,
    requestId?: string,
  ): Promise<DataRightsRequest> {
    const allowedTargets = new Set<DataRightsRequestStatus>([
      DataRightsRequestStatus.processing,
      DataRightsRequestStatus.completed,
      DataRightsRequestStatus.rejected,
    ])
    if (!allowedTargets.has(targetStatus)) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '不支持的数据权利申请状态',
      })
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.dataRightsRequest.findUnique({
        where: { id: requestIdToTransition },
      })
      if (!existing) throw new NotFoundException('资源不存在')

      const transitionAllowed =
        existing.status === DataRightsRequestStatus.pending ||
        (existing.status === DataRightsRequestStatus.processing &&
          targetStatus !== DataRightsRequestStatus.processing)
      if (!transitionAllowed) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: '申请状态不允许该操作',
        })
      }

      const terminal = targetStatus === DataRightsRequestStatus.completed ||
        targetStatus === DataRightsRequestStatus.rejected
      const changed = await tx.dataRightsRequest.updateMany({
        where: { id: existing.id, status: existing.status },
        data: {
          status: targetStatus,
          ...(terminal ? { activeRequestKey: null, resolvedAt: new Date() } : {}),
        },
      })
      if (changed.count !== 1) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: '申请状态已变化，请重新检查',
        })
      }

      const updated = await tx.dataRightsRequest.findUniqueOrThrow({
        where: { id: existing.id },
      })
      await tx.auditLog.create({
        data: {
          actorUserId: null,
          babyId: existing.babyId,
          action: 'data_rights.request.status_changed',
          resourceType: 'data_rights_request',
          resourceId: existing.id,
          requestId,
          metadata: { from: existing.status, to: targetStatus },
        },
      })
      return this.toResponse(updated)
    })
  }

  private async requireCurrentMembership(
    tx: Prisma.TransactionClient,
    userId: string,
    babyId: string,
  ): Promise<void> {
    const member = await tx.babyMember.findFirst({
      where: {
        userId,
        babyId,
        status: MemberStatus.active,
        baby: { deletedAt: null },
      },
      select: { id: true },
    })
    if (!member) throw new NotFoundException('资源不存在')
  }

  private activeRequestKey(
    userId: string,
    type: DataRightsRequestType,
    babyId: string | null,
  ): string {
    return `${userId}:${type}:${babyId ?? 'account'}`
  }

  private isUniqueConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  }

  private toResponse(request: PrismaDataRightsRequest): DataRightsRequest {
    return {
      id: request.id,
      type: request.type,
      status: request.status,
      babyId: request.babyId,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      resolvedAt: request.resolvedAt?.toISOString() ?? null,
    }
  }
}
