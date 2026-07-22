import { Logger, ValidationPipe, type INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'

import { AppModule } from './app.module'
import { RequestIdMiddleware } from './common/http/request-id.middleware'
import {
  INTERNAL_TOKEN_HEADER,
  matchesInternalToken,
} from './common/security/internal-token'
import { SecurityHeadersMiddleware } from './common/security/security-headers.middleware'
import type { Environment } from './config/environment'
import { setupOpenApi } from './openapi/openapi'

type MiddlewareRequest = Parameters<RequestIdMiddleware['use']>[0]
type MiddlewareResponse = Parameters<RequestIdMiddleware['use']>[1]
type MiddlewareNext = Parameters<RequestIdMiddleware['use']>[2]

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
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    bufferLogs: true,
  })
  const config = app.get(ConfigService<Environment, true>)

  app.useLogger(new Logger())
  const express = app.getHttpAdapter().getInstance() as {
    set(name: string, value: boolean | string | string[]): void
  }
  const configuredTrustProxy = config.get('TRUST_PROXY', { infer: true })
  express.set(
    'trust proxy',
    configuredTrustProxy === 'false'
      ? false
      : configuredTrustProxy.includes(',')
        ? configuredTrustProxy.split(',').map((value) => value.trim())
        : configuredTrustProxy,
  )
  const securityHeaders = new SecurityHeadersMiddleware(config)
  const requestIds = new RequestIdMiddleware()
  app.use((
    request: MiddlewareRequest,
    response: MiddlewareResponse,
    next: MiddlewareNext,
  ) => {
    securityHeaders.use(request, response, () => {
      requestIds.use(request, response, next)
    })
  })
  app.useBodyParser('json', {
    limit: config.get('JSON_BODY_LIMIT_BYTES', { infer: true }),
    strict: true,
  })
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
  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    if (appEnvironment === 'staging' || appEnvironment === 'production') {
      const expectedToken = config.get('INTERNAL_MONITORING_TOKEN', {
        infer: true,
      })
      const protectDocumentation = (
        request: MiddlewareRequest,
        response: MiddlewareResponse,
        next: MiddlewareNext,
      ) => {
        const suppliedToken = request.header(INTERNAL_TOKEN_HEADER)
        if (!matchesInternalToken(suppliedToken, expectedToken)) {
          response.status(404).end()
          return
        }
        next()
      }
      app.use('/api/docs', protectDocumentation)
      app.use('/api/docs-json', protectDocumentation)
      app.use('/api/docs-yaml', protectDocumentation)
    }
    setupOpenApi(app)
  }

  return app
}
