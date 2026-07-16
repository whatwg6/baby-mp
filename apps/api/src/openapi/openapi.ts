import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger'

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Baby MP API')
    .setDescription('Baby MP HTTP API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build()

  return SwaggerModule.createDocument(app, config)
}

export function setupOpenApi(app: INestApplication): OpenAPIObject {
  const document = createOpenApiDocument(app)
  SwaggerModule.setup('api/docs', app, document)
  return document
}
