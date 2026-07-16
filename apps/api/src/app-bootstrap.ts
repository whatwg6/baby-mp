import { Logger, ValidationPipe, type INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module'
import type { Environment } from './config/environment'
import { setupOpenApi } from './openapi/openapi'

export async function createApiApplication(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  const config = app.get(ConfigService<Environment, true>)

  app.useLogger(new Logger())
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  )
  app.enableCors({
    credentials: true,
    origin: config
      .get('CORS_ORIGINS', { infer: true })
      .split(',')
      .map((origin) => origin.trim()),
  })
  setupOpenApi(app)

  return app
}
