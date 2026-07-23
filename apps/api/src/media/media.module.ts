import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { MediaController } from './media.controller'
import { MediaService } from './media.service'
import { S3StorageService } from './s3-storage.service'

@Module({
  imports: [AuthModule],
  controllers: [MediaController],
  providers: [MediaService, S3StorageService],
  exports: [MediaService, S3StorageService],
})
export class MediaModule {}
