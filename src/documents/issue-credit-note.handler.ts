import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { DateTime } from 'luxon';
import { AuthenticatedClient } from '../auth/api-key.guard';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentStatus, DocumentType } from './domain/document-types';
import { StoredLine, toLineInput } from './domain/stored-line';
import { calculateTotals, totalsMatch } from './domain/totals-calculator';
import { DocumentIssuer } from './document-issuer';
import { CreditNoteBody } from './documents.schemas';
import { XmlReceiver } from './xml/document-xml.builder';

/** Credit notes that still count against the original's total. */
const LIVE_STATUSES = [
  DocumentStatus.Signed,
  DocumentStatus.Sent,
  DocumentStatus.Accepted,
];

/** POST /v1/documents/:id/credit-notes: full or partial refund of an accepted document. */
@Injectable()
export class IssueCreditNoteHandler {
  constructor(
    private readonly issuer: DocumentIssuer,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    client: AuthenticatedClient,
    idempotencyKey: string,
    originalId: string,
    body: CreditNoteBody,
  ) {
    const existing = await this.issuer.findExisting(client.id, idempotencyKey);
    if (existing) return existing;

    const original = await this.prisma.document.findFirst({
      where: { id: originalId, clientId: client.id },
    });
    if (!original) throw new NotFoundException();
    if (
      original.documentType !== DocumentType.Invoice &&
      original.documentType !== DocumentType.Ticket
    ) {
      throw new UnprocessableEntityException(
        'Only invoices and tickets can be credited',
      );
    }
    if (original.status !== DocumentStatus.Accepted) {
      throw new ConflictException('The original document is not accepted yet');
    }

    const full = !body.lines;
    const inputs =
      body.lines ??
      (original.lines as unknown as StoredLine[]).map(toLineInput);
    const { lines, summary } = calculateTotals(inputs);
    if (!totalsMatch(summary.total, body.total)) {
      throw new UnprocessableEntityException({
        message: 'Declared total does not match the computed total',
        computedTotal: summary.total.toFixed(5),
      });
    }

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
      receiver:
        (original.receiver as unknown as XmlReceiver | null) ?? undefined,
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
      // Lock the original so two refunds cannot both pass the check.
      guard: async (tx: Prisma.TransactionClient) => {
        await tx.$queryRaw`SELECT id FROM document WHERE id = ${original.id} FOR UPDATE`;
        const credited = await tx.document.aggregate({
          _sum: { total: true },
          where: { referencedId: original.id, status: { in: LIVE_STATUSES } },
        });
        const already = new Decimal((credited._sum.total ?? 0).toString());
        if (already.add(summary.total).gt(originalTotal)) {
          throw new UnprocessableEntityException({
            message: 'Credit notes would exceed the original total',
            remaining: originalTotal.sub(already).toFixed(5),
          });
        }
      },
    });
  }
}
