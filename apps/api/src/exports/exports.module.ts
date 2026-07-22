import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { MediaModule } from '../media/media.module'
import { ExportsController } from './exports.controller'
import { ExportWorker } from './exports.worker'
import { ExportsService } from './exports.service'

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [ExportsController],
  providers: [ExportsService, ExportWorker],
  exports: [ExportsService, ExportWorker],
})
export class ExportsModule {}
