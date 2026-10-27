import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const API_KEY = 'api-key';
export const ADMIN_KEY = 'admin-key';

// Vercel does not ship swagger-ui-dist's static files with the function, so
// the UI assets come from a CDN (same version as the installed package).
const SWAGGER_UI_CDN = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.32.13';

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
    {
      swaggerOptions: { persistAuthorization: true },
      customCssUrl: `${SWAGGER_UI_CDN}/swagger-ui.css`,
      customJs: [
        `${SWAGGER_UI_CDN}/swagger-ui-bundle.js`,
        `${SWAGGER_UI_CDN}/swagger-ui-standalone-preset.js`,
      ],
    },
  );
}
