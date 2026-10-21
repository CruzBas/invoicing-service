import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AdminKeyGuard } from '../auth/admin-key.guard';
import { ADMIN_KEY, ApiZodBody } from '../common/openapi';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { certificateBodySchema, emitterBodySchema } from './emitters.schemas';
import type { CertificateBody, EmitterBody } from './emitters.schemas';
import { EmittersService } from './emitters.service';

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
