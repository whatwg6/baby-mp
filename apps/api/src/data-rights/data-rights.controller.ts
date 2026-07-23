import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'

import type { DataRightsRequest, SuccessResponse } from '@baby-mp/contracts'

import { ApiErrorResponseDto } from '../auth/auth.dto'
import { AuthenticationGuard } from '../auth/authentication.guard'
import { requestIdFrom, type RequestWithContext } from '../common/http/request-context'
import {
  CreateDataRightsRequestDto,
  DataRightsRequestListResponseDto,
  DataRightsRequestResponseDto,
} from './data-rights.dto'
import { DataRightsService } from './data-rights.service'

@ApiTags('data-rights')
@ApiBearerAuth()
@UseGuards(AuthenticationGuard)
@Controller('me/data-rights-requests')
export class DataRightsController {
  constructor(
    @Inject(DataRightsService) private readonly dataRights: DataRightsService,
  ) {}

  @Get()
  @ApiOkResponse({ type: DataRightsRequestListResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  async list(
    @Req() request: RequestWithContext,
  ): Promise<SuccessResponse<DataRightsRequest[]>> {
    return { data: await this.dataRights.list(request.user!.id) }
  }

  @Post()
  @ApiBody({ type: CreateDataRightsRequestDto })
  @ApiCreatedResponse({ type: DataRightsRequestResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  async create(
    @Req() request: RequestWithContext,
    @Body() body: CreateDataRightsRequestDto,
  ): Promise<SuccessResponse<DataRightsRequest>> {
    return {
      data: await this.dataRights.create(
        request.user!.id,
        body,
        requestIdFrom(request),
      ),
    }
  }

  @Delete(':requestId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'requestId', type: String, format: 'uuid' })
  @ApiNoContentResponse()
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  async cancel(
    @Req() request: RequestWithContext,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ): Promise<void> {
    await this.dataRights.cancel(
      request.user!.id,
      requestId,
      requestIdFrom(request),
    )
  }
}
