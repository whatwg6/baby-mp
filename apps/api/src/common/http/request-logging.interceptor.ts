import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Response } from 'express'
import { Observable } from 'rxjs'
import { finalize } from 'rxjs/operators'

import type { Environment } from '../../config/environment'
import { requestIdFrom, type RequestWithContext } from './request-context'

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestLoggingInterceptor.name)

  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<Environment, true>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startedAt = performance.now()
    const http = context.switchToHttp()
    const request = http.getRequest<RequestWithContext>()
    const response = http.getResponse<Response>()

    return next.handle().pipe(
      finalize(() => {
        this.logger.log(
          JSON.stringify({
            level: 'info',
            message: 'request_completed',
            environment: this.config.get('APP_ENV', { infer: true }),
            module: context.getClass().name,
            requestId: requestIdFrom(request),
            method: request.method,
            path: request.path,
            statusCode: response.statusCode,
            durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
          }),
        )
      }),
    )
  }
}
