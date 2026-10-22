import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DateTime } from 'luxon';
import {
  ConflictError,
  NotFoundError,
  UnprocessableError,
} from '../../shared/application/errors';
import { AuthenticatedClient } from '../../clients/domain/authenticated-client';
import { DocumentStatus, DocumentType } from '../domain/document-types';
import { Receiver } from '../domain/receiver';
import { StoredLine, toLineInput } from '../domain/stored-line';
import { DocumentRepository } from '../infrastructure/document.repository';
import { DocumentIssuer, checkedTotals } from './document-issuer';
import { CreditNoteBody } from './documents.schemas';

/** POST /v1/documents/:id/credit-notes: full or partial refund of an accepted document. */
@Injectable()
export class IssueCreditNoteUseCase {
  constructor(
    private readonly issuer: DocumentIssuer,
    private readonly documents: DocumentRepository,
  ) {}

  async execute(
    client: AuthenticatedClient,
    idempotencyKey: string,
    originalId: string,
    body: CreditNoteBody,
  ) {
    const existing = await this.issuer.findExisting(client.id, idempotencyKey);
    if (existing) return existing;

    const original = await this.documents.findOwned(client.id, originalId);
    if (!original) throw new NotFoundError();
    if (
      original.documentType !== DocumentType.Invoice &&
      original.documentType !== DocumentType.Ticket
    ) {
      throw new UnprocessableError('Only invoices and tickets can be credited');
    }
    if (original.status !== DocumentStatus.Accepted) {
      throw new ConflictError('The original document is not accepted yet');
    }

    const full = !body.lines;
    const inputs =
      body.lines ??
      (original.lines as unknown as StoredLine[]).map(toLineInput);
    const { lines, summary } = checkedTotals(inputs, body.total);
    const originalTotal = new Decimal(original.total.toString());

    return this.issuer.issue({
      clientId: client.id,
      idempotencyKey,
      emitterId: original.emitterId,
      documentType: DocumentType.CreditNote,
      externalReference: original.externalReference,
      currency: original.currency,
      exchangeRate: new Decimal(original.exchangeRate.toString()),
      paymentMethod: original.paymentMethod,
      receiver: (original.receiver as unknown as Receiver | null) ?? undefined,
      lines,
      summary,
      reference: {
        documentId: original.id,
        documentType: original.documentType,
        key: original.key,
        issuedAt: DateTime.fromJSDate(original.issuedAt),
        code: body.referenceCode ?? (full ? '01' : '04'),
        reason: body.reason,
      },
      guard: async (tx) => {
        const already = await this.documents.lockAndSumCredits(tx, original.id);
        if (already.add(summary.total).gt(originalTotal)) {
          throw new UnprocessableError({
            message: 'Credit notes would exceed the original total',
            remaining: originalTotal.sub(already).toFixed(5),
          });
        }
      },
    });
  }
}
