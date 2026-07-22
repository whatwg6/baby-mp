import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
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
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'

import type { Record as GrowthRecord, SuccessResponse, TimelineResponse } from '@baby-mp/contracts'

import { AuthenticationGuard } from '../auth/authentication.guard'
import { ApiErrorResponseDto } from '../auth/auth.dto'
import type { RequestWithContext } from '../common/http/request-context'
import {
  CreateRecordDto,
  DeleteRecordQueryDto,
  RecordResponseDto,
  TimelineQueryDto,
  TimelineResponseDto,
  UpdateRecordDto,
} from './record.dto'
import { RecordsService } from './records.service'

@ApiTags('records')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthenticationGuard)
export class RecordsController {
  constructor(@Inject(RecordsService) private readonly records: RecordsService) {}

  @Get('babies/:babyId/records')
  @ApiParam({ name: 'babyId', format: 'uuid' })
  @ApiOkResponse({ type: TimelineResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async list(
    @Req() request: RequestWithContext,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Query() query: TimelineQueryDto,
  ): Promise<TimelineResponse> {
    return this.records.list(request.user!.id, babyId, query)
  }

  @Post('babies/:babyId/records')
  @ApiParam({ name: 'babyId', format: 'uuid' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({ type: CreateRecordDto })
  @ApiCreatedResponse({ type: RecordResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  async create(
    @Req() request: RequestWithContext,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Headers('idempotency-key') key: string,
    @Body() body: CreateRecordDto,
  ): Promise<SuccessResponse<GrowthRecord>> {
    return { data: await this.records.create(request.user!.id, babyId, key, body) }
  }

  @Get('records/:recordId')
  @ApiParam({ name: 'recordId', format: 'uuid' })
  @ApiOkResponse({ type: RecordResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async get(
    @Req() request: RequestWithContext,
    @Param('recordId', ParseUUIDPipe) recordId: string,
  ): Promise<SuccessResponse<GrowthRecord>> {
    return { data: await this.records.get(request.user!.id, recordId) }
  }

  @Patch('records/:recordId')
  @ApiParam({ name: 'recordId', format: 'uuid' })
  @ApiBody({ type: UpdateRecordDto })
  @ApiOkResponse({ type: RecordResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  async update(
    @Req() request: RequestWithContext,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Body() body: UpdateRecordDto,
  ): Promise<SuccessResponse<GrowthRecord>> {
    return { data: await this.records.update(request.user!.id, recordId, body) }
  }

  @Delete('records/:recordId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'recordId', format: 'uuid' })
  @ApiQuery({ name: 'version', required: true, type: Number, minimum: 1 })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  async remove(
    @Req() request: RequestWithContext,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Query() query: DeleteRecordQueryDto,
  ): Promise<void> {
    await this.records.remove(request.user!.id, recordId, query.version)
  }
}
