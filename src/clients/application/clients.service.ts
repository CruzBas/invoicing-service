import { Injectable } from '@nestjs/common';
import {
  NotFoundError,
  UnprocessableError,
} from '../../shared/application/errors';
import { EmittersService } from '../../emitters/application/emitters.service';
import { generateApiKey, hashApiKey } from '../domain/api-key';
import { AuthenticatedClient } from '../domain/authenticated-client';
import { ClientsRepository } from '../infrastructure/clients.repository';
import { ClientDto, CreateClientDto } from './clients.dto';

/** Consumers of the service (cotizadores, nora) and their API keys. */
@Injectable()
export class ClientsService {
  constructor(
    private readonly clients: ClientsRepository,
    private readonly emitters: EmittersService,
  ) {}

  async create(body: CreateClientDto) {
    await this.assertEmittersExist(body.emitterIds);
    const apiKey = generateApiKey();
    const client = await this.clients.create({
      name: body.name,
      keyHash: hashApiKey(apiKey),
      webhookUrl: body.webhookUrl ?? null,
      emitterIds: body.emitterIds,
    });
    return { id: client.id, name: client.name, apiKey };
  }

  async update(id: string, body: ClientDto) {
    await this.assertEmittersExist(body.emitterIds);
    if (!(await this.clients.exists(id))) throw new NotFoundError();
    const changes = {
      webhookUrl: body.webhookUrl ?? null,
      emitterIds: body.emitterIds,
    };
    await this.clients.update(id, changes);
    return { id, ...changes };
  }

  /** The client that owns this key, or null. */
  async authenticate(apiKey: string): Promise<AuthenticatedClient | null> {
    const client = await this.clients.findByKeyHash(hashApiKey(apiKey));
    if (!client) return null;
    return {
      id: client.id,
      name: client.name,
      emitterIds: client.emitters.map((e) => e.emitterId),
    };
  }

  private async assertEmittersExist(ids: string[]) {
    if (!(await this.emitters.allExist(ids))) {
      throw new UnprocessableError('Unknown emitter id');
    }
  }
}
