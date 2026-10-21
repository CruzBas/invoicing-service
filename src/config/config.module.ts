import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfigService } from './app-config.service';
import { validateConfig } from './config.schema';

@Global()
@Module({
  imports: [ConfigModule.forRoot({ validate: validateConfig })],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
