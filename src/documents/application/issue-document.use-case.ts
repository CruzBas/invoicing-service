import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ForbiddenError } from '../../shared/application/errors';
import { AuthenticatedClient } from '../../clients/domain/authenticated-client';
import { LookupsService } from '../../lookups/application/lookups.service';
import { DocumentIssuer, checkedTotals } from './document-issuer';
import { IssueDocumentDto } from './documents.dto';

/** POST /v1/documents: invoice (01) or ticket (04). */
@Injectable()
export class IssueDocumentUseCase {
  constructor(
    private readonly issuer: DocumentIssuer,
    private readonly lookups: LookupsService,
  ) {}

  async execute(
    client: AuthenticatedClient,
    idempotencyKey: string,
    body: IssueDocumentDto,
  ) {
    if (!client.emitterIds.includes(body.emitterId)) {
      throw new ForbiddenError('This key cannot use that emitter');
    }
    const existing = await this.issuer.findExisting(client.id, idempotencyKey);
    if (existing) return existing;

    const { lines, summary } = checkedTotals(body.lines, body.total);
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
