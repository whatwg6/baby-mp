import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'

import { ApiExceptionFilter } from './common/http/api-exception.filter'
import { RequestLoggingInterceptor } from './common/http/request-logging.interceptor'
import { OperationsModule } from './common/observability/operations.module'
import { validateEnvironment } from './config/environment'
import { AuthModule } from './auth/auth.module'
import { BabiesModule } from './babies/babies.module'
import { DatabaseModule } from './database/database.module'
import { DataRightsModule } from './data-rights/data-rights.module'
import { FamiliesModule } from './families/families.module'
import { ExportsModule } from './exports/exports.module'
import { HealthModule } from './health/health.module'
import { GrowthModule } from './growth/growth.module'
import { MediaModule } from './media/media.module'
import { RecordsModule } from './records/records.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    OperationsModule,
    AuthModule,
    BabiesModule,
    DataRightsModule,
    FamiliesModule,
    ExportsModule,
    MediaModule,
    RecordsModule,
    GrowthModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
})
export class AppModule {}
