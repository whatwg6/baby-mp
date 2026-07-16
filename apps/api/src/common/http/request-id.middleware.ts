import { randomUUID } from 'node:crypto'

import { Injectable, type NestMiddleware } from '@nestjs/common'
import type { NextFunction, Response } from 'express'

import {
  REQUEST_ID_HEADER,
  type RequestWithContext,
} from './request-context'

const allowedRequestId = /^[A-Za-z0-9._:-]{1,128}$/

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestWithContext, response: Response, next: NextFunction): void {
    const suppliedRequestId = request.header(REQUEST_ID_HEADER)
    request.requestId =
      suppliedRequestId && allowedRequestId.test(suppliedRequestId)
        ? suppliedRequestId
        : `req_${randomUUID()}`

    response.setHeader(REQUEST_ID_HEADER, request.requestId)
    next()
  }
}
