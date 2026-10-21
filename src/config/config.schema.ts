import { z } from 'zod';

const hex64 = z.string().regex(/^[0-9a-f]{64}$/i, 'must be 64 hex characters');

export const configSchema = z.object({
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().url(),
  HACIENDA_IDP_URL: z.string().url(), // realm rut-stag or rut
  HACIENDA_CLIENT_ID: z.enum(['api-stag', 'api-prod']),
  HACIENDA_RECEPTION_URL: z.string().url(), // sandbox or production
  HACIENDA_CALLBACK_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  HACIENDA_PUBLIC_API_URL: z.string().url(),
  SOFTWARE_PROVIDER_ID: z.string().regex(/^\d{9,12}$/),
  CERT_ENCRYPTION_KEY: hex64, // AES-256-GCM
  WEBHOOK_SECRET: z.string().min(32),
  ADMIN_API_KEY: z.string().min(32),
});

export type AppConfig = z.infer<typeof configSchema>;

/** Fails at startup if anything is missing or malformed. */
export function validateConfig(raw: Record<string, unknown>): AppConfig {
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}
