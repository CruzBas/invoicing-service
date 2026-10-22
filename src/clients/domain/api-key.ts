import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export const hashApiKey = (key: string) =>
  createHash('sha256').update(key).digest('hex');

export const generateApiKey = () => `inv_${randomBytes(32).toString('hex')}`;

export function safeEqual(a: string, b: string): boolean {
  // Hash first so lengths always match.
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}
