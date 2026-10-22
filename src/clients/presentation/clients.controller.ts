import { Body, Controller, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ADMIN_KEY, ApiZodBody } from '../../shared/presentation/openapi';
import { ZodValidationPipe } from '../../shared/presentation/zod-validation.pipe';
import {
  clientBodySchema,
  createClientSchema,
} from '../application/clients.schemas';
import type {
  ClientBody,
  CreateClientBody,
} from '../application/clients.schemas';
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
  @ApiZodBody(createClientSchema)
  create(
    @Body(new ZodValidationPipe(createClientSchema)) body: CreateClientBody,
  ) {
    return this.clients.create(body);
  }

  @Put(':id')
  @ApiZodBody(clientBodySchema)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(clientBodySchema)) body: ClientBody,
  ) {
    return this.clients.update(id, body);
  }
}
