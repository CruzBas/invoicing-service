import { Body, Controller, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ADMIN_KEY } from '../../shared/presentation/openapi';
import { ClientDto, CreateClientDto } from '../application/clients.dto';
import { ClientsService } from '../application/clients.service';
import { AdminKeyGuard } from './admin-key.guard';

/** Consumers of the service (cotizadores, nora). Admin key only. */
@ApiTags('admin')
@ApiSecurity(ADMIN_KEY)
@Controller('v1/clients')
@UseGuards(AdminKeyGuard)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Post()
  create(@Body() body: CreateClientDto) {
    return this.clients.create(body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: ClientDto) {
    return this.clients.update(id, body);
  }
}
