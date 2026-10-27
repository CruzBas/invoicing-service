import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DateTime } from 'luxon';
import { UnprocessableError } from '../../shared/application/errors';
import { COSTA_RICA_ZONE } from '../../shared/domain/costa-rica';
import { AppConfigService } from '../../shared/infrastructure/config/app-config.service';
import { XadesSigner } from '../../shared/infrastructure/signing/xades-signer';
import { EmittersService } from '../../emitters/application/emitters.service';
import { formatConsecutive } from '../domain/consecutive-number';
import { buildDocumentKey } from '../domain/document-key';
import { DocumentType } from '../domain/document-types';
import { Receiver } from '../domain/receiver';
import { Reference } from '../domain/reference';
import {
  CalculatedLine,
  LineInput,
  Summary,
  calculateTotals,
  totalsMatch,
} from '../domain/totals-calculator';
import {
  Document,
  DocumentRepository,
  DocumentTx,
  DuplicateDocumentError,
} from '../infrastructure/document.repository';
import { buildDocumentXml } from '../infrastructure/xml/document-xml.builder';
import { DocumentDeliveryService } from './document-delivery.service';

export interface IssueRequest {
  clientId: string;
  idempotencyKey: string;
  emitterId: string;
  documentType: DocumentType;
  externalReference: string;
  currency: string;
  exchangeRate: Decimal;
  paymentMethod: string;
  receiver?: Receiver;
  lines: CalculatedLine[];
  summary: Summary;
  reference?: Reference & { documentId: string };
  /** Runs inside the transaction before the number is taken (e.g. locks and checks). */
  guard?: (tx: DocumentTx) => Promise<void>;
}

/** The time the poller leaves alone a document that is being sent right now. */
const SEND_LEASE_MS = 2 * 60_000;

/** Computes the totals; the caller's total is not used, only checked. */
export function checkedTotals(inputs: LineInput[], declaredTotal: Decimal) {
  const totals = calculateTotals(inputs);
  if (!totalsMatch(totals.summary.total, declaredTotal)) {
    throw new UnprocessableError({
      message: 'Declared total does not match the computed total',
      computedTotal: totals.summary.total.toFixed(5),
      computedTax: totals.summary.totalTax.toFixed(5),
    });
  }
  return totals;
}

/**
 * Shared by every issuing use case: takes the consecutive, builds and signs
 * the XML and stores it as Signed in one transaction, then sends it.
 */
@Injectable()
export class DocumentIssuer {
  private readonly logger = new Logger(DocumentIssuer.name);

  constructor(
    private readonly documents: DocumentRepository,
    private readonly emitters: EmittersService,
    private readonly signer: XadesSigner,
    private readonly delivery: DocumentDeliveryService,
    private readonly config: AppConfigService,
  ) { }

  /** The document already issued with that Idempotency-Key, if any. */
  findExisting(clientId: string, idempotencyKey: string) {
    return this.documents.findByIdempotencyKey(clientId, idempotencyKey);
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
      document = await this.documents.inTransaction(async (tx) => {
        await req.guard?.(tx);
        const number = await this.documents.takeNextNumber(
          tx,
          emitter.id,
          req.documentType,
        );
        const consecutive = formatConsecutive({
          branchCode: emitter.branchCode,
          terminalCode: emitter.terminalCode,
          documentType: req.documentType,
          number,
        });

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

        return this.documents.create(tx, {
          emitterId: emitter.id,
          clientId: req.clientId,
          externalReference: req.externalReference,
          idempotencyKey: req.idempotencyKey,
          documentType: req.documentType,
          key,
          consecutive,
          issuedAt,
          currency: req.currency,
          exchangeRate: req.exchangeRate,
          paymentMethod: req.paymentMethod,
          total: req.summary.total,
          totalTax: req.summary.totalTax,
          signedXml,
          referencedId: req.reference?.documentId ?? null,
          receiver: req.receiver,
          lines: req.lines,
          nextAttemptAt: new Date(Date.now() + SEND_LEASE_MS),
        });
      });
    } catch (err) {
      // Same Idempotency-Key raced in parallel: the other request won.
      if (err instanceof DuplicateDocumentError) {
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
    return this.documents.get(document.id);
  }
}
