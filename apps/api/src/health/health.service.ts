import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common'

import { OperationalMetricsService } from '../common/observability/operational-metrics.service'
import { PrismaService } from '../database/prisma.service'
import { S3StorageService } from '../media/s3-storage.service'

@Injectable()
export class HealthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3StorageService) private readonly storage: S3StorageService,
    @Inject(OperationalMetricsService)
    private readonly metrics: OperationalMetricsService,
  ) {}

  async readiness(): Promise<{ data: { status: 'ready' } }> {
    const checks = await Promise.allSettled([
      this.withTimeout(this.prisma.$queryRaw`SELECT 1`, 2_000),
      this.withTimeout(this.storage.checkBucketReachable(), 2_000),
    ])
    if (checks.some((check) => check.status === 'rejected')) {
      throw new ServiceUnavailableException({
        code: 'INTERNAL_ERROR',
        message: '服务依赖尚未就绪',
      })
    }
    return { data: { status: 'ready' } }
  }

  async operationalMetrics(): Promise<{
    data: {
      api: ReturnType<OperationalMetricsService['snapshot']>
      exportQueue: {
        pending: number
        processing: number
        failed: number
        oldestPendingAgeSeconds: number | null
      }
    }
  }> {
    const [counts, oldest] = await Promise.all([
      this.prisma.exportJob.groupBy({
        by: ['status'],
        where: { status: { in: ['pending', 'processing', 'failed'] } },
        _count: { _all: true },
      }),
      this.prisma.exportJob.findFirst({
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ])
    const count = (status: 'pending' | 'processing' | 'failed') =>
      counts.find((entry) => entry.status === status)?._count._all ?? 0

    return {
      data: {
        api: this.metrics.snapshot(),
        exportQueue: {
          pending: count('pending'),
          processing: count('processing'),
          failed: count('failed'),
          oldestPendingAgeSeconds: oldest
            ? Math.max(
                0,
                Math.floor((Date.now() - oldest.createdAt.getTime()) / 1_000),
              )
            : null,
        },
      },
    }
  }

  private async withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
    let timeout: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Dependency check timed out')),
            timeoutMs,
          )
          timeout.unref()
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }
}
