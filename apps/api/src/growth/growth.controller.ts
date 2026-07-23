import { Controller, Get, Inject, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'

import type { GrowthResponse } from '@baby-mp/contracts'

import { AuthenticationGuard } from '../auth/authentication.guard'
import { ApiErrorResponseDto } from '../auth/auth.dto'
import type { RequestWithContext } from '../common/http/request-context'
import { GrowthQueryDto, GrowthResponseDto } from './growth.dto'
import { GrowthService } from './growth.service'

@ApiTags('growth')
@ApiBearerAuth()
@Controller('babies/:babyId/growth')
@UseGuards(AuthenticationGuard)
export class GrowthController {
  constructor(@Inject(GrowthService) private readonly growth: GrowthService) {}

  @Get('measurements')
  @ApiParam({ name: 'babyId', type: String, format: 'uuid' })
  @ApiOkResponse({ type: GrowthResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  async measurements(
    @Req() request: RequestWithContext,
    @Param('babyId', ParseUUIDPipe) babyId: string,
    @Query() query: GrowthQueryDto,
  ): Promise<GrowthResponse> {
    return { data: await this.growth.measurements(request.user!.id, babyId, query) }
  }
}
