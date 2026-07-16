import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common'
import type { Response } from 'express'

import type { ApiErrorCode, ApiErrorDetail, ErrorResponse } from '@baby-mp/contracts'

import { errorCodeForStatus } from './http-error-code'
import { requestIdFrom, type RequestWithContext } from './request-context'

interface HttpExceptionBody {
  code?: ApiErrorCode
  message?: string | string[]
  details?: ApiErrorDetail[]
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const request = http.getRequest<RequestWithContext>()
    const response = http.getResponse<Response>()
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR
    const exceptionBody = this.exceptionBody(exception)
    const requestId = requestIdFrom(request)
    const details = exceptionBody.details ?? this.validationDetails(exceptionBody.message)
    const errorResponse: ErrorResponse = {
      error: {
        code: exceptionBody.code ?? errorCodeForStatus(status),
        message: this.publicMessage(status, exceptionBody.message),
        requestId,
        ...(details ? { details } : {}),
      },
    }

    if (status >= 500) {
      this.logger.error(
        JSON.stringify({
          level: 'error',
          message: 'request_failed',
          module: ApiExceptionFilter.name,
          requestId,
          method: request.method,
          path: request.path,
          statusCode: status,
        }),
      )
    }

    response.status(status).json(errorResponse)
  }

  private exceptionBody(exception: unknown): HttpExceptionBody {
    if (!(exception instanceof HttpException)) {
      return {}
    }

    const response = exception.getResponse()
    if (typeof response === 'string') {
      return { message: response }
    }
    return response as HttpExceptionBody
  }

  private publicMessage(status: number, message: string | string[] | undefined): string {
    if (status >= 500) {
      return '服务暂时不可用'
    }
    if (Array.isArray(message)) {
      return status === HttpStatus.BAD_REQUEST ? '提交内容有误' : message[0] ?? '请求失败'
    }
    return message ?? '请求失败'
  }

  private validationDetails(message: string | string[] | undefined): ApiErrorDetail[] | undefined {
    if (!Array.isArray(message)) {
      return undefined
    }
    return message.map((reason) => ({ reason }))
  }
}
