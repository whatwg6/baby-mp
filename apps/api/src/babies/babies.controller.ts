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
  ApiNoContentResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'

import type { Baby, SuccessResponse } from '@baby-mp/contracts'

import { AuthenticationGuard } from '../auth/authentication.guard'
import { ApiErrorResponseDto } from '../auth/auth.dto'
import type { RequestWithContext } from '../common/http/request-context'
import { BabyMemberGuard } from '../families/authorization/baby-member.guard'
import { RequireBabyRoles } from '../families/authorization/required-baby-roles.decorator'
import { BabyListResponseDto, BabyResponseDto, CreateBabyDto, UpdateBabyDto } from './baby.dto'
import { BabiesService } from './babies.service'

@ApiTags('babies')
@ApiBearerAuth()
@Controller('babies')
export class BabiesController {
  constructor(@Inject(BabiesService) private readonly babies: BabiesService) {}

  @Get()
  @ApiOkResponse({ description: 'All babies with an active membership.', type: BabyListResponseDto })
  @ApiUnauthorizedResponse({ description: 'Access token is missing or invalid.', type: ApiErrorResponseDto })
  @UseGuards(AuthenticationGuard)
  async list(@Req() request: RequestWithContext): Promise<SuccessResponse<Baby[]>> {
    return { data: await this.babies.list(request.user!.id) }
  }

  @Post()
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'UUID identifying this create operation.',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({ type: CreateBabyDto })
  @ApiCreatedResponse({ description: 'Baby and admin membership created atomically.', type: BabyResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid baby or idempotency key.', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Access token is missing or invalid.', type: ApiErrorResponseDto })
  @ApiConflictResponse({ description: 'Idempotency key was reused with a different request.', type: ApiErrorResponseDto })
  @UseGuards(AuthenticationGuard)
  async create(
    @Req() request: RequestWithContext,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: CreateBabyDto,
  ): Promise<SuccessResponse<Baby>> {
    return { data: await this.babies.create(request.user!.id, idempotencyKey, body) }
  }

  @Get(':babyId')
  @ApiParam({ name: 'babyId', type: String, format: 'uuid', description: 'Baby identifier.' })
  @ApiOkResponse({ description: 'Baby visible to the current member.', type: BabyResponseDto })
  @ApiBadRequestResponse({ description: 'Baby identifier is not a UUID.', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Access token is missing or invalid.', type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ description: 'Baby does not exist or is not visible.', type: ApiErrorResponseDto })
  @UseGuards(AuthenticationGuard, BabyMemberGuard)
  async get(
    @Req() request: RequestWithContext,
    @Param('babyId', ParseUUIDPipe) babyId: string,
  ): Promise<SuccessResponse<Baby>> {
    return { data: await this.babies.get(request.user!.id, babyId) }
  }

  @Patch(':babyId')
  @ApiParam({ name: 'babyId', type: String, format: 'uuid', description: 'Baby identifier.' })
  @ApiBody({ type: UpdateBabyDto })
  @ApiOkResponse({ description: 'Updated baby.', type: BabyResponseDto })
  @ApiBadRequestResponse({ description: 'Baby identifier or update input is invalid.', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Access token is missing or invalid.', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'Only an active admin may update the baby.', type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ description: 'Baby does not exist or is not visible.', type: ApiErrorResponseDto })
  @ApiConflictResponse({ description: 'The supplied optimistic version is stale.', type: ApiErrorResponseDto })
  @RequireBabyRoles('admin')
  @UseGuards(AuthenticationGuard, BabyMemberGuard)
  async update(
    @Req() request: RequestWithContext,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Body() body: UpdateBabyDto,
  ): Promise<SuccessResponse<Baby>> {
    return { data: await this.babies.update(request.user!.id, babyId, body) }
  }

  @Delete(':babyId')
  @ApiParam({ name: 'babyId', type: String, format: 'uuid', description: 'Baby identifier.' })
  @ApiNoContentResponse({ description: 'Baby access stopped and soft deletion scheduled.' })
  @ApiBadRequestResponse({ description: 'Baby identifier is not a UUID.', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Access token is missing or invalid.', type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ description: 'Baby does not exist, is not visible, or caller is not an admin.', type: ApiErrorResponseDto })
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireBabyRoles('admin')
  @UseGuards(AuthenticationGuard, BabyMemberGuard)
  async remove(
    @Req() request: RequestWithContext,
    @Param('babyId', ParseUUIDPipe) babyId: string,
  ): Promise<void> {
    await this.babies.remove(request.user!.id, babyId, request.requestId)
  }

}
