import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthenticatedClient } from '../../clients/domain/authenticated-client';
import {
  ApiKeyGuard,
  CurrentClient,
} from '../../clients/presentation/api-key.guard';
import { API_KEY } from '../../shared/presentation/openapi';
import { DocumentQueries } from '../application/document-queries';
import { CreditNoteDto, IssueDocumentDto } from '../application/documents.dto';
import { IssueCreditNoteUseCase } from '../application/issue-credit-note.use-case';
import { IssueDocumentUseCase } from '../application/issue-document.use-case';
import type { Document } from '../infrastructure/document.repository';

@ApiTags('documents')
@ApiSecurity(API_KEY)
@Controller('v1/documents')
@UseGuards(ApiKeyGuard)
export class DocumentsController {
  constructor(
    private readonly queries: DocumentQueries,
    private readonly issueDocument: IssueDocumentUseCase,
    private readonly issueCreditNote: IssueCreditNoteUseCase,
  ) {}

  @Post()
  @HttpCode(202)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async issue(
    @CurrentClient() client: AuthenticatedClient,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: IssueDocumentDto,
  ) {
    const doc = await this.issueDocument.execute(
      client,
      parseIdempotencyKey(idempotencyKey),
      body,
    );
    return toView(doc);
  }

  @Post(':id/credit-notes')
  @HttpCode(202)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async creditNote(
    @CurrentClient() client: AuthenticatedClient,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreditNoteDto,
  ) {
    const doc = await this.issueCreditNote.execute(
      client,
      parseIdempotencyKey(idempotencyKey),
      id,
      body,
    );
    return toView(doc);
  }

  @Get()
  async byExternalReference(
    @CurrentClient() client: AuthenticatedClient,
    @Query('externalReference') externalReference?: string,
  ) {
    if (!externalReference) {
      throw new BadRequestException('externalReference is required');
    }
    const docs = await this.queries.byExternalReference(
      client.id,
      externalReference,
    );
    return docs.map(toView);
  }

  @Get(':id')
  async get(
    @CurrentClient() client: AuthenticatedClient,
    @Param('id') id: string,
  ) {
    return toView(await this.queries.get(client.id, id));
  }

  @Get(':id/xml')
  async xml(
    @CurrentClient() client: AuthenticatedClient,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const doc = await this.queries.get(client.id, id);
    sendFile(res, 'application/xml', `${doc.key}.xml`, doc.signedXml);
  }

  @Get(':id/response-xml')
  async responseXml(
    @CurrentClient() client: AuthenticatedClient,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const doc = await this.queries.get(client.id, id);
    if (!doc.responseXml)
      throw new NotFoundException('No response from Hacienda yet');
    sendFile(
      res,
      'application/xml',
      `${doc.key}-respuesta.xml`,
      doc.responseXml,
    );
  }

  @Get(':id/pdf')
  async pdf(
    @CurrentClient() client: AuthenticatedClient,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { key, file } = await this.queries.pdf(client.id, id);
    sendFile(res, 'application/pdf', `${key}.pdf`, file);
  }
}

function parseIdempotencyKey(value: string | undefined): string {
  if (!value || value.length > 100) {
    throw new BadRequestException('Idempotency-Key header is required');
  }
  return value;
}

function sendFile(
  res: Response,
  type: string,
  name: string,
  content: string | Buffer,
) {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(content);
}

function toView(doc: Document) {
  return {
    id: doc.id,
    emitterId: doc.emitterId,
    documentType: doc.documentType,
    externalReference: doc.externalReference,
    key: doc.key,
    consecutive: doc.consecutive,
    issuedAt: doc.issuedAt,
    currency: doc.currency,
    exchangeRate: doc.exchangeRate.toString(),
    total: doc.total.toString(),
    totalTax: doc.totalTax.toString(),
    status: doc.status,
    haciendaMessage: doc.haciendaMessage,
    referencedId: doc.referencedId,
    lines: doc.lines,
  };
}
