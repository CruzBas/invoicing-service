import {
  BadRequestException,
  Body,
  ConflictException,
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
import { Document } from '@prisma/client';
import type { Response } from 'express';
import { ApiKeyGuard, CurrentClient } from '../auth/api-key.guard';
import type { AuthenticatedClient } from '../auth/api-key.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { renderDocumentPdf } from './document-pdf';
import { DocumentStatus } from './domain/document-types';
import {
  creditNoteSchema,
  idempotencyKeySchema,
  issueDocumentSchema,
} from './documents.schemas';
import type { CreditNoteBody, IssueDocumentBody } from './documents.schemas';
import { IssueCreditNoteHandler } from './issue-credit-note.handler';
import { IssueDocumentHandler } from './issue-document.handler';

@Controller('v1/documents')
@UseGuards(ApiKeyGuard)
export class DocumentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issueDocument: IssueDocumentHandler,
    private readonly issueCreditNote: IssueCreditNoteHandler,
  ) {}

  @Post()
  @HttpCode(202)
  async issue(
    @CurrentClient() client: AuthenticatedClient,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(issueDocumentSchema)) body: IssueDocumentBody,
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
  async creditNote(
    @CurrentClient() client: AuthenticatedClient,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(creditNoteSchema)) body: CreditNoteBody,
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
    const docs = await this.prisma.document.findMany({
      where: { clientId: client.id, externalReference },
      orderBy: { createdAt: 'asc' },
    });
    return docs.map(toView);
  }

  @Get(':id')
  async get(
    @CurrentClient() client: AuthenticatedClient,
    @Param('id') id: string,
  ) {
    return toView(await this.find(client, id));
  }

  @Get(':id/xml')
  async xml(
    @CurrentClient() client: AuthenticatedClient,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const doc = await this.find(client, id);
    sendFile(res, 'application/xml', `${doc.key}.xml`, doc.signedXml);
  }

  @Get(':id/response-xml')
  async responseXml(
    @CurrentClient() client: AuthenticatedClient,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const doc = await this.find(client, id);
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
    const doc = await this.find(client, id);
    if (doc.status !== DocumentStatus.Accepted) {
      throw new ConflictException('Only accepted documents have a PDF');
    }
    const [emitter, referenced] = await Promise.all([
      this.prisma.emitter.findUniqueOrThrow({ where: { id: doc.emitterId } }),
      doc.referencedId
        ? this.prisma.document.findUnique({ where: { id: doc.referencedId } })
        : null,
    ]);
    const file = await renderDocumentPdf(doc, emitter, referenced?.key);
    sendFile(res, 'application/pdf', `${doc.key}.pdf`, file);
  }

  private async find(
    client: AuthenticatedClient,
    id: string,
  ): Promise<Document> {
    const doc = await this.prisma.document.findFirst({
      where: { id, clientId: client.id },
    });
    if (!doc) throw new NotFoundException();
    return doc;
  }
}

function parseIdempotencyKey(value: string | undefined): string {
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException('Idempotency-Key header is required');
  }
  return parsed.data;
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
