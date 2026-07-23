import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { OperationalMetricsService } from '../common/observability/operational-metrics.service'
import type { Environment } from '../config/environment'
import { PrismaService } from '../database/prisma.service'
import { S3StorageService } from '../media/s3-storage.service'

interface WorkerHeartbeatMetrics {
  activeInstances: number
  unhealthyInstances: number
  lastSuccessAt: string | null
  lastSuccessAgeSeconds: number | null
  lastFailureAt: string | null
  lastFailureAgeSeconds: number | null
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3StorageService) private readonly storage: S3StorageService,
    @Inject(OperationalMetricsService)
    private readonly metrics: OperationalMetricsService,
    @Inject(ConfigService)
    private readonly config: ConfigService<Environment, true>,
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
      exportWorker: WorkerHeartbeatMetrics
      mediaCleanup: WorkerHeartbeatMetrics
    }
  }> {
    const [counts, oldest, exportWorker, mediaCleanup] = await Promise.all([
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
      this.workerHeartbeatMetrics('export-worker', 60),
      this.workerHeartbeatMetrics(
        'media-cleanup',
        this.config.get('MEDIA_CLEANUP_INTERVAL_SECONDS', { infer: true }) + 300,
      ),
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
        exportWorker,
        mediaCleanup,
      },
    }
  }

  private async workerHeartbeatMetrics(
    workerName: string,
    maximumSuccessAgeSeconds: number,
  ): Promise<WorkerHeartbeatMetrics> {
    const instances = await this.prisma.workerHeartbeat.findMany({
      where: { workerName, stoppedAt: null },
      select: {
        lastSuccessAt: true,
        lastFailureAt: true,
      },
    })
    const latest = (values: Array<Date | null>): Date | null =>
      values.reduce<Date | null>(
        (current, value) => value && (!current || value > current) ? value : current,
        null,
      )
    const lastSuccessAt = latest(instances.map((instance) => instance.lastSuccessAt))
    const lastFailureAt = latest(instances.map((instance) => instance.lastFailureAt))
    const unhealthyInstances = instances.filter((instance) => {
      const successAge = this.ageSeconds(instance.lastSuccessAt)
      return successAge === null || successAge > maximumSuccessAgeSeconds ||
        Boolean(instance.lastFailureAt && (!instance.lastSuccessAt || instance.lastFailureAt > instance.lastSuccessAt))
    }).length
    return {
      activeInstances: instances.length,
      unhealthyInstances,
      lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
      lastSuccessAgeSeconds: this.ageSeconds(lastSuccessAt),
      lastFailureAt: lastFailureAt?.toISOString() ?? null,
      lastFailureAgeSeconds: this.ageSeconds(lastFailureAt),
    }
  }

  private ageSeconds(value: Date | null): number | null {
    return value
      ? Math.max(0, Math.floor((Date.now() - value.getTime()) / 1_000))
      : null
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
