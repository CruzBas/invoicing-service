import { createHmac } from 'crypto';

export const SIGNATURE_HEADER = 'x-invoicing-signature';

/** HMAC-SHA256 over the raw body bytes, as "sha256=<hex>". */
export function signWebhook(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}
