import {
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { AuthenticatedClient } from '../auth/api-key.guard';
import { LookupsService } from '../lookups/lookups.service';
import { calculateTotals, totalsMatch } from './domain/totals-calculator';
import { DocumentIssuer } from './document-issuer';
import { IssueDocumentBody } from './documents.schemas';

/** POST /v1/documents: invoice (01) or ticket (04). */
@Injectable()
export class IssueDocumentHandler {
  constructor(
    private readonly issuer: DocumentIssuer,
    private readonly lookups: LookupsService,
  ) {}

  async execute(
    client: AuthenticatedClient,
    idempotencyKey: string,
    body: IssueDocumentBody,
  ) {
    if (!client.emitterIds.includes(body.emitterId)) {
      throw new ForbiddenException('This key cannot use that emitter');
    }
    const existing = await this.issuer.findExisting(client.id, idempotencyKey);
    if (existing) return existing;

    // The caller's totals are not used: they are only checked.
    const { lines, summary } = calculateTotals(body.lines);
    if (!totalsMatch(summary.total, body.total)) {
      throw new UnprocessableEntityException({
        message: 'Declared total does not match the computed total',
        computedTotal: summary.total.toFixed(5),
        computedTax: summary.totalTax.toFixed(5),
      });
    }

    const exchangeRate =
      body.currency === 'CRC'
        ? new Decimal(1)
        : await this.lookups.usdExchangeRate();

    return this.issuer.issue({
      clientId: client.id,
      idempotencyKey,
      emitterId: body.emitterId,
      documentType: body.documentType,
      externalReference: body.externalReference,
      currency: body.currency,
      exchangeRate,
      paymentMethod: body.paymentMethod,
      receiver: body.receiver,
      lines,
      summary,
    });
  }
}
