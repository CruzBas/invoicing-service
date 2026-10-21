import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TerminusModule } from '@nestjs/terminus';
import { ClientsController } from './clients/clients.controller';
import { AppConfigModule } from './config/config.module';
import { DocumentsModule } from './documents/documents.module';
import { EmittersModule } from './emitters/emitters.module';
import { HealthController } from './health/health.controller';
import { LookupsModule } from './lookups/lookups.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    ScheduleModule.forRoot(),
    TerminusModule,
    EmittersModule,
    LookupsModule,
    DocumentsModule,
  ],
  controllers: [ClientsController, HealthController],
})
export class AppModule {}
