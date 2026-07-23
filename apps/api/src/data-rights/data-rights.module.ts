import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { DataRightsController } from './data-rights.controller'
import { DataRightsService } from './data-rights.service'

@Module({
  imports: [AuthModule],
  controllers: [DataRightsController],
  providers: [DataRightsService],
})
export class DataRightsModule {}
