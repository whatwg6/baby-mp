import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Response } from 'express'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'

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

    const logCompletion = (statusCode: number) => {
        this.logger.log(
          JSON.stringify({
            level: 'info',
            message: 'request_completed',
            environment: this.config.get('APP_ENV', { infer: true }),
            module: context.getClass().name,
            requestId: requestIdFrom(request),
            method: request.method,
            path: request.path,
            statusCode,
            durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
          }),
        )
    }

    return next.handle().pipe(
      tap({
        complete: () => logCompletion(response.statusCode),
        error: (error: unknown) =>
          logCompletion(error instanceof HttpException ? error.getStatus() : 500),
      }),
    )
  }
}
