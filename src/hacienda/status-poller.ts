import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DocumentDeliveryService } from '../documents/document-delivery.service';
import { DocumentStatus } from '../documents/domain/document-types';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookDispatcher } from '../webhooks/webhook-dispatcher';

const BATCH = 25;

/**
 * Every minute: sends what is Signed, asks for what is Sent, and delivers
 * pending webhooks. Rows are claimed with a lease (SKIP LOCKED), so several
 * replicas never work on the same document.
 */
@Injectable()
export class StatusPoller {
  private readonly logger = new Logger(StatusPoller.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
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
    const due = await this.prisma.$queryRaw<{ id: string; status: string }[]>`
      UPDATE document SET next_attempt_at = now() + interval '5 minutes'
      WHERE id IN (
        SELECT id FROM document
        WHERE status IN (${DocumentStatus.Signed}, ${DocumentStatus.Sent})
          AND next_attempt_at <= now()
        ORDER BY next_attempt_at
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED)
      RETURNING id, status`;

    for (const doc of due) {
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
    const due = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE document SET webhook_next_at = now() + interval '5 minutes'
      WHERE id IN (
        SELECT id FROM document
        WHERE webhook_pending AND webhook_next_at <= now()
        ORDER BY webhook_next_at
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED)
      RETURNING id`;

    for (const { id } of due) {
      try {
        await this.webhooks.deliver(id);
      } catch (err) {
        this.logger.error(`Webhook ${id}: ${String(err)}`);
      }
    }
  }
}
