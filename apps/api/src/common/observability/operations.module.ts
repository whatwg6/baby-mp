import { Global, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'

import { OperationalMetricsService } from './operational-metrics.service'
import { RateLimitGuard } from '../security/rate-limit.guard'

@Global()
@Module({
  providers: [
    OperationalMetricsService,
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [OperationalMetricsService],
})
export class OperationsModule {}
