import { Inject, Injectable, type NestMiddleware } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { NextFunction, Response } from 'express'

import type { Environment } from '../../config/environment'
import type { RequestWithContext } from '../http/request-context'

const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'"
const SWAGGER_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
].join('; ')

function isSwaggerUiPath(path: string): boolean {
  return path === '/api/docs' || path.startsWith('/api/docs/')
}

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<Environment, true>,
  ) {}

  use(request: RequestWithContext, response: Response, next: NextFunction): void {
    response.setHeader(
      'Content-Security-Policy',
      isSwaggerUiPath(request.path)
        ? SWAGGER_CONTENT_SECURITY_POLICY
        : API_CONTENT_SECURITY_POLICY,
    )
    response.setHeader('Cross-Origin-Resource-Policy', 'same-site')
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Cache-Control', 'no-store')
    if (
      ['staging', 'production'].includes(
        this.config.get('APP_ENV', { infer: true }),
      )
    ) {
      response.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      )
    }
    next()
  }
}
