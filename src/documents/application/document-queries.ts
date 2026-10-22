import { Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../shared/application/errors';
import { EmittersService } from '../../emitters/application/emitters.service';
import { DocumentStatus } from '../domain/document-types';
import { renderDocumentPdf } from '../infrastructure/document-pdf';
import {
  Document,
  DocumentRepository,
} from '../infrastructure/document.repository';

/** What a client can read of its own documents. */
@Injectable()
export class DocumentQueries {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly emitters: EmittersService,
  ) {}

  async get(clientId: string, id: string): Promise<Document> {
    const doc = await this.documents.findOwned(clientId, id);
    if (!doc) throw new NotFoundError();
    return doc;
  }

  byExternalReference(clientId: string, externalReference: string) {
    return this.documents.findByExternalReference(clientId, externalReference);
  }

  async pdf(clientId: string, id: string) {
    const doc = await this.get(clientId, id);
    if (doc.status !== DocumentStatus.Accepted) {
      throw new ConflictError('Only accepted documents have a PDF');
    }
    const [emitter, referenced] = await Promise.all([
      this.emitters.get(doc.emitterId),
      doc.referencedId ? this.documents.find(doc.referencedId) : null,
    ]);
    return {
      key: doc.key,
      file: await renderDocumentPdf(doc, emitter, referenced?.key),
    };
  }
}
