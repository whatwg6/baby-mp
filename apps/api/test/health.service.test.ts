import { ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import { OperationalMetricsService } from '../src/common/observability/operational-metrics.service'
import { HealthService } from '../src/health/health.service'

function healthService(overrides?: {
  database?: Promise<unknown>
  storage?: Promise<void>
}) {
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
  }
  const storage = {
    checkBucketReachable: vi.fn(
      () => overrides?.storage ?? Promise.resolve(),
    ),
  }
  return new HealthService(
    prisma as never,
    storage as never,
    new OperationalMetricsService(),
  )
}

describe('HealthService', () => {
  it('reports ready only when database and private bucket are reachable', async () => {
    await expect(healthService().readiness()).resolves.toEqual({
      data: { status: 'ready' },
    })
  })

  it('returns a generic unavailable response when a dependency fails', async () => {
    const service = healthService({
      storage: Promise.reject(new Error('secret endpoint details')),
    })
    await expect(service.readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
  })

  it('returns only aggregate API and export queue metrics', async () => {
    const result = await healthService().operationalMetrics()
    expect(result.data.exportQueue).toMatchObject({
      pending: 2,
      processing: 1,
      failed: 0,
    })
    expect(JSON.stringify(result)).not.toMatch(/babyId|objectKey|token/)
  })
})
