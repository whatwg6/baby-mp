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
import { routeTemplateFrom } from './route-template'

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
    const status = this.statusForException(exception)
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
      const internal = this.internalErrorDetails(exception)
      this.logger.error(
        JSON.stringify({
          level: 'error',
          message: 'request_failed',
          module: ApiExceptionFilter.name,
          requestId,
          method: request.method,
          route: routeTemplateFrom(request),
          statusCode: status,
          errorCode: exceptionBody.code ?? errorCodeForStatus(status),
          ...internal,
        }),
      )
    }

    response.status(status).json(errorResponse)
  }

  private internalErrorDetails(exception: unknown): {
    errorType: string
  } {
    if (!exception || typeof exception !== 'object') {
      return { errorType: 'UnknownError' }
    }
    const rawName = 'name' in exception && typeof exception.name === 'string'
      ? exception.name
      : 'Error'
    const name = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(rawName)
      ? rawName
      : 'Error'
    return { errorType: name }
  }

  private statusForException(exception: unknown): number {
    if (exception instanceof HttpException) return exception.getStatus()
    if (!exception || typeof exception !== 'object') {
      return HttpStatus.INTERNAL_SERVER_ERROR
    }
    const parserType =
      'type' in exception && typeof exception.type === 'string'
        ? exception.type
        : undefined
    if (parserType === 'entity.too.large') return HttpStatus.PAYLOAD_TOO_LARGE
    if (parserType === 'entity.parse.failed') return HttpStatus.BAD_REQUEST
    return HttpStatus.INTERNAL_SERVER_ERROR
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
    if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
      return '请求内容过大'
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
