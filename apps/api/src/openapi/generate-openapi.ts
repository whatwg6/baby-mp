import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { createApiApplication } from '../app-bootstrap'
import { createOpenApiDocument } from './openapi'

async function generateOpenApi(): Promise<void> {
  const app = await createApiApplication()
  await app.init()

  const outputDirectory = resolve(process.cwd(), 'openapi')
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(
    resolve(outputDirectory, 'openapi.json'),
    `${JSON.stringify(createOpenApiDocument(app), null, 2)}\n`,
    'utf8',
  )

  await app.close()
}

void generateOpenApi()
