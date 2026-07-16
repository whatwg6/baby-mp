import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, UseGuards } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'

import type { SuccessResponse } from '@baby-mp/contracts'

import type { RequestWithContext } from '../common/http/request-context'
import { AuthenticationGuard } from './authentication.guard'
import { AuthService } from './auth.service'
import {
  ApiErrorResponseDto,
  AuthSessionResponseDto,
  CurrentUserResponseDto,
  MockLoginDto,
  PlatformLoginDto,
  RefreshDto,
} from './auth.dto'

@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('auth/platform-login')
  @ApiBody({ type: PlatformLoginDto })
  @ApiCreatedResponse({ description: 'Authenticated session.', type: AuthSessionResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid platform or credential.', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Platform credential rejected.', type: ApiErrorResponseDto })
  async platformLogin(@Body() body: PlatformLoginDto): Promise<SuccessResponse<unknown>> {
    return { data: await this.auth.platformLogin(body.platform, body.code) }
  }

  @Post('auth/mock-login')
  @ApiBody({ type: MockLoginDto })
  @ApiCreatedResponse({ description: 'Authenticated local test session.', type: AuthSessionResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid mock login input.', type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ description: 'Mock login is disabled in this environment.', type: ApiErrorResponseDto })
  async mockLogin(@Body() body: MockLoginDto): Promise<SuccessResponse<unknown>> {
    return { data: await this.auth.mockLogin(body.mockUserKey, body.displayName) }
  }

  @Post('auth/refresh')
  @ApiBody({ type: RefreshDto })
  @ApiCreatedResponse({ description: 'Rotated authenticated session.', type: AuthSessionResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid refresh request.', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Refresh token is invalid, expired, or already rotated.', type: ApiErrorResponseDto })
  async refresh(@Body() body: RefreshDto): Promise<SuccessResponse<unknown>> {
    return { data: await this.auth.refresh(body.refreshToken) }
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBody({ type: RefreshDto })
  @ApiNoContentResponse({ description: 'Session revoked.' })
  @ApiBadRequestResponse({ description: 'Invalid logout request.', type: ApiErrorResponseDto })
  async logout(@Body() body: RefreshDto): Promise<void> {
    await this.auth.logout(body.refreshToken)
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'Current active user.', type: CurrentUserResponseDto })
  @ApiUnauthorizedResponse({ description: 'Access token is missing or invalid.', type: ApiErrorResponseDto })
  @UseGuards(AuthenticationGuard)
  async me(@Req() request: RequestWithContext): Promise<SuccessResponse<unknown>> {
    return { data: await this.auth.me(request.user!.id) }
  }
}
