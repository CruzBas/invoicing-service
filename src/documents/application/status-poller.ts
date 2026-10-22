import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DocumentStatus } from '../domain/document-types';
import { DocumentRepository } from '../infrastructure/document.repository';
import { DocumentDeliveryService } from './document-delivery.service';
import { WebhookDispatcher } from './webhook-dispatcher';

const BATCH = 25;

/**
 * Every minute: sends what is Signed, asks for what is Sent, and delivers
 * pending webhooks. Rows are claimed with a lease, so several replicas never
 * work on the same document.
 */
@Injectable()
export class StatusPoller {
  private readonly logger = new Logger(StatusPoller.name);
  private running = false;

  constructor(
    private readonly documents: DocumentRepository,
    private readonly delivery: DocumentDeliveryService,
    private readonly webhooks: WebhookDispatcher,
  ) {}

  @Cron('*/1 * * * *')
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.processDocuments();
      await this.processWebhooks();
    } finally {
      this.running = false;
    }
  }

  private async processDocuments() {
    for (const doc of await this.documents.claimDueDocuments(BATCH)) {
      try {
        if (doc.status === DocumentStatus.Signed)
          await this.delivery.send(doc.id);
        else await this.delivery.poll(doc.id);
      } catch (err) {
        this.logger.error(`Document ${doc.id}: ${String(err)}`);
      }
    }
  }

  private async processWebhooks() {
    for (const { id } of await this.documents.claimDueWebhooks(BATCH)) {
      try {
        await this.webhooks.deliver(id);
      } catch (err) {
        this.logger.error(`Webhook ${id}: ${String(err)}`);
      }
    }
  }
}
