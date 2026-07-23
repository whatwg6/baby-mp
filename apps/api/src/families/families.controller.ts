import {
  BadRequestException,
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

import type {
  AcceptedInvite,
  CreatedFamilyInvite,
  FamilyInvite,
  FamilyMember,
  InvitePreview,
  SuccessResponse,
} from '@baby-mp/contracts'

import { ApiErrorResponseDto } from '../auth/auth.dto'
import { AuthenticationGuard } from '../auth/authentication.guard'
import { requestIdFrom, type RequestWithContext } from '../common/http/request-context'
import { RateLimit } from '../common/security/rate-limit.decorator'
import {
  AcceptedInviteSuccessResponseDto,
  CreateFamilyInviteDto,
  CreatedFamilyInviteResponseDto,
  DeleteFamilyMemberQueryDto,
  FamilyInviteListResponseDto,
  FamilyMemberListResponseDto,
  FamilyMemberResponseDto,
  InvitePreviewResponseDto,
  InviteTokenDto,
  UpdateFamilyMemberDto,
} from './family.dto'
import { FamiliesService } from './families.service'

@ApiTags('families')
@Controller()
export class FamiliesController {
  constructor(@Inject(FamiliesService) private readonly families: FamiliesService) {}

  @Get('babies/:babyId/members')
  @ApiBearerAuth()
  @ApiParam({ name: 'babyId', format: 'uuid' })
  @ApiOkResponse({ type: FamilyMemberListResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @UseGuards(AuthenticationGuard)
  async listMembers(@Req() request: RequestWithContext, @Param('babyId', ParseUUIDPipe) babyId: string): Promise<SuccessResponse<FamilyMember[]>> {
    return { data: await this.families.listMembers(request.user!.id, babyId) }
  }

  @Post('babies/:babyId/invites')
  @RateLimit('invite')
  @ApiBearerAuth()
  @ApiParam({ name: 'babyId', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiBody({ type: CreateFamilyInviteDto })
  @ApiCreatedResponse({ type: CreatedFamilyInviteResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @UseGuards(AuthenticationGuard)
  async createInvite(
    @Req() request: RequestWithContext,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Headers('idempotency-key') key: string,
    @Body() body: CreateFamilyInviteDto,
  ): Promise<SuccessResponse<CreatedFamilyInvite>> {
    return { data: await this.families.createInvite(request.user!.id, babyId, key, body, requestIdFrom(request)) }
  }

  @Get('babies/:babyId/invites')
  @ApiBearerAuth()
  @ApiParam({ name: 'babyId', format: 'uuid' })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'accepted', 'revoked', 'expired'] })
  @ApiOkResponse({ type: FamilyInviteListResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @UseGuards(AuthenticationGuard)
  async listInvites(
    @Req() request: RequestWithContext,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Query('status') status?: string,
  ): Promise<SuccessResponse<FamilyInvite[]>> {
    if (status && !['pending', 'accepted', 'revoked', 'expired'].includes(status)) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '邀请状态无效' })
    }
    return { data: await this.families.listInvites(request.user!.id, babyId, status) }
  }

  @Post('invites/preview')
  @RateLimit('invite')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: InviteTokenDto })
  @ApiOkResponse({ type: InvitePreviewResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async preview(@Body() body: InviteTokenDto): Promise<SuccessResponse<InvitePreview>> {
    return { data: await this.families.preview(body.token) }
  }

  @Post('invites/accept')
  @RateLimit('invite')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiBody({ type: InviteTokenDto })
  @ApiOkResponse({ type: AcceptedInviteSuccessResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @UseGuards(AuthenticationGuard)
  async accept(
    @Req() request: RequestWithContext,
    @Headers('idempotency-key') key: string,
    @Body() body: InviteTokenDto,
  ): Promise<SuccessResponse<AcceptedInvite>> {
    return { data: await this.families.acceptInvite(request.user!.id, key, body.token, requestIdFrom(request)) }
  }

  @Delete('babies/:babyId/invites/:inviteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiParam({ name: 'babyId', format: 'uuid' })
  @ApiParam({ name: 'inviteId', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @UseGuards(AuthenticationGuard)
  async revoke(
    @Req() request: RequestWithContext,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
  ): Promise<void> {
    await this.families.revokeInvite(request.user!.id, babyId, inviteId, requestIdFrom(request))
  }

  @Patch('babies/:babyId/members/:memberId')
  @ApiBearerAuth()
  @ApiParam({ name: 'babyId', format: 'uuid' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiBody({ type: UpdateFamilyMemberDto })
  @ApiOkResponse({ type: FamilyMemberResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @UseGuards(AuthenticationGuard)
  async updateMember(
    @Req() request: RequestWithContext,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() body: UpdateFamilyMemberDto,
  ): Promise<SuccessResponse<FamilyMember>> {
    return { data: await this.families.updateMember(request.user!.id, babyId, memberId, body, requestIdFrom(request)) }
  }

  @Delete('babies/:babyId/members/:memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiParam({ name: 'babyId', format: 'uuid' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiQuery({ name: 'version', required: true, type: Number, minimum: 1 })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @UseGuards(AuthenticationGuard)
  async removeMember(
    @Req() request: RequestWithContext,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Query() query: DeleteFamilyMemberQueryDto,
  ): Promise<void> {
    await this.families.removeMember(request.user!.id, babyId, memberId, query.version, requestIdFrom(request))
  }

  @Delete('babies/:babyId/membership')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiParam({ name: 'babyId', format: 'uuid' })
  @ApiQuery({ name: 'version', required: true, type: Number, minimum: 1 })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @UseGuards(AuthenticationGuard)
  async leaveFamily(
    @Req() request: RequestWithContext,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Query() query: DeleteFamilyMemberQueryDto,
  ): Promise<void> {
    await this.families.leaveFamily(request.user!.id, babyId, query.version, requestIdFrom(request))
  }
}
