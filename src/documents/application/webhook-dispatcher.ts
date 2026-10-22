import { Injectable, Logger } from '@nestjs/common';
import { backoff } from '../../shared/domain/backoff';
import { AppConfigService } from '../../shared/infrastructure/config/app-config.service';
import { fetchWithTimeout } from '../../shared/infrastructure/http';
import { DocumentRepository } from '../infrastructure/document.repository';
import {
  SIGNATURE_HEADER,
  signWebhook,
} from '../infrastructure/webhook-signature';

/** After this many failures the event is dropped; the consumer can still GET the document. */
const MAX_ATTEMPTS = 15;

@Injectable()
export class WebhookDispatcher {
  private readonly logger = new Logger(WebhookDispatcher.name);

  constructor(
    private readonly documents: DocumentRepository,
    private readonly config: AppConfigService,
  ) {}

  async deliver(documentId: string): Promise<void> {
    const doc = await this.documents.getWithWebhookUrl(documentId);
    if (!doc.webhookPending) return;

    const url = doc.client.webhookUrl;
    if (!url) {
      await this.done(doc.id);
      return;
    }

    // The id is stable per document and status, so the consumer can process it once.
    const body = JSON.stringify({
      id: `${doc.id}:${doc.status}`,
      type: 'document.status_changed',
      occurredAt: doc.updatedAt.toISOString(),
      data: {
        documentId: doc.id,
        documentType: doc.documentType,
        key: doc.key,
        consecutive: doc.consecutive,
        externalReference: doc.externalReference,
        referencedId: doc.referencedId,
        status: doc.status,
        haciendaMessage: doc.haciendaMessage,
      },
    });

    let ok = false;
    let reason = '';
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [SIGNATURE_HEADER]: signWebhook(
            this.config.get('WEBHOOK_SECRET'),
            body,
          ),
        },
        body,
      });
      ok = res.ok;
      reason = `HTTP ${res.status}`;
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err);
    }

    if (ok) return this.done(doc.id);

    const attempts = doc.webhookAttempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      this.logger.error(
        `Webhook for ${doc.key} dropped after ${attempts} attempts: ${reason}`,
      );
      await this.documents.update(doc.id, {
        webhookPending: false,
        webhookAttempts: attempts,
        webhookNextAt: null,
      });
      return;
    }
    this.logger.warn(
      `Webhook for ${doc.key} failed (${reason}), retrying later`,
    );
    await this.documents.update(doc.id, {
      webhookAttempts: attempts,
      webhookNextAt: backoff(attempts - 1),
    });
  }

  private done(id: string) {
    return this.documents.update(id, {
      webhookPending: false,
      webhookNextAt: null,
    });
  }
}
