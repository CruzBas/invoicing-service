import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Request } from 'express';
import { ClientsService } from '../application/clients.service';
import { AuthenticatedClient } from '../domain/authenticated-client';

type RequestWithClient = Request & { client?: AuthenticatedClient };

/** One key per consumer; each key may only use the emitters granted to it. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly clients: ClientsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithClient>();
    const key = req.header('x-api-key');
    if (!key) throw new UnauthorizedException();

    const client = await this.clients.authenticate(key);
    if (!client) throw new UnauthorizedException();
    req.client = client;
    return true;
  }
}

export const CurrentClient = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthenticatedClient => {
    const client = context
      .switchToHttp()
      .getRequest<RequestWithClient>().client;
    if (!client) throw new UnauthorizedException();
    return client;
  },
);
