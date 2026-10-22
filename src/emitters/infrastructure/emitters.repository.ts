import { Injectable } from '@nestjs/common';
import { Emitter } from '@prisma/client';
import { PrismaService } from '../../shared/infrastructure/prisma/prisma.service';
import { EmitterBody } from '../application/emitters.schemas';

/** Emitter data without any encrypted column. */
const SECRETS = {
  certificateEnc: true,
  certificatePinEnc: true,
  apiUserEnc: true,
  apiPasswordEnc: true,
} as const;
export type EmitterProfile = Omit<Emitter, keyof typeof SECRETS>;

/** Encrypted columns, as stored. */
export type EncryptedSecrets = Pick<Emitter, keyof typeof SECRETS>;

@Injectable()
export class EmittersRepository {
  constructor(private readonly prisma: PrismaService) {}

  upsert(id: string, body: EmitterBody): Promise<EmitterProfile> {
    return this.prisma.emitter.upsert({
      where: { id },
      create: { id, ...body },
      update: body,
      omit: SECRETS,
    });
  }

  findProfile(id: string): Promise<EmitterProfile | null> {
    return this.prisma.emitter.findUnique({ where: { id }, omit: SECRETS });
  }

  findSecrets(id: string): Promise<EncryptedSecrets | null> {
    return this.prisma.emitter.findUnique({
      where: { id },
      select: SECRETS,
    });
  }

  async saveSecrets(id: string, secrets: EncryptedSecrets): Promise<void> {
    await this.prisma.emitter.update({ where: { id }, data: secrets });
  }

  count(ids: string[]): Promise<number> {
    return this.prisma.emitter.count({ where: { id: { in: ids } } });
  }
}
