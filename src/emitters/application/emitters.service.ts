import { Injectable } from '@nestjs/common';
import {
  NotFoundError,
  UnprocessableError,
} from '../../shared/application/errors';
import { AppConfigService } from '../../shared/infrastructure/config/app-config.service';
import {
  CertificateError,
  openCertificate,
} from '../../shared/infrastructure/signing/xades-signer';
import {
  EmitterProfile,
  EmittersRepository,
} from '../infrastructure/emitters.repository';
import { SecretBox } from '../infrastructure/secret-box';
import { CertificateBody, EmitterBody } from './emitters.schemas';

export type { EmitterProfile };

export interface EmitterCredentials {
  p12: Buffer;
  pin: string;
  apiUser: string;
  apiPassword: string;
}

@Injectable()
export class EmittersService {
  private readonly box: SecretBox;

  constructor(
    private readonly emitters: EmittersRepository,
    config: AppConfigService,
  ) {
    this.box = new SecretBox(config.get('CERT_ENCRYPTION_KEY'));
  }

  upsert(id: string, body: EmitterBody): Promise<EmitterProfile> {
    return this.emitters.upsert(id, body);
  }

  async setCertificate(id: string, body: CertificateBody) {
    await this.get(id);
    const p12 = Buffer.from(body.certificateBase64, 'base64');
    let notAfter: Date;
    try {
      notAfter = openCertificate(p12, body.pin).notAfter;
    } catch (err) {
      if (err instanceof CertificateError) {
        throw new UnprocessableError(err.message);
      }
      throw err;
    }
    await this.emitters.saveSecrets(id, {
      certificateEnc: this.box.encrypt(p12),
      certificatePinEnc: this.box.encrypt(body.pin),
      apiUserEnc: this.box.encrypt(body.apiUser),
      apiPasswordEnc: this.box.encrypt(body.apiPassword),
    });
    return { id, certificateExpiresAt: notAfter };
  }

  async get(id: string): Promise<EmitterProfile> {
    const emitter = await this.emitters.findProfile(id);
    if (!emitter) throw new NotFoundError(`Emitter ${id} not found`);
    return emitter;
  }

  async allExist(ids: string[]): Promise<boolean> {
    return (await this.emitters.count(ids)) === new Set(ids).size;
  }

  /** Decrypted in memory only; never log or persist the result. */
  async credentials(id: string): Promise<EmitterCredentials> {
    const e = await this.emitters.findSecrets(id);
    if (!e) throw new NotFoundError(`Emitter ${id} not found`);
    if (
      !e.certificateEnc ||
      !e.certificatePinEnc ||
      !e.apiUserEnc ||
      !e.apiPasswordEnc
    ) {
      throw new UnprocessableError(
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
