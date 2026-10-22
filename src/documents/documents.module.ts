import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { EmittersModule } from '../emitters/emitters.module';
import { LookupsModule } from '../lookups/lookups.module';
import { XadesSigner } from '../shared/infrastructure/signing/xades-signer';
import { DocumentDeliveryService } from './application/document-delivery.service';
import { DocumentIssuer } from './application/document-issuer';
import { DocumentQueries } from './application/document-queries';
import { IssueCreditNoteUseCase } from './application/issue-credit-note.use-case';
import { IssueDocumentUseCase } from './application/issue-document.use-case';
import { StatusPoller } from './application/status-poller';
import { WebhookDispatcher } from './application/webhook-dispatcher';
import { DocumentRepository } from './infrastructure/document.repository';
import { HaciendaAuthClient } from './infrastructure/hacienda/hacienda-auth.client';
import { HaciendaReceptionClient } from './infrastructure/hacienda/hacienda-reception.client';
import { DocumentsController } from './presentation/documents.controller';
import { HaciendaCallbackController } from './presentation/hacienda-callback.controller';

@Module({
  imports: [ClientsModule, EmittersModule, LookupsModule],
  controllers: [DocumentsController, HaciendaCallbackController],
  providers: [
    // application
    IssueDocumentUseCase,
    IssueCreditNoteUseCase,
    DocumentIssuer,
    DocumentQueries,
    DocumentDeliveryService,
    WebhookDispatcher,
    StatusPoller,
    // infrastructure
    DocumentRepository,
    HaciendaAuthClient,
    HaciendaReceptionClient,
    XadesSigner,
  ],
})
export class DocumentsModule {}
