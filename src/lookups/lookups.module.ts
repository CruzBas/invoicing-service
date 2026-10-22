import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { LookupsService } from './application/lookups.service';
import { HaciendaPublicApiClient } from './infrastructure/hacienda-public-api.client';
import { LookupsController } from './presentation/lookups.controller';

@Module({
  imports: [ClientsModule],
  controllers: [LookupsController],
  providers: [LookupsService, HaciendaPublicApiClient],
  exports: [LookupsService],
})
export class LookupsModule {}
