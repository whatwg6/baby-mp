import { Controller, Get, Inject } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import type { HealthResponse } from '@baby-mp/contracts'

import type { Environment } from '../config/environment'

@ApiTags('system')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<Environment, true>,
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
}
