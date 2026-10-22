import { INestApplication } from '@nestjs/common';
import { ApiBody, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger';
import { z, ZodType } from 'zod';

export const API_KEY = 'api-key';
export const ADMIN_KEY = 'admin-key';

export const ApiZodBody = (schema: ZodType) =>
  ApiBody({
    schema: z.toJSONSchema(schema, {
      io: 'input',
      target: 'openapi-3.0',
    }) as SchemaObject,
  });

export function setupOpenApi(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('invoicing-service')
    .setDescription('Facturación electrónica de Hacienda (Costa Rica, v4.4).')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, API_KEY)
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-admin-key' }, ADMIN_KEY)
    .build();
  SwaggerModule.setup(
    'docs',
    app,
    () => SwaggerModule.createDocument(app, config),
    { swaggerOptions: { persistAuthorization: true } },
  );
}
