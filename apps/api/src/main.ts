import { ConfigService } from '@nestjs/config'

import { createApiApplication } from './app-bootstrap'
import type { Environment } from './config/environment'

async function bootstrap(): Promise<void> {
  const app = await createApiApplication()
  const config = app.get(ConfigService<Environment, true>)

  await app.listen(
    config.get('API_PORT', { infer: true }),
    config.get('API_HOST', { infer: true }),
  )
}

void bootstrap()
