import { z } from 'zod';

export const clientBodySchema = z.object({
  webhookUrl: z.string().url().nullish(),
  emitterIds: z.array(z.string().min(1)).min(1),
});
export type ClientBody = z.infer<typeof clientBodySchema>;

export const createClientSchema = clientBodySchema.extend({
  name: z.string().min(2).max(60),
});
export type CreateClientBody = z.infer<typeof createClientSchema>;
