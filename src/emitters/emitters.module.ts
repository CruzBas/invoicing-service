import { Module } from '@nestjs/common';
import { EmittersController } from './emitters.controller';
import { EmittersService } from './emitters.service';

@Module({
  controllers: [EmittersController],
  providers: [EmittersService],
  exports: [EmittersService],
})
export class EmittersModule {}
