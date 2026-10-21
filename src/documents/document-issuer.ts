import { Injectable, Logger } from '@nestjs/common';
import { Document, Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { DateTime } from 'luxon';
import { AppConfigService } from '../config/app-config.service';
import { EmittersService } from '../emitters/emitters.service';
import { PrismaService } from '../prisma/prisma.service';
import { XadesSigner } from '../signing/xades-signer';
import { formatConsecutive, takeNextNumber } from './domain/consecutive-number';
import { buildDocumentKey } from './domain/document-key';
import {
  COSTA_RICA_ZONE,
  DocumentStatus,
  DocumentType,
} from './domain/document-types';
import { toStoredLine } from './domain/stored-line';
import { CalculatedLine, Summary } from './domain/totals-calculator';
import { DocumentDeliveryService } from './document-delivery.service';
import {
  XmlReceiver,
  XmlReference,
  buildDocumentXml,
} from './xml/document-xml.builder';

export interface IssueRequest {
  clientId: string;
  idempotencyKey: string;
  emitterId: string;
  documentType: DocumentType;
  externalReference: string;
  currency: string;
  exchangeRate: Decimal;
  paymentMethod: string;
  receiver?: XmlReceiver;
  lines: CalculatedLine[];
  summary: Summary;
  reference?: XmlReference & { documentId: string };
  /** Runs inside the transaction before the number is taken (e.g. locks and checks). */
  guard?: (tx: Prisma.TransactionClient) => Promise<void>;
}

/** The time the poller leaves alone a document that is being sent right now. */
const SEND_LEASE_MS = 2 * 60_000;

/**
 * Shared by every issuing use case: takes the consecutive, builds and signs
 * the XML and stores it as Signed in one transaction, then sends it.
 */
@Injectable()
export class DocumentIssuer {
  private readonly logger = new Logger(DocumentIssuer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emitters: EmittersService,
    private readonly signer: XadesSigner,
    private readonly delivery: DocumentDeliveryService,
    private readonly config: AppConfigService,
  ) {}

  findExisting(clientId: string, idempotencyKey: string) {
    return this.prisma.document.findUnique({
      where: { clientId_idempotencyKey: { clientId, idempotencyKey } },
    });
  }

  async issue(req: IssueRequest): Promise<Document> {
    const emitter = await this.emitters.get(req.emitterId);
    const credentials = await this.emitters.credentials(req.emitterId);
    const signingKey = await this.signer.prepare(
      credentials.p12,
      credentials.pin,
    );

    let document: Document;
    try {
      document = await this.prisma.$transaction(
        async (tx) => {
          await req.guard?.(tx);
          const number = await takeNextNumber(tx, emitter.id, req.documentType);
          const consecutive = formatConsecutive({
            branchCode: emitter.branchCode,
            terminalCode: emitter.terminalCode,
            documentType: req.documentType,
            number,
          });
          // One instant for the clave, FechaEmision and the reception JSON.
          const issuedAt = DateTime.now().setZone(COSTA_RICA_ZONE);
          const key = buildDocumentKey({
            issuedAt,
            identification: emitter.identification,
            consecutive,
          });
          const xml = buildDocumentXml({
            documentType: req.documentType,
            key,
            consecutive,
            issuedAt,
            softwareProviderId: this.config.get('SOFTWARE_PROVIDER_ID'),
            emitter,
            receiver: req.receiver,
            lines: req.lines,
            summary: req.summary,
            currency: req.currency,
            exchangeRate: req.exchangeRate,
            paymentMethod: req.paymentMethod,
            reference: req.reference,
          });
          const signedXml = await this.signer.sign(xml, signingKey);

          return tx.document.create({
            data: {
              emitterId: emitter.id,
              clientId: req.clientId,
              externalReference: req.externalReference,
              idempotencyKey: req.idempotencyKey,
              documentType: req.documentType,
              key,
              consecutive,
              issuedAt: issuedAt.toJSDate(),
              currency: req.currency,
              exchangeRate: req.exchangeRate.toFixed(5),
              paymentMethod: req.paymentMethod,
              total: req.summary.total.toFixed(5),
              totalTax: req.summary.totalTax.toFixed(5),
              status: DocumentStatus.Signed,
              signedXml,
              referencedId: req.reference?.documentId ?? null,
              receiver: req.receiver
                ? (req.receiver as unknown as Prisma.InputJsonObject)
                : Prisma.JsonNull,
              lines: req.lines.map(
                toStoredLine,
              ) as unknown as Prisma.InputJsonArray,
              nextAttemptAt: new Date(Date.now() + SEND_LEASE_MS),
            },
          });
        },
        // Emissions of one emitter queue on the sequence row; let them wait for a connection.
        { maxWait: 15_000, timeout: 20_000 },
      );
    } catch (err) {
      // Same Idempotency-Key raced in parallel: the other request won.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.findExisting(
          req.clientId,
          req.idempotencyKey,
        );
        if (existing) return existing;
      }
      throw err;
    }

    // After the commit. A failure leaves it Signed for the poller to retry.
    try {
      await this.delivery.send(document.id);
    } catch (err) {
      this.logger.error(`Send of ${document.key} failed: ${String(err)}`);
    }
    return this.prisma.document.findUniqueOrThrow({
      where: { id: document.id },
    });
  }
}
