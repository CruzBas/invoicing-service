import { Module } from '@nestjs/common';
import { EmittersService } from './application/emitters.service';
import { EmittersRepository } from './infrastructure/emitters.repository';
import { EmittersController } from './presentation/emitters.controller';

@Module({
  controllers: [EmittersController],
  providers: [EmittersService, EmittersRepository],
  exports: [EmittersService],
})
export class EmittersModule {}
