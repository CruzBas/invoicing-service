import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ObserveInstrument } from './observe';
import { setupOpenApi } from './shared/presentation/openapi';
import { AppConfigService } from './shared/infrastructure/config/app-config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });
  app.enableShutdownHooks();
  setupOpenApi(app);
  await app.listen(app.get(AppConfigService).get('PORT'));
}
void bootstrap();
