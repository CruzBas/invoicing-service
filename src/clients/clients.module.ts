import { Module } from '@nestjs/common';
import { EmittersModule } from '../emitters/emitters.module';
import { ClientsService } from './application/clients.service';
import { ClientsRepository } from './infrastructure/clients.repository';
import { ClientsController } from './presentation/clients.controller';

/** API consumers and their keys; ApiKeyGuard needs ClientsService, so it is exported. */
@Module({
  imports: [EmittersModule],
  controllers: [ClientsController],
  providers: [ClientsService, ClientsRepository],
  exports: [ClientsService],
})
export class ClientsModule {}
