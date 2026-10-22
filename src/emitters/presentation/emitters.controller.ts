import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AdminKeyGuard } from '../../clients/presentation/admin-key.guard';
import { ADMIN_KEY } from '../../shared/presentation/openapi';
import { CertificateDto, EmitterDto } from '../application/emitters.dto';
import { EmittersService } from '../application/emitters.service';

@ApiTags('admin')
@ApiSecurity(ADMIN_KEY)
@Controller('v1/emitters')
@UseGuards(AdminKeyGuard)
export class EmittersController {
  constructor(private readonly emitters: EmittersService) {}

  @Put(':id')
  upsert(@Param('id') id: string, @Body() body: EmitterDto) {
    return this.emitters.upsert(id, body);
  }

  @Put(':id/certificate')
  setCertificate(@Param('id') id: string, @Body() body: CertificateDto) {
    return this.emitters.setCertificate(id, body);
  }
}
