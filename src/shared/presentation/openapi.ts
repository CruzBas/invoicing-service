import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const API_KEY = 'api-key';
export const ADMIN_KEY = 'admin-key';

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
