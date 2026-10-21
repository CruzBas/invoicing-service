import { Module } from '@nestjs/common';
import { EmittersModule } from '../emitters/emitters.module';
import { HaciendaAuthClient } from '../hacienda/hacienda-auth.client';
import { HaciendaCallbackController } from '../hacienda/hacienda-callback.controller';
import { HaciendaReceptionClient } from '../hacienda/hacienda-reception.client';
import { StatusPoller } from '../hacienda/status-poller';
import { LookupsModule } from '../lookups/lookups.module';
import { XadesSigner } from '../signing/xades-signer';
import { WebhookDispatcher } from '../webhooks/webhook-dispatcher';
import { DocumentDeliveryService } from './document-delivery.service';
import { DocumentIssuer } from './document-issuer';
import { DocumentsController } from './documents.controller';
import { IssueCreditNoteHandler } from './issue-credit-note.handler';
import { IssueDocumentHandler } from './issue-document.handler';

@Module({
  imports: [EmittersModule, LookupsModule],
  controllers: [DocumentsController, HaciendaCallbackController],
  providers: [
    XadesSigner,
    HaciendaAuthClient,
    HaciendaReceptionClient,
    DocumentDeliveryService,
    DocumentIssuer,
    IssueDocumentHandler,
    IssueCreditNoteHandler,
    WebhookDispatcher,
    StatusPoller,
  ],
})
export class DocumentsModule {}
