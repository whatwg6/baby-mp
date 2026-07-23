import { Body, Controller, Inject, Patch, Req, UseGuards } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'

import type { SuccessResponse, UserSummary } from '@baby-mp/contracts'

import { AuthenticationGuard } from '../auth/authentication.guard'
import { ApiErrorResponseDto } from '../auth/auth.dto'
import type { RequestWithContext } from '../common/http/request-context'
import { UpdateCurrentUserDto, UserSummaryResponseDto } from './user.dto'
import { UsersService } from './users.service'

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Patch('me')
  @ApiBody({ type: UpdateCurrentUserDto })
  @ApiOkResponse({ description: 'Updated current user summary.', type: UserSummaryResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid display name.', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Access token is missing or invalid.', type: ApiErrorResponseDto })
  @UseGuards(AuthenticationGuard)
  async updateMe(
    @Req() request: RequestWithContext,
    @Body() body: UpdateCurrentUserDto,
  ): Promise<SuccessResponse<UserSummary>> {
    return { data: await this.users.updateCurrentUser(request.user!.id, body) }
  }
}
