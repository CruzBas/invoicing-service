import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TerminusModule } from '@nestjs/terminus';
import { ClientsModule } from './clients/clients.module';
import { DocumentsModule } from './documents/documents.module';
import { EmittersModule } from './emitters/emitters.module';
import { LookupsModule } from './lookups/lookups.module';
import { ObserveModule } from './observe';
import { AppConfigModule } from './shared/infrastructure/config/config.module';
import { PrismaModule } from './shared/infrastructure/prisma/prisma.module';
import { AppErrorFilter } from './shared/presentation/app-error.filter';
import { HealthController } from './shared/presentation/health.controller';
import { appValidationPipe } from './shared/presentation/validation.pipe';

@Module({
  imports: [
    AppConfigModule,
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY,
      appSecret: process.env.OBSERVE_APP_SECRET,
      serviceId: 'invoicing-service',
    }),
    PrismaModule,
    ScheduleModule.forRoot(),
    TerminusModule,
    ClientsModule,
    EmittersModule,
    LookupsModule,
    DocumentsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AppErrorFilter },
    { provide: APP_PIPE, useFactory: appValidationPipe },
  ],
})
export class AppModule {}
