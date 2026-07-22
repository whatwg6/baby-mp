import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'

import type { ExportDownload, ExportJob, ExportListResponse, SuccessResponse } from '@baby-mp/contracts'

import { ApiErrorResponseDto } from '../auth/auth.dto'
import { AuthenticationGuard } from '../auth/authentication.guard'
import { requestIdFrom, type RequestWithContext } from '../common/http/request-context'
import {
  CreateExportDto,
  ExportDownloadResponseDto,
  ExportListQueryDto,
  ExportListResponseDto,
  ExportResponseDto,
} from './export.dto'
import { ExportsService } from './exports.service'

@ApiTags('exports')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthenticationGuard)
export class ExportsController {
  constructor(@Inject(ExportsService) private readonly exports: ExportsService) {}

  @Post('babies/:babyId/exports')
  @ApiParam({ name: 'babyId', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiBody({ type: CreateExportDto })
  @ApiCreatedResponse({ type: ExportResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: ApiErrorResponseDto })
  async create(
    @Req() request: RequestWithContext,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Headers('idempotency-key') key: string,
    @Body() body: CreateExportDto,
  ): Promise<SuccessResponse<ExportJob>> {
    return { data: await this.exports.create(request.user!.id, babyId, key, body, requestIdFrom(request)) }
  }

  @Get('babies/:babyId/exports')
  @ApiParam({ name: 'babyId', format: 'uuid' })
  @ApiOkResponse({ type: ExportListResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async list(
    @Req() request: RequestWithContext,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Query() query: ExportListQueryDto,
  ): Promise<ExportListResponse> {
    return this.exports.list(request.user!.id, babyId, query)
  }

  @Get('exports/:exportId')
  @ApiParam({ name: 'exportId', format: 'uuid' })
  @ApiOkResponse({ type: ExportResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async get(
    @Req() request: RequestWithContext,
    @Param('exportId', ParseUUIDPipe) exportId: string,
  ): Promise<SuccessResponse<ExportJob>> {
    return { data: await this.exports.get(request.user!.id, exportId) }
  }

  @Post('exports/:exportId/download-url')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'exportId', format: 'uuid' })
  @ApiOkResponse({ type: ExportDownloadResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  async downloadUrl(
    @Req() request: RequestWithContext,
    @Param('exportId', ParseUUIDPipe) exportId: string,
  ): Promise<ExportDownload> {
    return { data: await this.exports.createDownloadUrl(request.user!.id, exportId, requestIdFrom(request)) }
  }
}
