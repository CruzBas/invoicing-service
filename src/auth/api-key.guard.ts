import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { hashApiKey } from './api-key';

export interface AuthenticatedClient {
  id: string;
  name: string;
  emitterIds: string[];
}

type RequestWithClient = Request & { client?: AuthenticatedClient };

/** One key per consumer; each key may only use the emitters granted to it. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithClient>();
    const key = req.header('x-api-key');
    if (!key) throw new UnauthorizedException();

    const client = await this.prisma.apiClient.findUnique({
      where: { keyHash: hashApiKey(key) },
      include: { emitters: { select: { emitterId: true } } },
    });
    if (!client) throw new UnauthorizedException();

    req.client = {
      id: client.id,
      name: client.name,
      emitterIds: client.emitters.map((e) => e.emitterId),
    };
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
