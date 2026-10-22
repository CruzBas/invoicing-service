import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/infrastructure/prisma/prisma.service';

@Injectable()
export class ClientsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByKeyHash(keyHash: string) {
    return this.prisma.apiClient.findUnique({
      where: { keyHash },
      include: { emitters: { select: { emitterId: true } } },
    });
  }

  async exists(id: string): Promise<boolean> {
    return (await this.prisma.apiClient.count({ where: { id } })) > 0;
  }

  create(client: {
    name: string;
    keyHash: string;
    webhookUrl: string | null;
    emitterIds: string[];
  }) {
    return this.prisma.apiClient.create({
      data: {
        name: client.name,
        keyHash: client.keyHash,
        webhookUrl: client.webhookUrl,
        emitters: {
          create: client.emitterIds.map((emitterId) => ({ emitterId })),
        },
      },
    });
  }

  /** Replaces the webhook and the granted emitters in one transaction. */
  async update(
    id: string,
    client: { webhookUrl: string | null; emitterIds: string[] },
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.apiClientEmitter.deleteMany({ where: { clientId: id } }),
      this.prisma.apiClient.update({
        where: { id },
        data: {
          webhookUrl: client.webhookUrl,
          emitters: {
            create: client.emitterIds.map((emitterId) => ({ emitterId })),
          },
        },
      }),
    ]);
  }
}
