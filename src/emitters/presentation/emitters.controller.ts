import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AdminKeyGuard } from '../../clients/presentation/admin-key.guard';
import { ADMIN_KEY, ApiZodBody } from '../../shared/presentation/openapi';
import { ZodValidationPipe } from '../../shared/presentation/zod-validation.pipe';
import {
  certificateBodySchema,
  emitterBodySchema,
} from '../application/emitters.schemas';
import type {
  CertificateBody,
  EmitterBody,
} from '../application/emitters.schemas';
import { EmittersService } from '../application/emitters.service';

@ApiTags('admin')
@ApiSecurity(ADMIN_KEY)
@Controller('v1/emitters')
@UseGuards(AdminKeyGuard)
export class EmittersController {
  constructor(private readonly emitters: EmittersService) {}

  @Put(':id')
  @ApiZodBody(emitterBodySchema)
  upsert(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(emitterBodySchema)) body: EmitterBody,
  ) {
    return this.emitters.upsert(id, body);
  }

  @Put(':id/certificate')
  @ApiZodBody(certificateBodySchema)
  setCertificate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(certificateBodySchema)) body: CertificateBody,
  ) {
    return this.emitters.setCertificate(id, body);
  }
}
