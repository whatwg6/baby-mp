import {
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger'

import type { HealthResponse } from '@baby-mp/contracts'

import type { Environment } from '../config/environment'
import {
  INTERNAL_TOKEN_HEADER,
  matchesInternalToken,
} from '../common/security/internal-token'
import { HealthService } from './health.service'

@ApiTags('system')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<Environment, true>,
    @Inject(HealthService) private readonly health: HealthService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Check API process health' })
  @ApiOkResponse({
    description: 'The API process is available.',
    schema: {
      type: 'object',
      required: ['data'],
      properties: {
        data: {
          type: 'object',
          required: ['status', 'version'],
          properties: {
            status: { type: 'string', enum: ['ok'] },
            version: { type: 'string', example: '0.1.0' },
          },
        },
      },
    },
  })
  getHealth(): HealthResponse {
    return {
      data: {
        status: 'ok',
        version: this.config.get('APP_VERSION', { infer: true }),
      },
    }
  }

  @Get('live')
  @ApiOperation({ summary: 'Check API process liveness' })
  @ApiOkResponse({ description: 'The API process is alive.' })
  getLiveness(): HealthResponse {
    return this.getHealth()
  }

  @Get('ready')
  @ApiOperation({ summary: 'Check database and private object storage readiness' })
  @ApiOkResponse({ description: 'Required dependencies are reachable.' })
  @ApiServiceUnavailableResponse({
    description: 'At least one required dependency is unavailable.',
  })
  async getReadiness(): Promise<{ data: { status: 'ready' } }> {
    return this.health.readiness()
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Read low-sensitivity internal operational metrics' })
  @ApiHeader({
    name: INTERNAL_TOKEN_HEADER,
    required: true,
    description: 'Dedicated secret supplied by the internal monitoring system.',
  })
  @ApiOkResponse({ description: 'Internal aggregate API and export queue metrics.' })
  @ApiNotFoundResponse({
    description: 'Metrics are disabled or the internal token is invalid.',
  })
  async getOperationalMetrics(
    @Headers(INTERNAL_TOKEN_HEADER) suppliedToken: string | undefined,
  ): ReturnType<HealthService['operationalMetrics']> {
    const expectedToken = this.config.get('INTERNAL_MONITORING_TOKEN', {
      infer: true,
    })
    if (!matchesInternalToken(suppliedToken, expectedToken)) {
      throw new NotFoundException()
    }
    return this.health.operationalMetrics()
  }
}
