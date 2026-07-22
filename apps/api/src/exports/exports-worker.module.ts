import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { validateEnvironment } from '../config/environment'
import { DatabaseModule } from '../database/database.module'
import { ExportsModule } from './exports.module'

@Module({
  imports: [
    ConfigModule.forRoot({ cache: true, isGlobal: true, validate: validateEnvironment }),
    DatabaseModule,
    ExportsModule,
  ],
})
export class ExportsWorkerModule {}
