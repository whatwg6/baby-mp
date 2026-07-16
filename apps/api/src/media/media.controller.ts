import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Get,
  Req,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger'

import type { Media, MediaUploadResponse, SuccessResponse } from '@baby-mp/contracts'

import { AuthenticationGuard } from '../auth/authentication.guard'
import { ApiErrorResponseDto } from '../auth/auth.dto'
import type { RequestWithContext } from '../common/http/request-context'
import {
  CompleteMediaUploadDto,
  CreateMediaUploadDto,
  MediaResponseDto,
  MediaUploadResponseDto,
} from './media.dto'
import { MediaService } from './media.service'

@ApiTags('media')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthenticationGuard)
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  @Post('babies/:babyId/media/uploads')
  @ApiParam({ name: 'babyId', format: 'uuid' })
  @ApiBody({ type: CreateMediaUploadDto })
  @ApiCreatedResponse({ type: MediaUploadResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiPayloadTooLargeResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async createUpload(
    @Req() request: RequestWithContext,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Body() body: CreateMediaUploadDto,
  ): Promise<MediaUploadResponse> {
    return { data: await this.media.createUpload(request.user!.id, babyId, body) }
  }

  @Post('media/:mediaId/complete')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'mediaId', format: 'uuid' })
  @ApiBody({ type: CompleteMediaUploadDto })
  @ApiOkResponse({ type: MediaResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  async complete(
    @Req() request: RequestWithContext,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Body() body: CompleteMediaUploadDto,
  ): Promise<SuccessResponse<Media>> {
    return { data: await this.media.complete(request.user!.id, mediaId, body) }
  }

  @Get('media/:mediaId')
  @ApiParam({ name: 'mediaId', format: 'uuid' })
  @ApiOkResponse({ type: MediaResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async get(
    @Req() request: RequestWithContext,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ): Promise<SuccessResponse<Media>> {
    return { data: await this.media.get(request.user!.id, mediaId) }
  }

  @Delete('media/:mediaId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'mediaId', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async abandon(
    @Req() request: RequestWithContext,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ): Promise<void> {
    await this.media.abandon(request.user!.id, mediaId)
  }
}
