import { Injectable } from '@nestjs/common';
import { Document, Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { DateTime } from 'luxon';
import { PrismaService } from '../../shared/infrastructure/prisma/prisma.service';
import { DocumentStatus, DocumentType } from '../domain/document-types';
import { Receiver } from '../domain/receiver';
import { toStoredLine } from '../domain/stored-line';
import { CalculatedLine } from '../domain/totals-calculator';

export type { Document };

/** A transaction opened by DocumentRepository.inTransaction. */
export type DocumentTx = Prisma.TransactionClient;

export interface NewDocument {
  emitterId: string;
  clientId: string;
  externalReference: string;
  idempotencyKey: string;
  documentType: DocumentType;
  key: string;
  consecutive: string;
  issuedAt: DateTime;
  currency: string;
  exchangeRate: Decimal;
  paymentMethod: string;
  total: Decimal;
  totalTax: Decimal;
  signedXml: string;
  referencedId: string | null;
  receiver?: Receiver;
  lines: CalculatedLine[];
  nextAttemptAt: Date;
}

/** Fields the delivery and webhook processes move along. */
export type DocumentChanges = Partial<
  Pick<
    Document,
    | 'status'
    | 'pollAttempts'
    | 'sendAttempts'
    | 'nextAttemptAt'
    | 'responseXml'
    | 'haciendaMessage'
    | 'webhookPending'
    | 'webhookAttempts'
    | 'webhookNextAt'
  >
>;

/** Another request already stored a document with the same Idempotency-Key. */
export class DuplicateDocumentError extends Error {}

/** Credit notes that still count against the original's total. */
const LIVE_STATUSES = [
  DocumentStatus.Signed,
  DocumentStatus.Sent,
  DocumentStatus.Accepted,
];

@Injectable()
export class DocumentRepository {
  constructor(private readonly prisma: PrismaService) {}

  inTransaction<T>(work: (tx: DocumentTx) => Promise<T>): Promise<T> {
    // Emissions of one emitter queue on the sequence row; let them wait for a connection.
    return this.prisma.$transaction(work, { maxWait: 15_000, timeout: 20_000 });
  }

  /**
   * Takes the next number atomically. The row stays locked until the
   * transaction ends, so two emissions never share a number, and a rollback
   * gives the number back (no gaps).
   */
  async takeNextNumber(
    tx: DocumentTx,
    emitterId: string,
    documentType: string,
  ): Promise<bigint> {
    const [{ last_number }] = await tx.$queryRaw<{ last_number: bigint }[]>`
      INSERT INTO document_sequence (emitter_id, document_type, last_number)
      VALUES (${emitterId}, ${documentType}, 1)
      ON CONFLICT (emitter_id, document_type)
      DO UPDATE SET last_number = document_sequence.last_number + 1
      RETURNING last_number`;
    return last_number;
  }

  /** Locks the original so two refunds cannot both pass the check; returns what is already credited. */
  async lockAndSumCredits(
    tx: DocumentTx,
    originalId: string,
  ): Promise<Decimal> {
    await tx.$queryRaw`SELECT id FROM document WHERE id = ${originalId} FOR UPDATE`;
    const credited = await tx.document.aggregate({
      _sum: { total: true },
      where: { referencedId: originalId, status: { in: LIVE_STATUSES } },
    });
    return new Decimal((credited._sum.total ?? 0).toString());
  }

  async create(tx: DocumentTx, doc: NewDocument): Promise<Document> {
    try {
      return await tx.document.create({
        data: {
          emitterId: doc.emitterId,
          clientId: doc.clientId,
          externalReference: doc.externalReference,
          idempotencyKey: doc.idempotencyKey,
          documentType: doc.documentType,
          key: doc.key,
          consecutive: doc.consecutive,
          issuedAt: doc.issuedAt.toJSDate(),
          currency: doc.currency,
          exchangeRate: doc.exchangeRate.toFixed(5),
          paymentMethod: doc.paymentMethod,
          total: doc.total.toFixed(5),
          totalTax: doc.totalTax.toFixed(5),
          status: DocumentStatus.Signed,
          signedXml: doc.signedXml,
          referencedId: doc.referencedId,
          receiver: doc.receiver
            ? (doc.receiver as unknown as Prisma.InputJsonObject)
            : Prisma.JsonNull,
          lines: doc.lines.map(
            toStoredLine,
          ) as unknown as Prisma.InputJsonArray,
          nextAttemptAt: doc.nextAttemptAt,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new DuplicateDocumentError();
      }
      throw err;
    }
  }

  findByIdempotencyKey(clientId: string, idempotencyKey: string) {
    return this.prisma.document.findUnique({
      where: { clientId_idempotencyKey: { clientId, idempotencyKey } },
    });
  }

  find(id: string) {
    return this.prisma.document.findUnique({ where: { id } });
  }

  get(id: string) {
    return this.prisma.document.findUniqueOrThrow({ where: { id } });
  }

  /** Only the documents of that client. */
  findOwned(clientId: string, id: string) {
    return this.prisma.document.findFirst({ where: { id, clientId } });
  }

  findByExternalReference(clientId: string, externalReference: string) {
    return this.prisma.document.findMany({
      where: { clientId, externalReference },
      orderBy: { createdAt: 'asc' },
    });
  }

  getWithWebhookUrl(id: string) {
    return this.prisma.document.findUniqueOrThrow({
      where: { id },
      include: { client: { select: { webhookUrl: true } } },
    });
  }

  async update(id: string, changes: DocumentChanges): Promise<void> {
    await this.prisma.document.update({ where: { id }, data: changes });
  }

  /** Counted with an atomic increment, before the request it counts. */
  async countSendAttempt(id: string): Promise<void> {
    await this.prisma.document.update({
      where: { id },
      data: { sendAttempts: { increment: 1 } },
    });
  }

  /** Moves the next poll of a Sent document to now. */
  async pollSoon(key: string): Promise<void> {
    await this.prisma.document.updateMany({
      where: { key, status: DocumentStatus.Sent },
      data: { nextAttemptAt: new Date() },
    });
  }

  /**
   * Claims Signed and Sent documents that are due, with a lease (SKIP
   * LOCKED), so several replicas never work on the same document.
   */
  claimDueDocuments(batch: number) {
    return this.prisma.$queryRaw<{ id: string; status: string }[]>`
      UPDATE document SET next_attempt_at = now() + interval '5 minutes'
      WHERE id IN (
        SELECT id FROM document
        WHERE status IN (${DocumentStatus.Signed}, ${DocumentStatus.Sent})
          AND next_attempt_at <= now()
        ORDER BY next_attempt_at
        LIMIT ${batch}
        FOR UPDATE SKIP LOCKED)
      RETURNING id, status`;
  }

  /** Same lease as claimDueDocuments, for pending webhooks. */
  claimDueWebhooks(batch: number) {
    return this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE document SET webhook_next_at = now() + interval '5 minutes'
      WHERE id IN (
        SELECT id FROM document
        WHERE webhook_pending AND webhook_next_at <= now()
        ORDER BY webhook_next_at
        LIMIT ${batch}
        FOR UPDATE SKIP LOCKED)
      RETURNING id`;
  }
}
