import { Logger, ValidationPipe, type INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module'
import type { Environment } from './config/environment'
import { setupOpenApi } from './openapi/openapi'

const localHostnamePatterns = [
  /^localhost$/,
  /^127(?:\.\d{1,3}){3}$/,
  /^10(?:\.\d{1,3}){3}$/,
  /^192\.168(?:\.\d{1,3}){2}$/,
  /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/,
  /^\[::1\]$/,
]

export function isCorsOriginAllowed(
  origin: string | undefined,
  appEnvironment: Environment['APP_ENV'],
  configuredOrigins: readonly string[],
): boolean {
  if (!origin || configuredOrigins.includes(origin)) {
    return true
  }

  if (appEnvironment !== 'local') {
    return false
  }

  try {
    const url = new URL(origin)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      localHostnamePatterns.some((pattern) => pattern.test(url.hostname))
    )
  } catch {
    return false
  }
}

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
  const configuredOrigins = config
    .get('CORS_ORIGINS', { infer: true })
    .split(',')
    .map((origin) => origin.trim())
  const appEnvironment = config.get('APP_ENV', { infer: true })

  app.enableCors({
    credentials: true,
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      callback(null, isCorsOriginAllowed(origin, appEnvironment, configuredOrigins))
    },
  })
  setupOpenApi(app)

  return app
}
