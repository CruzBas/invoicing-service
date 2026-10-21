import { Injectable, Logger } from '@nestjs/common';
import { Document } from '@prisma/client';
import { DateTime } from 'luxon';
import { AppConfigService } from '../config/app-config.service';
import { EmitterProfile, EmittersService } from '../emitters/emitters.service';
import { HaciendaAuthClient } from '../hacienda/hacienda-auth.client';
import {
  HaciendaReceptionClient,
  HaciendaState,
  ReceptionPayload,
} from '../hacienda/hacienda-reception.client';
import { PrismaService } from '../prisma/prisma.service';
import { formatHaciendaDate } from './domain/document-key';
import { DocumentStatus } from './domain/document-types';
import { XmlReceiver } from './xml/document-xml.builder';

const MINUTE = 60_000;

/** 1, 2, 4… minutes, capped at one hour. */
export function backoff(attempt: number): Date {
  const delay = Math.min(MINUTE * 2 ** Math.min(attempt, 10), 60 * MINUTE);
  return new Date(Date.now() + delay);
}

/** Hacienda only takes these identification types in the reception JSON. */
const RECEPTION_ID_TYPES = ['01', '02', '03', '04'];

@Injectable()
export class DocumentDeliveryService {
  private readonly logger = new Logger(DocumentDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emitters: EmittersService,
    private readonly auth: HaciendaAuthClient,
    private readonly reception: HaciendaReceptionClient,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Sends a Signed document. A timeout or 5xx is ambiguous, so before any
   * resend the key is looked up: 404 means it never arrived and it goes again
   * with the same key; anything else means Hacienda has it. A new key is never
   * generated for the same document.
   */
  async send(documentId: string): Promise<void> {
    const doc = await this.prisma.document.findUniqueOrThrow({
      where: { id: documentId },
    });
    if (doc.status !== DocumentStatus.Signed) return;
    const { token, emitter } = await this.session(doc.emitterId);

    if (doc.sendAttempts > 0) {
      const existing = await this.reception.status(token, doc.key);
      if (existing.kind === 'found') {
        await this.markSent(doc);
        return this.applyState(doc, existing.state, existing.responseXml);
      }
      if (existing.kind !== 'not_found') {
        if (existing.kind === 'unauthorized')
          this.auth.invalidate(doc.emitterId);
        return this.retryLater(
          doc,
          { sendAttempts: doc.sendAttempts },
          existing.kind,
        );
      }
    }

    // Count the attempt before the POST: a crash mid-request still forces a lookup next time.
    await this.prisma.document.update({
      where: { id: doc.id },
      data: { sendAttempts: { increment: 1 } },
    });
    const result = await this.reception.submit(
      token,
      this.payload(doc, emitter),
    );
    const attempts = { sendAttempts: doc.sendAttempts + 1 };

    switch (result.kind) {
      case 'received':
        return this.markSent(doc);
      case 'refused':
        return this.finish(doc, DocumentStatus.Error, undefined, result.cause);
      case 'unauthorized':
        this.auth.invalidate(doc.emitterId);
        return this.retryLater(doc, attempts, 'unauthorized');
      case 'ambiguous':
        return this.retryLater(doc, attempts, result.reason);
    }
  }

  /** Asks Hacienda for the state of a Sent document. */
  async poll(documentId: string): Promise<void> {
    const doc = await this.prisma.document.findUniqueOrThrow({
      where: { id: documentId },
    });
    if (doc.status !== DocumentStatus.Sent) return;
    const { token } = await this.session(doc.emitterId);
    const result = await this.reception.status(token, doc.key);

    switch (result.kind) {
      case 'found':
        return this.applyState(doc, result.state, result.responseXml);
      case 'not_found':
        // Hacienda lost it: back to Signed, resent with the same key.
        await this.prisma.document.update({
          where: { id: doc.id },
          data: { status: DocumentStatus.Signed, nextAttemptAt: new Date() },
        });
        return;
      case 'unauthorized':
        this.auth.invalidate(doc.emitterId);
        return this.retryLater(
          doc,
          { pollAttempts: doc.pollAttempts + 1 },
          'unauthorized',
        );
      case 'unavailable':
        return this.retryLater(
          doc,
          { pollAttempts: doc.pollAttempts + 1 },
          result.reason,
        );
    }
  }

  private async applyState(
    doc: Document,
    state: HaciendaState,
    responseXml?: string,
  ) {
    switch (state) {
      case 'aceptado':
        return this.finish(doc, DocumentStatus.Accepted, responseXml);
      case 'rechazado':
        return this.finish(doc, DocumentStatus.Rejected, responseXml);
      case 'error':
        return this.finish(doc, DocumentStatus.Error, responseXml);
      default: // recibido, procesando
        return this.retryLater(
          doc,
          { pollAttempts: doc.pollAttempts + 1 },
          state,
        );
    }
  }

  private async markSent(doc: Document) {
    await this.prisma.document.update({
      where: { id: doc.id },
      data: {
        status: DocumentStatus.Sent,
        pollAttempts: 0,
        nextAttemptAt: new Date(Date.now() + MINUTE),
      },
    });
  }

  private async finish(
    doc: Document,
    status: DocumentStatus,
    responseXml?: string,
    message?: string,
  ) {
    await this.prisma.document.update({
      where: { id: doc.id },
      data: {
        status,
        responseXml: responseXml ?? null,
        haciendaMessage:
          message ?? (responseXml ? detailMessage(responseXml) : null),
        nextAttemptAt: null,
        webhookPending: true,
        webhookNextAt: new Date(),
      },
    });
    this.logger.log(`${doc.key} -> ${status}`);
  }

  /** `attempts` holds the counter to store; the delay grows with it. */
  private async retryLater(
    doc: Document,
    attempts: { sendAttempts: number } | { pollAttempts: number },
    reason: string,
  ) {
    const n =
      'sendAttempts' in attempts
        ? attempts.sendAttempts
        : attempts.pollAttempts;
    await this.prisma.document.update({
      where: { id: doc.id },
      data: { ...attempts, nextAttemptAt: backoff(n) },
    });
    this.logger.warn(`${doc.key}: ${reason}, retrying later`);
  }

  private payload(doc: Document, emitter: EmitterProfile): ReceptionPayload {
    const receiver = doc.receiver as unknown as XmlReceiver | null;
    return {
      clave: doc.key,
      fecha: formatHaciendaDate(DateTime.fromJSDate(doc.issuedAt)),
      emisor: {
        tipoIdentificacion: emitter.identificationType,
        numeroIdentificacion: emitter.identification.padStart(12, '0'),
      },
      receptor:
        receiver && RECEPTION_ID_TYPES.includes(receiver.identificationType)
          ? {
              tipoIdentificacion: receiver.identificationType,
              numeroIdentificacion: receiver.identification.padStart(12, '0'),
            }
          : undefined,
      callbackUrl: this.config.get('HACIENDA_CALLBACK_URL'),
      comprobanteXml: Buffer.from(doc.signedXml, 'utf8').toString('base64'),
    };
  }

  private async session(emitterId: string) {
    const [credentials, emitter] = await Promise.all([
      this.emitters.credentials(emitterId),
      this.emitters.get(emitterId),
    ]);
    return { token: await this.auth.token(emitterId, credentials), emitter };
  }
}

/** DetalleMensaje of a MensajeHacienda, as plain text. */
export function detailMessage(responseXml: string): string | null {
  const match = /<DetalleMensaje>([\s\S]*?)<\/DetalleMensaje>/.exec(
    responseXml,
  );
  return match ? match[1].trim().slice(0, 2000) : null;
}
