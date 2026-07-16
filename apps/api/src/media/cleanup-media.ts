import { NestFactory } from '@nestjs/core'

import { AppModule } from '../app.module'
import { MediaService } from './media.service'

async function cleanup(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  try {
    const cleaned = await app.get(MediaService).cleanupOrphans()
    process.stdout.write(`${cleaned}\n`)
  } finally {
    await app.close()
  }
}

void cleanup()
