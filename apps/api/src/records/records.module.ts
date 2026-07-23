import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { MediaModule } from '../media/media.module'
import { RecordsController } from './records.controller'
import { RecordsService } from './records.service'

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [RecordsController],
  providers: [RecordsService],
  exports: [RecordsService],
})
export class RecordsModule {}
