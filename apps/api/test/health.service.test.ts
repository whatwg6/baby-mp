import { ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import { OperationalMetricsService } from '../src/common/observability/operational-metrics.service'
import { HealthService } from '../src/health/health.service'

function healthService(overrides?: {
  database?: Promise<unknown>
  storage?: Promise<void>
  heartbeats?: Array<{ lastSuccessAt: Date | null; lastFailureAt: Date | null }>
}) {
  const now = Date.now()
  const prisma = {
    $queryRaw: vi.fn(
      () => overrides?.database ?? Promise.resolve([{ '?column?': 1 }]),
    ),
    exportJob: {
      groupBy: vi.fn().mockResolvedValue([
        { status: 'pending', _count: { _all: 2 } },
        { status: 'processing', _count: { _all: 1 } },
      ]),
      findFirst: vi
        .fn()
        .mockResolvedValue({ createdAt: new Date(Date.now() - 10_000) }),
    },
    workerHeartbeat: {
      findMany: vi.fn(async (query: {
        where: { workerName: string }
      }) => {
        if (overrides?.heartbeats) return overrides.heartbeats
        const isExport = query.where.workerName === 'export-worker'
        return [{
          lastSuccessAt: new Date(now - (isExport ? 5_000 : 7_000)),
          lastFailureAt: new Date(now - (isExport ? 9_000 : 11_000)),
        }]
      }),
    },
  }
  const storage = {
    checkBucketReachable: vi.fn(
      () => overrides?.storage ?? Promise.resolve(),
    ),
  }
  return {
    prisma,
    service: new HealthService(
      prisma as never,
      storage as never,
      new OperationalMetricsService(),
      { get: vi.fn(() => 3_600) } as never,
    ),
  }
}

describe('HealthService', () => {
  it('reports ready only when database and private bucket are reachable', async () => {
    await expect(healthService().service.readiness()).resolves.toEqual({
      data: { status: 'ready' },
    })
  })

  it('returns a generic unavailable response when a dependency fails', async () => {
    const { service } = healthService({
      storage: Promise.reject(new Error('secret endpoint details')),
    })
    await expect(service.readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
  })

  it('returns only aggregate API, queue, and worker metrics', async () => {
    const { prisma, service } = healthService()
    const result = await service.operationalMetrics()
    expect(result.data.exportQueue).toMatchObject({
      pending: 2,
      processing: 1,
      failed: 0,
    })
    expect(result.data.exportWorker.lastSuccessAgeSeconds).toBeGreaterThanOrEqual(4)
    expect(result.data.exportWorker.lastSuccessAgeSeconds).toBeLessThanOrEqual(6)
    expect(result.data.exportWorker.lastFailureAgeSeconds).toBeGreaterThanOrEqual(8)
    expect(result.data.exportWorker.lastFailureAgeSeconds).toBeLessThanOrEqual(10)
    expect(result.data.mediaCleanup.lastSuccessAgeSeconds).toBeGreaterThanOrEqual(6)
    expect(result.data.mediaCleanup.lastSuccessAgeSeconds).toBeLessThanOrEqual(8)
    expect(result.data.mediaCleanup.lastFailureAgeSeconds).toBeGreaterThanOrEqual(10)
    expect(result.data.mediaCleanup.lastFailureAgeSeconds).toBeLessThanOrEqual(12)
    expect(result.data.exportWorker).toMatchObject({ activeInstances: 1, unhealthyInstances: 0 })
    expect(result.data.mediaCleanup).toMatchObject({ activeInstances: 1, unhealthyInstances: 0 })
    expect(prisma.workerHeartbeat.findMany).toHaveBeenCalledWith({
      where: { workerName: 'media-cleanup', stoppedAt: null },
      select: { lastSuccessAt: true, lastFailureAt: true },
    })
    expect(JSON.stringify(result)).not.toMatch(/babyId|objectKey|token/)
  })

  it('does not let one healthy worker instance hide another unresolved failure', async () => {
    const reference = new Date()
    const { service } = healthService({
      heartbeats: [
        { lastSuccessAt: reference, lastFailureAt: null },
        {
          lastSuccessAt: new Date(reference.getTime() - 5_000),
          lastFailureAt: new Date(reference.getTime() - 1_000),
        },
      ],
    })
    const result = await service.operationalMetrics()
    expect(result.data.exportWorker).toMatchObject({
      activeInstances: 2,
      unhealthyInstances: 1,
    })
  })
})
