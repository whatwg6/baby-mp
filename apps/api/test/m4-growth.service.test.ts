import { BadRequestException, NotFoundException } from '@nestjs/common'
import { MemberStatus, Prisma, RecordType } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

import { growthResponseSchema } from '@baby-mp/contracts'

import type { PrismaService } from '../src/database/prisma.service'
import { GrowthService } from '../src/growth/growth.service'

const userId = '11111111-1111-4111-8111-111111111111'
const babyId = '22222222-2222-4222-8222-222222222222'

function service(prisma: object) {
  return new GrowthService(prisma as PrismaService)
}

function point(id: string, occurredAt: string, values: { heightCm?: string | null; weightKg?: string | null }) {
  return {
    id,
    occurredAt: new Date(occurredAt),
    measurement: {
      heightCm: values.heightCm == null ? null : new Prisma.Decimal(values.heightCm),
      weightKg: values.weightKg == null ? null : new Prisma.Decimal(values.weightKg),
    },
  }
}

describe('M4 GrowthService', () => {
  it('keeps metric and unit aligned in the shared runtime contract', () => {
    expect(growthResponseSchema.safeParse({
      data: { metric: 'height', unit: 'kg', points: [] },
    }).success).toBe(false)
    expect(growthResponseSchema.safeParse({
      data: { metric: 'height', unit: 'cm', points: [] },
    }).success).toBe(true)
  })

  it('returns height points only, preserving stable ascending measurement order and precision', async () => {
    const findMany = vi.fn(async () => [
      point('33333333-3333-4333-8333-333333333333', '2025-12-31T23:00:00.000Z', { heightCm: '68.20' }),
      point('44444444-4444-4444-8444-444444444444', '2026-01-01T08:00:00.000Z', { heightCm: '69.25' }),
    ])
    const prisma = {
      babyMember: { findFirst: vi.fn(async () => ({ id: 'membership' })) },
      record: { findMany },
    }
    const result = await service(prisma).measurements(userId, babyId, { metric: 'height' })

    expect(result).toEqual({
      metric: 'height',
      unit: 'cm',
      points: [
        { recordId: '33333333-3333-4333-8333-333333333333', occurredAt: '2025-12-31T23:00:00.000Z', value: 68.2 },
        { recordId: '44444444-4444-4444-8444-444444444444', occurredAt: '2026-01-01T08:00:00.000Z', value: 69.25 },
      ],
    })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        babyId,
        type: RecordType.measurement,
        deletedAt: null,
        measurement: { is: { heightCm: { not: null } } },
      }),
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    }))
  })

  it('queries weight and applies inclusive time boundaries', async () => {
    const findMany = vi.fn(async () => [
      point('55555555-5555-4555-8555-555555555555', '2026-03-01T00:00:00.000Z', { weightKg: '7.850' }),
    ])
    const prisma = {
      babyMember: { findFirst: vi.fn(async () => ({ id: 'membership' })) },
      record: { findMany },
    }
    const result = await service(prisma).measurements(userId, babyId, {
      metric: 'weight',
      startAt: '2026-01-01T00:00:00.000Z',
      endAt: '2026-12-31T23:59:59.999Z',
    })

    expect(result.unit).toBe('kg')
    expect(result.points[0]?.value).toBe(7.85)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      occurredAt: {
        gte: new Date('2026-01-01T00:00:00.000Z'),
        lte: new Date('2026-12-31T23:59:59.999Z'),
      },
      measurement: { is: { weightKg: { not: null } } },
    }) }))
  })

  it('keeps every same-time point and supports a 500 point result without sampling the API', async () => {
    const rows = Array.from({ length: 500 }, (_, index) => point(
      `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
      '2026-01-01T08:00:00.000Z',
      { heightCm: String(60 + index / 100) },
    ))
    const prisma = {
      babyMember: { findFirst: vi.fn(async () => ({ id: 'membership' })) },
      record: { findMany: vi.fn(async () => rows) },
    }
    const result = await service(prisma).measurements(userId, babyId, { metric: 'height' })
    expect(result.points).toHaveLength(500)
    expect(new Set(result.points.map((item) => item.recordId))).toHaveLength(500)
  })

  it('rejects invalid ranges before database access', async () => {
    const prisma = { babyMember: { findFirst: vi.fn() }, record: { findMany: vi.fn() } }
    await expect(service(prisma).measurements(userId, babyId, {
      metric: 'height',
      startAt: '2026-02-01T00:00:00.000Z',
      endAt: '2026-01-01T00:00:00.000Z',
    })).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.babyMember.findFirst).not.toHaveBeenCalled()
    expect(prisma.record.findMany).not.toHaveBeenCalled()
  })

  it('rechecks active membership and returns a non-disclosing 404 after removal', async () => {
    const prisma = {
      babyMember: { findFirst: vi.fn(async () => null) },
      record: { findMany: vi.fn() },
    }
    await expect(service(prisma).measurements(userId, babyId, { metric: 'height' }))
      .rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.babyMember.findFirst).toHaveBeenCalledWith({
      where: { userId, babyId, status: MemberStatus.active, baby: { deletedAt: null } },
      select: { id: true },
    })
    expect(prisma.record.findMany).not.toHaveBeenCalled()
  })
})
