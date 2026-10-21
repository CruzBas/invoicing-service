import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Emitter } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { CertificateError, openCertificate } from '../signing/xades-signer';
import { SecretBox } from './secret-box';
import { CertificateBody, EmitterBody } from './emitters.schemas';

export interface EmitterCredentials {
  p12: Buffer;
  pin: string;
  apiUser: string;
  apiPassword: string;
}

/** Emitter data without any encrypted column. */
const SECRETS = {
  certificateEnc: true,
  certificatePinEnc: true,
  apiUserEnc: true,
  apiPasswordEnc: true,
} as const;
export type EmitterProfile = Omit<Emitter, keyof typeof SECRETS>;

@Injectable()
export class EmittersService {
  private readonly box: SecretBox;

  constructor(
    private readonly prisma: PrismaService,
    config: AppConfigService,
  ) {
    this.box = new SecretBox(config.get('CERT_ENCRYPTION_KEY'));
  }

  async upsert(id: string, body: EmitterBody): Promise<EmitterProfile> {
    return this.prisma.emitter.upsert({
      where: { id },
      create: { id, ...body },
      update: body,
      omit: SECRETS,
    });
  }

  async setCertificate(id: string, body: CertificateBody) {
    await this.get(id);
    const p12 = Buffer.from(body.certificateBase64, 'base64');
    let notAfter: Date;
    try {
      notAfter = openCertificate(p12, body.pin).notAfter;
    } catch (err) {
      if (err instanceof CertificateError) {
        throw new UnprocessableEntityException(err.message);
      }
      throw err;
    }
    await this.prisma.emitter.update({
      where: { id },
      data: {
        certificateEnc: this.box.encrypt(p12),
        certificatePinEnc: this.box.encrypt(body.pin),
        apiUserEnc: this.box.encrypt(body.apiUser),
        apiPasswordEnc: this.box.encrypt(body.apiPassword),
      },
    });
    return { id, certificateExpiresAt: notAfter };
  }

  async get(id: string): Promise<EmitterProfile> {
    const emitter = await this.prisma.emitter.findUnique({
      where: { id },
      omit: SECRETS,
    });
    if (!emitter) throw new NotFoundException(`Emitter ${id} not found`);
    return emitter;
  }

  /** Decrypted in memory only; never log or persist the result. */
  async credentials(id: string): Promise<EmitterCredentials> {
    const e = await this.prisma.emitter.findUnique({ where: { id } });
    if (!e) throw new NotFoundException(`Emitter ${id} not found`);
    if (
      !e.certificateEnc ||
      !e.certificatePinEnc ||
      !e.apiUserEnc ||
      !e.apiPasswordEnc
    ) {
      throw new UnprocessableEntityException(
        `Emitter ${id} has no certificate or Hacienda credentials`,
      );
    }
    return {
      p12: this.box.decrypt(e.certificateEnc),
      pin: this.box.decrypt(e.certificatePinEnc).toString('utf8'),
      apiUser: this.box.decrypt(e.apiUserEnc).toString('utf8'),
      apiPassword: this.box.decrypt(e.apiPasswordEnc).toString('utf8'),
    };
  }
}
