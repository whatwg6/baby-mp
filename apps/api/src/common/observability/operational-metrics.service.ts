import { Injectable } from '@nestjs/common'

interface RouteMetrics {
  count: number
  durationMs: number
  errors5xx: number
}

@Injectable()
export class OperationalMetricsService {
  private readonly startedAt = new Date()
  private readonly routes = new Map<string, RouteMetrics>()
  private rateLimited = 0

  recordRateLimited(): void {
    this.rateLimited += 1
  }

  recordRequest(
    method: string,
    route: string,
    statusCode: number,
    durationMs: number,
  ): void {
    const key = `${method} ${route}`
    const value = this.routes.get(key) ?? {
      count: 0,
      durationMs: 0,
      errors5xx: 0,
    }
    value.count += 1
    value.durationMs += durationMs
    if (statusCode >= 500) value.errors5xx += 1
    this.routes.set(key, value)
  }

  snapshot(): {
    startedAt: string
    uptimeSeconds: number
    rateLimited: number
    routes: Array<{
      method: string
      route: string
      requests: number
      errors5xx: number
      averageDurationMs: number
    }>
  } {
    return {
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      rateLimited: this.rateLimited,
      routes: [...this.routes.entries()].map(([key, value]) => {
        const separator = key.indexOf(' ')
        return {
          method: key.slice(0, separator),
          route: key.slice(separator + 1),
          requests: value.count,
          errors5xx: value.errors5xx,
          averageDurationMs:
            Math.round((value.durationMs / value.count) * 100) / 100,
        }
      }),
    }
  }
}
