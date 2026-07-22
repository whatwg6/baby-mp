import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { MemberStatus, RecordType } from '@prisma/client'

import {
  growthQuerySchema,
  type GrowthQuery,
  type GrowthSeries,
} from '@baby-mp/contracts'

import { PrismaService } from '../database/prisma.service'
import type { GrowthQueryDto } from './growth.dto'

@Injectable()
export class GrowthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async measurements(userId: string, babyId: string, rawQuery: GrowthQueryDto): Promise<GrowthSeries> {
    const parsed = growthQuerySchema.safeParse(rawQuery)
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '成长数据查询参数无效',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'query',
          reason: issue.message,
        })),
      })
    }
    const membership = await this.prisma.babyMember.findFirst({
      where: {
        userId,
        babyId,
        status: MemberStatus.active,
        baby: { deletedAt: null },
      },
      select: { id: true },
    })
    if (!membership) throw new NotFoundException('资源不存在')

    return this.querySeries(babyId, parsed.data)
  }

  private async querySeries(babyId: string, query: GrowthQuery): Promise<GrowthSeries> {
    const field = query.metric === 'height' ? 'heightCm' : 'weightKg'
    const rows = await this.prisma.record.findMany({
      where: {
        babyId,
        type: RecordType.measurement,
        deletedAt: null,
        ...(query.startAt || query.endAt ? {
          occurredAt: {
            ...(query.startAt ? { gte: new Date(query.startAt) } : {}),
            ...(query.endAt ? { lte: new Date(query.endAt) } : {}),
          },
        } : {}),
        measurement: { is: { [field]: { not: null } } },
      },
      select: {
        id: true,
        occurredAt: true,
        measurement: { select: { [field]: true } },
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    })

    return {
      metric: query.metric,
      unit: query.metric === 'height' ? 'cm' : 'kg',
      points: rows.flatMap((row) => {
        const value = row.measurement?.[field]
        return value == null ? [] : [{
          recordId: row.id,
          occurredAt: row.occurredAt.toISOString(),
          value: Number(value),
        }]
      }),
    }
  }
}
